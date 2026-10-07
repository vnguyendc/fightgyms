import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { goLive, unconfigured } from "./session";
import { as, boot, gymId, owner, other, OWNER } from "./db";

const slug = "real-gym-reston-va";
const edit = (db: Awaited<ReturnType<typeof boot>>, changes: unknown, who = owner, target = slug) =>
  as(db, "authenticated", who, "select public.edit_owned_gym($1, $2::jsonb)", [target, JSON.stringify(changes)]);
async function verified(db: Awaited<ReturnType<typeof boot>>) {
  const gym = await gymId(db, slug);
  await db.query("insert into claims (entity_id, user_id, status, role) values ($1, $2, 'verified', 'owner')", [gym, OWNER]);
  return gym;
}

test("0007 publishes bounded owner edits, keeps price history and deterministic latest prices, audits database attribution", async (t) => {
  const db = await boot(true);
  try {
    const gym = await verified(db);
    await db.query("insert into sources (id, kind, raw) values ('10000000-0000-4000-8000-000000000001', 'website', '{}')");
    await db.query("insert into gym_prices (gym_id, kind, amount_cents, verified_by, verified_at, source_id) values ($1, 'monthly', 10000, 'website', current_date, '10000000-0000-4000-8000-000000000001')", [gym]);
    const changes = { name: "Owner gym", address: "10 Main St", website: "https://gym.example/rates", phone: "+1 (202) 555-0101", description: "Owner description", prices: { trial: 0, drop_in: 2500, monthly: 15000 } };
    await edit(db, changes);
    assert.deepEqual((await as(db, "anon", null, "select name, address, website, monthly_cents, trial_cents, drop_in_cents from gym_cards where id = $1", [gym])).rows, [{ name: changes.name, address: changes.address, website: changes.website, monthly_cents: 15000, trial_cents: 0, drop_in_cents: 2500 }]);
    assert.deepEqual((await as(db, "anon", null, "select phone, description, owner_updated_at is not null as owner_updated from gyms where id = $1", [gym])).rows, [{ phone: changes.phone, description: changes.description, owner_updated: true }]);
    const audit = (await db.query<{ actor_id: string; gym_id: string; before_data: Record<string, unknown>; after_data: Record<string, unknown>; source_id: string; claim_id: string; created_at: string }>("select * from gym_owner_edits")).rows[0];
    assert.equal(audit.actor_id, OWNER);
    assert.equal(audit.gym_id, gym);
    assert.equal(audit.before_data.name, "Real Gym");
    assert.equal(audit.after_data.name, changes.name);
    assert.ok(audit.claim_id && audit.created_at);
    const source = (await db.query<{ kind: string; raw: unknown }>("select kind, raw from sources where id = $1", [audit.source_id])).rows[0];
    assert.equal(source.kind, "gym_claim");
    assert.deepEqual(source.raw, { actor_id: OWNER, claim_id: audit.claim_id, changes });
    const prices = (await db.query<{ verified_by: string; source_id: string; free_trial: boolean | null }>("select verified_by, source_id, free_trial from gym_prices where gym_id=$1 and verified_by='gym_claim' order by kind", [gym])).rows;
    assert.equal(prices.length, 3);
    assert.ok(prices.every(p => p.source_id === audit.source_id));
    assert.equal(prices[2].free_trial, true);
    await edit(db, { prices: { monthly: 16000 } });
    assert.equal((await db.query<{ monthly_cents: number }>("select monthly_cents from gym_cards where id=$1", [gym])).rows[0].monthly_cents, 16000, "second same-day edit wins");
    await edit(db, { prices: { monthly: null } });
    assert.equal((await db.query<{ monthly_cents: number | null }>("select monthly_cents from gym_cards where id=$1", [gym])).rows[0].monthly_cents, null, "withdrawal never resurrects old price");
    assert.equal((await db.query("select * from gym_prices where gym_id=$1", [gym])).rows.length, 6, "append only history");
    assert.equal((await db.query("select * from gym_owner_edits")).rows.length, 3);
    // Real public data loader and profile renderer over the edited database, with only HTTP transport replaced.
    goLive();
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      const table = url.pathname.split("/").at(-1)!;
      const single = table === "gyms" || (table === "gym_cards" && url.searchParams.has("slug")) || table === "places";
      let rows: unknown[];
      if (table === "gym_cards") rows = (await as(db, "anon", null, "select * from gym_cards where id=$1", [gym])).rows;
      else if (table === "gyms") rows = (await as(db, "anon", null, "select description, phone, affiliation, founded_year, owner_updated_at from gyms where id=$1", [gym])).rows;
      else if (table === "gym_current_prices") rows = (await as(db, "anon", null, "select * from gym_current_prices where gym_id=$1", [gym])).rows;
      else if (table === "places") rows = (await as(db, "anon", null, "select * from places where slug='reston-va'")).rows;
      else if (["classes", "coaches", "fighters", "gym_photos", "gym_socials"].includes(table)) rows = [];
      else throw new Error(`unexpected ${url}`);
      return Response.json(single ? rows[0] : rows);
    });
    try {
      const { getGym } = await import("../src/lib/data");
      const publicGym = await getGym(slug);
      assert.equal(publicGym?.name, changes.name);
      assert.equal(publicGym?.description, changes.description);
      const { default: GymPage } = await import("../src/app/gym/[slug]/page");
      const html = renderToStaticMarkup(await GymPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) }));
      assert.match(html, /Owner gym/);
      assert.match(html, /Owner description/);
      assert.match(html, /owner-supplied[\s\S]*not independently checked/i);
      assert.match(html, /\$25/);
      assert.doesNotMatch(html, /\$160/);
    } finally { unconfigured(); }

  } finally { await db.close(); }
});

test("0007 rechecks exact verified claim: badge/domain, pending, rejected, other-gym, anonymous, inactive/sample and revoked cannot authorize", async () => {
  const db = await boot(true);
  try {
    const gym = await gymId(db, slug);
    await db.query("update gyms set claimed=true where id=$1", [gym]);
    await assert.rejects(edit(db, { name: "no claim" }), /verified claim required/);
    await db.query("insert into claims (entity_id,user_id,status,role) values ($1,$2,'pending','owner')", [gym, OWNER]);
    await assert.rejects(edit(db, { name: "pending" }), /verified claim required/);
    await db.query("update claims set status='rejected' where entity_id=$1", [gym]);
    await assert.rejects(edit(db, { name: "rejected" }), /verified claim required/);
    await db.query("update claims set status='verified' where entity_id=$1", [gym]);
    await assert.rejects(edit(db, { name: "other user" }, other), /verified claim required/);
    await assert.rejects(edit(db, { name: "other gym" }, owner, "real-no-site-reston-va"), /verified claim required/);
    await assert.rejects(as(db, "anon", null, "select edit_owned_gym($1,$2::jsonb)", [slug, '{"name":"anon"}']), /permission denied/);
    await assert.rejects(as(db, "authenticated", null, "select edit_owned_gym($1,$2::jsonb)", [slug, '{"name":"no identity"}']), /verified claim required/);
    await db.query("update gyms set is_active=false where id=$1", [gym]);
    await assert.rejects(edit(db, { name: "inactive" }), /verified claim required/);
    await db.query("update gyms set is_active=true, is_sample=true where id=$1", [gym]);
    await assert.rejects(edit(db, { name: "sample" }), /verified claim required/);
    await db.query("update gyms set is_sample=false where id=$1", [gym]);
    await edit(db, { name: "allowed" });
    await db.query("update claims set status='rejected' where entity_id=$1", [gym]);
    await assert.rejects(edit(db, { name: "revoked" }), /verified claim required/);
    assert.equal((await db.query("select * from gym_owner_edits")).rows.length, 1);
  } finally { await db.close(); }
});

test("0007 rejects forged/protected or invalid payloads even via direct RPC; errors are atomic", async () => {
  const db = await boot(true);
  try {
    const gym = await verified(db);
    for (const changes of [null, [], {}, { claimed: true }, { gym_id: gym }, { status: "verified" }, { actor_id: OWNER }, { role: "owner" }, { submitted_by: OWNER }, { name: "" }, { name: "x".repeat(161) }, { address: "x".repeat(241) }, { phone: "<script>" }, { description: "x".repeat(2001) }, { website: "javascript:alert(1)" }, { website: "https://user:pass@gym.example" }, { website: "https://gym.example\n.evil" }, { name: 123 }, { name: ["x"] }, { prices: [] }, { prices: { fighter: 5000 } }, { prices: { monthly: "20000" } }, { prices: { monthly: 0 } }, { prices: { trial: -1 } }, { prices: { drop_in: 1.5 } }, { prices: { trial: 100001 } }, { name: "Changed", prices: { trial: 1000, monthly: -1 } }]) {
      await assert.rejects(edit(db, changes), /invalid owner edit/, JSON.stringify(changes));
    }
    assert.equal((await db.query<{ name: string }>("select name from gyms where id=$1", [gym])).rows[0].name, "Real Gym");
    assert.equal((await db.query("select * from gym_owner_edits")).rows.length, 0);
    assert.equal((await db.query("select * from sources where kind='gym_claim'")).rows.length, 0);
    assert.equal((await db.query("select * from gym_prices where gym_id=$1", [gym])).rows.length, 0);
    // A failure after writes have started must also roll back every table.
    await db.exec("create function fail_owner_audit() returns trigger language plpgsql as $$ begin raise exception 'audit unavailable'; end $$; create trigger fail_owner_audit before insert on gym_owner_edits for each row execute function fail_owner_audit()");
    await assert.rejects(edit(db, { name: "Changed", prices: { trial: 0 } }), /audit unavailable/);
    assert.equal((await db.query<{ name: string }>("select name from gyms where id=$1", [gym])).rows[0].name, "Real Gym");
    assert.equal((await db.query("select * from sources where kind='gym_claim'")).rows.length, 0);
    assert.equal((await db.query("select * from gym_prices where gym_id=$1", [gym])).rows.length, 0);
  } finally { await db.close(); }
});

test("0007 grants only authenticated RPC execution; direct table writes and audit tampering stay blocked", async () => {
  const db = await boot(true);
  try {
    const gym = await verified(db);
    await edit(db, { name: "Owner gym" });
    const fn = (await db.query<{ prosecdef: boolean; proconfig: string[] }>("select prosecdef, proconfig from pg_proc where proname='edit_owned_gym'")).rows[0];
    assert.equal(fn.prosecdef, true);
    assert.ok(fn.proconfig.some(v => v === 'search_path=""'), JSON.stringify(fn.proconfig));
    await as(db, "authenticated", owner, "update gyms set name='forged' where id=$1", [gym]);
    assert.equal((await db.query<{ name: string }>("select name from gyms where id=$1", [gym])).rows[0].name, "Owner gym");
    await assert.rejects(as(db, "authenticated", owner, "insert into gym_prices (gym_id, kind, amount_cents) values ($1,'monthly',1)", [gym]), /row-level security|permission denied/);
    await assert.rejects(as(db, "authenticated", owner, "insert into sources (kind) values ('gym_claim')"), /row-level security|permission denied/);
    for (const query of ["select * from gym_owner_edits", "update gym_owner_edits set actor_id=null", "delete from gym_owner_edits", "insert into gym_owner_edits default values"]) await assert.rejects(as(db, "authenticated", owner, query), /permission denied/);
    await assert.rejects(db.exec("update gym_owner_edits set created_at=now()"), /append-only/);
    await assert.rejects(db.exec("delete from gym_owner_edits"), /append-only/);
  } finally { await db.close(); }
});

test("0007 retires every public correction insert, retains historical rows/review views and authenticated new gym submissions", async () => {
  const db = await boot();
  try {
    const gym = await gymId(db, slug);
    const correction = "insert into submissions (entity_type,entity_id,field,proposed_value,submitted_by) values ('gym',$1,'website','{\"value\":\"https://gym.example\"}',$2)";
    await as(db, "anon", null, correction, [gym, null]);
    await as(db, "authenticated", owner, correction, [gym, OWNER]);
    const { readFileSync } = await import("node:fs");
    await db.exec(readFileSync(new URL("../../supabase/migrations/0007_owner_edits.sql", import.meta.url), "utf8"));
    await assert.rejects(as(db, "anon", null, correction, [gym, null]), /row-level security|permission denied/);
    await assert.rejects(as(db, "authenticated", owner, correction, [gym, OWNER]), /row-level security|permission denied/);
    assert.equal((await db.query("select * from submission_review")).rows.length, 2);
    assert.equal((await as(db, "authenticated", owner, "select * from submissions")).rows.length, 1);
    const newGym = "insert into submissions (entity_type,entity_id,field,proposed_value,submitted_by) values ('gym',null,'new_gym','{\"name\":\"New gym\"}',$1)";
    await as(db, "authenticated", owner, newGym, [OWNER]);
    await assert.rejects(as(db, "authenticated", other, newGym, [OWNER]), /row-level security/);
    await assert.rejects(as(db, "anon", null, newGym, [null]), /row-level security|permission denied/);
    assert.equal((await db.query("select * from submission_review")).rows.length, 3);
  } finally { await db.close(); }
});

test("street-address changes clear stale coordinates and capture that derived change in the audit", async () => {
  const db = await boot(true);
  try {
    const gym = await verified(db);
    await db.query("update gyms set address='10 Old St',lat=38.9,lng=-77.1 where id=$1", [gym]);
    await edit(db, { name: "Same location" });
    assert.equal((await db.query<{ lat: number }>("select lat from gyms where id=$1", [gym])).rows[0].lat, 38.9);
    await edit(db, { address: "20 New St" });
    assert.deepEqual((await db.query("select address,lat,lng from gyms where id=$1", [gym])).rows, [{ address: "20 New St", lat: null, lng: null }]);
    const audit = (await db.query<{ before_data: { lat: number; lng: number }; after_data: { lat: null; lng: null } }>("select before_data, after_data from gym_owner_edits order by created_at desc limit 1")).rows[0];
    assert.equal(audit.before_data.lat, 38.9);
    assert.equal(audit.before_data.lng, -77.1);
    assert.equal(audit.after_data.lat, null);
    assert.equal(audit.after_data.lng, null);
  } finally { await db.close(); }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

// Runs the real migration chain on an in-process Postgres with the Supabase-managed schemas stubbed.
// Policies are exercised as the `authenticated` role with a fake JWT in request.jwt.claims, the way PostgREST sets it.
const root = join(import.meta.dirname, "..", "..");
const sql = (file: string) => readFileSync(join(root, "supabase", file), "utf8");
const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

async function boot() {
  const db = new PGlite({ extensions: { pg_trgm, pgcrypto } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public bool, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
    grant usage on schema public to anon, authenticated;
    grant usage on schema auth to anon, authenticated;
  `);
  for (const f of ["migrations/0001_init.sql", "migrations/0002_photos.sql", "migrations/0003_gym_cards_v3.sql", "migrations/0004_submissions_policy.sql", "migrations/0005_claims.sql", "seed.sql"]) {
    await db.exec(sql(f));
  }
  await db.exec(`
    grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    insert into auth.users (id, email) values ('${OWNER}', 'owner@siamstrike.example'), ('${OTHER}', 'other@example.com');
    insert into places (state, city, slug) values ('VA', 'Reston', 'reston-va');
    insert into gyms (slug, name, styles, place_id, website, is_sample) values
      ('real-gym-reston-va', 'Real Gym', '{muay_thai}', (select id from places where slug = 'reston-va'), 'https://www.SiamStrike.example/', false),
      ('real-no-site-reston-va', 'No Site Gym', '{kickboxing}', (select id from places where slug = 'reston-va'), null, false);
  `);
  return db;
}

/** Run one statement as `role` with the given JWT claims, then drop back to the superuser. */
async function as<T>(db: PGlite, role: "anon" | "authenticated", claims: Record<string, string> | null, query: string, params: unknown[] = []) {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims ? JSON.stringify(claims) : ""]);
  try {
    return await db.query<T>(query, params);
  } finally {
    await db.exec("reset role");
  }
}

const owner = { sub: OWNER, email: "owner@siamstrike.example", role: "authenticated" };
const other = { sub: OTHER, email: "other@example.com", role: "authenticated" };
const gymId = async (db: PGlite, slug: string) => (await db.query<{ id: string }>("select id from gyms where slug = $1", [slug])).rows[0].id;

test("migration chain applies and 0005 adds the claim columns, views and policies", async () => {
  const db = await boot();
  const cols = (await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'claims' order by 1")).rows.map((r) => r.column_name);
  for (const c of ["role", "note", "contact_email", "website_host", "domain_match", "reviewed_at", "updated_at"]) assert.ok(cols.includes(c), c);
  const policies = (await db.query<{ policyname: string }>("select policyname from pg_policies where tablename = 'claims' order by 1")).rows.map((r) => r.policyname);
  assert.deepEqual(policies, ["claims_insert_pending", "claims_select_own"]);
  const views = (await db.query<{ table_name: string }>("select table_name from information_schema.views where table_schema = 'public' and table_name in ('claim_review', 'submission_review') order by 1")).rows.map((r) => r.table_name);
  assert.deepEqual(views, ["claim_review", "submission_review"]);
  await db.close();
});

test("a signed-in user can file exactly one pending claim per gym, for themselves, on a live non-sample gym", async () => {
  const db = await boot();
  const gym = await gymId(db, "real-gym-reston-va");
  const sample = await gymId(db, "sample-siam-strike-arlington-va");
  const insert = "insert into claims (entity_type, entity_id, user_id, role, note, status, plan) values ('gym', $1, $2, 'owner', $3, $4, 'free')";
  await as(db, "authenticated", owner, insert, [gym, OWNER, "head coach here", "pending"]);
  await assert.rejects(as(db, "authenticated", owner, insert, [gym, OWNER, null, "verified"]), /row-level security/, "verified on insert");
  await assert.rejects(as(db, "authenticated", owner, insert, [gym, OTHER, null, "pending"]), /row-level security/, "another user's id");
  await assert.rejects(as(db, "authenticated", owner, insert, [sample, OWNER, null, "pending"]), /row-level security/, "sample gym");
  await assert.rejects(as(db, "authenticated", owner, insert, [gym, OWNER, null, "pending"]), /claims_open_per_user_gym|duplicate key/, "second open claim");
  await assert.rejects(as(db, "anon", null, insert, [gym, OWNER, null, "pending"]), /row-level security/, "anonymous");
  await assert.rejects(as(db, "authenticated", owner, "update claims set status = 'verified' where user_id = $1", [OWNER]).then(async () => {
    const { rows } = await db.query<{ status: string }>("select status from claims where user_id = $1", [OWNER]);
    if (rows[0].status !== "pending") throw new Error("status changed");
    throw new Error("row-level security update refused silently");
  }), /row-level security/, "users cannot update");
  const own = await as<{ status: string; contact_email: string; website_host: string; domain_match: boolean }>(db, "authenticated", owner, "select status, contact_email, website_host, domain_match from claims");
  assert.deepEqual(own.rows, [{ status: "pending", contact_email: "owner@siamstrike.example", website_host: "siamstrike.example", domain_match: true }]);
  const theirs = await as(db, "authenticated", other, "select id from claims");
  assert.equal(theirs.rows.length, 0, "select is own rows only");
  await db.close();
});

test("the reviewer's status change syncs gyms.claimed, stamps reviewed_at, and a rejected owner can re-file", async () => {
  const db = await boot();
  const gym = await gymId(db, "real-gym-reston-va");
  const noSite = await gymId(db, "real-no-site-reston-va");
  await as(db, "authenticated", owner, "insert into claims (entity_type, entity_id, user_id, role, status, plan) values ('gym', $1, $2, 'owner', 'pending', 'free')", [gym, OWNER]);
  await as(db, "authenticated", other, "insert into claims (entity_type, entity_id, user_id, role, status, plan) values ('gym', $1, $2, 'coach', 'pending', 'free')", [noSite, OTHER]);
  const claimed = async (id: string) => (await db.query<{ claimed: boolean }>("select claimed from gyms where id = $1", [id])).rows[0].claimed;
  assert.equal(await claimed(gym), false, "pending never flips the flag");
  await db.query("update claims set status = 'verified' where entity_id = $1", [gym]);
  assert.equal(await claimed(gym), true);
  const row = (await db.query<{ reviewed_at: string | null; updated_at: string }>("select reviewed_at, updated_at from claims where entity_id = $1", [gym])).rows[0];
  assert.ok(row.reviewed_at, "reviewed_at stamped");
  await db.query("update claims set status = 'rejected' where entity_id = $1", [gym]);
  assert.equal(await claimed(gym), false, "revoking the only verified claim clears the flag");
  await as(db, "authenticated", owner, "insert into claims (entity_type, entity_id, user_id, role, status, plan) values ('gym', $1, $2, 'owner', 'pending', 'free')", [gym, OWNER]);
  const noSiteRow = (await db.query<{ website_host: string | null; domain_match: boolean }>("select website_host, domain_match from claims where entity_id = $1", [noSite])).rows[0];
  assert.deepEqual(noSiteRow, { website_host: null, domain_match: false });
  const review = await db.query<{ gym_slug: string; status: string }>("select gym_slug, status from claim_review order by gym_slug");
  assert.deepEqual(review.rows.map((r) => r.gym_slug), ["real-gym-reston-va", "real-gym-reston-va", "real-no-site-reston-va"]);
  await db.close();
});

test("submissions: 0004 rules still hold, new_gym needs a signed-in submitter and no entity, contact email is stamped", async () => {
  const db = await boot();
  const gym = await gymId(db, "real-gym-reston-va");
  const correction = "insert into submissions (entity_type, entity_id, field, proposed_value, note, contact_email, submitted_by, status) values ('gym', $1, $2, $3::jsonb, $4, $5, $6, 'pending')";
  await as(db, "anon", null, correction, [gym, "trial_price", '{"value":"$20","cents":2000}', null, "tip@example.com", null]);
  await assert.rejects(as(db, "anon", null, correction, [gym, "trial_price", '{"value":"$20"}', null, null, OWNER]), /row-level security/, "anon cannot forge submitted_by");
  await assert.rejects(as(db, "authenticated", other, correction, [gym, "trial_price", '{"value":"$20"}', null, null, OWNER]), /row-level security/, "another user's id");
  await assert.rejects(as(db, "authenticated", owner, correction, [gym, "google_rating", '{"value":"5"}', null, null, OWNER]), /row-level security/, "unknown field");
  const newGym = "insert into submissions (entity_type, entity_id, field, proposed_value, note, contact_email, submitted_by, status) values ('gym', $1, 'new_gym', $2::jsonb, $3, null, $4, 'pending')";
  await assert.rejects(as(db, "anon", null, newGym, [null, '{"name":"X"}', null, null]), /row-level security/, "anonymous new gym");
  await assert.rejects(as(db, "authenticated", owner, newGym, [gym, '{"name":"X"}', null, OWNER]), /submissions_new_gym_shape|row-level security/, "new gym with an entity");
  await as(db, "authenticated", owner, newGym, [null, '{"name":"X","city":"Reston","state":"VA"}', "we opened in march", OWNER]);
  await as(db, "authenticated", owner, correction, [gym, "website", '{"value":"https://siamstrike.example"}', null, "typed@example.com", OWNER]);
  const rows = (await db.query<{ field: string; contact_email: string | null; submitted_by: string | null }>("select field, contact_email, submitted_by from submissions order by created_at, field")).rows;
  assert.deepEqual(rows.filter((r) => r.field !== "trial_price"), [
    { field: "new_gym", contact_email: "owner@siamstrike.example", submitted_by: OWNER },
    { field: "website", contact_email: "owner@siamstrike.example", submitted_by: OWNER },
  ], "signed-in rows carry the jwt email, whatever the form sent");
  assert.deepEqual(rows.find((r) => r.field === "trial_price"), { field: "trial_price", contact_email: "tip@example.com", submitted_by: null });
  await db.query("update claims set status = 'verified' where id in (select id from claims)");
  await as(db, "authenticated", owner, "insert into claims (entity_type, entity_id, user_id, role, status, plan) values ('gym', $1, $2, 'owner', 'pending', 'free')", [gym, OWNER]);
  await db.query("update claims set status = 'verified' where user_id = $1", [OWNER]);
  const review = (await db.query<{ field: string; from_verified_claimant: boolean }>("select field, from_verified_claimant from submission_review order by field")).rows;
  assert.deepEqual(review, [{ field: "new_gym", from_verified_claimant: false }, { field: "trial_price", from_verified_claimant: false }, { field: "website", from_verified_claimant: true }]);
  await db.close();
});

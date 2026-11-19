import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { as, boot, gymId, owner, OWNER } from "./db";

const sql = (file: string) => readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8");

test("0009 appends the featured flag and end date, and owners cannot set either", async () => {
  const db = await boot(true);
  try {
    await db.exec(sql("0008_gym_cards_last_verified.sql"));
    await db.exec(sql("0009_featured.sql"));
    await db.exec(sql("0009_featured.sql"));
    const columns = (await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'gym_cards' order by ordinal_position")).rows.map((r) => r.column_name);
    assert.deepEqual(columns.slice(-3), ["last_verified_at", "featured", "featured_until"]);
    const slug = "real-gym-reston-va";
    await db.query("update gyms set featured = true, featured_until = '2099-01-01' where slug = $1", [slug]);
    const card = await as<{ featured: boolean; featured_until: string }>(db, "anon", null, "select featured, featured_until::text as featured_until from gym_cards where slug = $1", [slug]);
    assert.deepEqual(card.rows, [{ featured: true, featured_until: "2099-01-01" }]);
    await assert.rejects(as(db, "authenticated", owner, "update gyms set featured = false where slug = $1", [slug]).then(async () => {
      const { rows } = await db.query<{ featured: boolean }>("select featured from gyms where slug = $1", [slug]);
      if (!rows[0].featured) throw new Error("featured changed");
      throw new Error("row-level security update refused silently");
    }), /row-level security/);
    await assert.rejects(as(db, "authenticated", owner, "select public.edit_owned_gym($1, $2::jsonb)", [slug, JSON.stringify({ featured: true })]), /invalid owner edit/);
    assert.equal((await db.query<{ featured: boolean }>("select featured from gyms where slug = $1", [slug])).rows[0].featured, true);
    const gym = await gymId(db, slug);
    await db.query("insert into claims (entity_id, user_id, status, role) values ($1, $2, 'verified', 'owner')", [gym, OWNER]);
    await as(db, "authenticated", owner, "select public.edit_owned_gym($1, $2::jsonb)", [slug, JSON.stringify({ name: "Renamed Gym" })]);
    const after = (await db.query<{ name: string; featured: boolean; featured_until: string }>("select name, featured, featured_until::text as featured_until from gyms where slug = $1", [slug])).rows[0];
    assert.deepEqual(after, { name: "Renamed Gym", featured: true, featured_until: "2099-01-01" });
  } finally { await db.close(); }
});

test("0010 stores slug and link type only, caps a gym at 60 clicks a minute, and hides the rows from visitors", async () => {
  const db = await boot();
  try {
    await db.exec(sql("0010_outbound_clicks.sql"));
    const slug = "real-gym-reston-va";
    await as(db, "anon", null, "select public.record_outbound_click($1, 'website')", [slug]);
    await as(db, "anon", null, "select public.record_outbound_click($1, 'nope')", [slug]);
    await as(db, "anon", null, "select public.record_outbound_click('Bad Slug', 'phone')");
    await as(db, "authenticated", owner, "select public.record_outbound_click($1, 'phone')", [slug]);
    assert.equal((await db.query("select * from outbound_clicks")).rows.length, 2);
    for (let i = 0; i < 58; i++) await as(db, "anon", null, "select public.record_outbound_click($1, 'instagram')", [slug]);
    assert.equal((await db.query<{ n: number }>("select count(*)::int as n from outbound_clicks")).rows[0].n, 60);
    await as(db, "anon", null, "select public.record_outbound_click($1, 'website')", [slug]);
    assert.equal((await db.query<{ n: number }>("select count(*)::int as n from outbound_clicks")).rows[0].n, 60, "the 61st click in the minute is dropped");
    const month = (await db.query<{ m: string }>("select (date_trunc('month', now() at time zone 'America/New_York'))::date::text as m")).rows[0].m;
    const report = await db.query<{ gym_slug: string; month: string; clicks: number; website_clicks: number; phone_clicks: number; social_clicks: number }>(
      "select gym_slug, month::text, clicks, website_clicks, phone_clicks, social_clicks from outbound_clicks_monthly",
    );
    assert.deepEqual(report.rows, [{ gym_slug: slug, month, clicks: 60, website_clicks: 1, phone_clicks: 1, social_clicks: 58 }]);
    const cols = (await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'outbound_clicks' order by 1")).rows.map((r) => r.column_name);
    assert.deepEqual(cols, ["clicked_at", "gym_slug", "id", "link_type"]);
    await assert.rejects(as(db, "anon", null, "select * from outbound_clicks"), /permission denied/);
    await assert.rejects(as(db, "anon", null, "select * from outbound_clicks_monthly"), /permission denied/);
    await assert.rejects(as(db, "authenticated", owner, "insert into outbound_clicks (gym_slug, link_type) values ($1, 'website')", [slug]), /permission denied|row-level security/);
    const asService = await db.query<{ n: number }>("select count(*)::int as n from outbound_clicks_monthly");
    assert.equal(asService.rows[0].n, 1);
    await db.exec("alter role service_role bypassrls");
    await db.exec("set role service_role");
    try {
      assert.equal((await db.query<{ clicks: number }>("select clicks from outbound_clicks_monthly")).rows[0].clicks, 60);
    } finally { await db.exec("reset role"); }
  } finally { await db.close(); }
});

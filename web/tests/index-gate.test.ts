import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { gym, place } from "./fixtures";
import { boot, gymId, as } from "./db";
import { directorySitemap, gymIndexable, listingIndexable, pageMetadata } from "../src/lib/site";

const bare = { ...gym, monthly_cents: null, drop_in_cents: null, trial_cents: null, class_count: 0, claimed: false };

test("gym gate accepts a listed price or a schedule, and a city needs three gyms or a price", () => {
  assert.equal(gymIndexable(bare), false);
  assert.equal(gymIndexable({ ...bare, claimed: true }), false);
  for (const fact of [{ monthly_cents: 15000 }, { drop_in_cents: 2000 }, { trial_cents: 0 }, { trial_cents: 2000 }, { class_count: 1 }]) {
    assert.equal(gymIndexable({ ...bare, ...fact }), true, JSON.stringify(fact));
  }
  assert.equal(listingIndexable([]), false);
  assert.equal(listingIndexable([bare]), false);
  assert.equal(listingIndexable([bare, { ...bare, slug: "other" }]), false);
  assert.equal(listingIndexable([bare, { ...bare, slug: "b" }, { ...bare, slug: "c" }]), true);
  assert.equal(listingIndexable([{ ...bare, trial_cents: 0 }]), true);
  assert.equal(listingIndexable([{ ...bare, trial_cents: 2000 }]), true);
  assert.equal(listingIndexable([{ ...bare, monthly_cents: 15000 }]), true);
});

test("sitemap and metadata agree; gated pages retain follow only in the live production runtime", () => {
  const old = { ...process.env };
  try {
    Object.assign(process.env, { NODE_ENV: "production", VERCEL_ENV: "production", SHOW_SAMPLE: "0", NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test" });
    assert.deepEqual(pageMetadata("/gym/bare", "Bare", "Details", true, false).robots, { index: false, follow: true });
    assert.deepEqual(pageMetadata("/gym/trial", "Trial", "Details", true, true).robots, { index: true, follow: true });
    const trial = { ...bare, trial_cents: 0 };
    assert.deepEqual(pageMetadata("/gym/trial", "Trial", "Details", true, gymIndexable(trial)).robots, { index: true, follow: true });
    process.env.VERCEL_ENV = "preview";
    assert.deepEqual(pageMetadata("/gym/trial", "Trial", "Details", true, gymIndexable(trial)).robots, { index: false, follow: false });
    assert.deepEqual(pageMetadata("/gym/bare", "Bare", "Details", true, false).robots, { index: false, follow: false });
  } finally { process.env = old; }
  const priced = { ...bare, monthly_cents: 15000, last_verified_at: "2026-10-01" };
  const entries = directorySitemap([place], [priced], true, false);
  assert.ok(entries.some(e => e.url.endsWith(`/gym/${priced.slug}`) && e.lastModified === "2026-10-01"));
  assert.ok(entries.some(e => e.url.endsWith("/arlington")));
  const freeTrial = { ...bare, trial_cents: 0, last_verified_at: "2026-10-02" };
  const trialEntries = directorySitemap([place], [freeTrial], true, false);
  assert.ok(trialEntries.some(e => e.url.endsWith(`/gym/${freeTrial.slug}`) && e.lastModified === "2026-10-02"));
  assert.ok(trialEntries.some(e => e.url.endsWith("/arlington")), "a listed trial price qualifies the city");
  assert.ok(!trialEntries.some(e => e.url.includes("/gyms/all")));
  assert.deepEqual(directorySitemap([place], [freeTrial], false, false), []);
  assert.ok(!directorySitemap([place], [{ ...bare, trial_cents: null }], true, false).some(e => e.url.includes("/gym/")));
  assert.ok(directorySitemap([place], [{ ...bare, trial_cents: 2000 }], true, false).some(e => e.url.includes("/gym/")));
  const thin = [bare, { ...bare, slug: "second" }];
  assert.ok(!directorySitemap([place], thin, true, false).some(e => e.url.endsWith("/arlington")));
  assert.ok(directorySitemap([place], [...thin, { ...bare, slug: "third" }], true, false).some(e => e.url.endsWith("/arlington")));
  const other = { ...bare, slug: "other", styles: ["kickboxing" as const], last_verified_at: "2026-10-15" };
  const both = directorySitemap([place], [priced, other], true, false);
  assert.equal(both.find(e => e.url.endsWith("/arlington"))?.lastModified, "2026-10-15");
  assert.ok(!both.some(e => e.url.endsWith("/kickboxing")));
  assert.ok(both.filter(e => !e.url.includes("/gym/") && !e.url.includes("/gyms/va/")).every(e => !("lastModified" in e)));
  assert.ok(directorySitemap([], [{ ...priced, last_verified_at: undefined }], true, false).every(e => !("lastModified" in e)));
});

test("0008 preserves the view columns and grants, uses verified dates and builds on 0007", async () => {
  const db = await boot(true);
  try {
    const columns = async () => (await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='gym_cards' order by ordinal_position")).rows.map(r => r.column_name);
    const before = await columns();
    await db.exec("grant select on gym_cards to anon");
    const migration = readFileSync(new URL("../../supabase/migrations/0008_gym_cards_last_verified.sql", import.meta.url), "utf8");
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual(await columns(), [...before, "last_verified_at"]);
    const id = await gymId(db, "real-gym-reston-va");
    await db.query("insert into gym_prices(gym_id, kind, amount_cents, verified_at) values ($1, 'monthly', 15000, '2026-10-01')", [id]);
    const date = async () => (await as<{ value: string }>(db, "anon", null, "select last_verified_at::text as value from gym_cards where id=$1", [id])).rows[0].value;
    assert.equal(await date(), "2026-10-01");
    await db.query("update gyms set owner_updated_at='2026-10-10T12:00:00Z' where id=$1", [id]);
    assert.equal(await date(), "2026-10-10");
    await db.query("insert into classes(gym_id,dow,start_time,verified_at) values ($1,1,'18:00','2026-10-20')", [id]);
    assert.equal(await date(), "2026-10-20");
  } finally { await db.close(); }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { as, boot, owner } from "./db";

const sql = (file: string) => readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8");
const slug = "real-gym-reston-va";
type Gym = { featured: boolean; featured_until: string | null };
const gym = async (db: Awaited<ReturnType<typeof boot>>) =>
  (await db.query<Gym>("select featured, featured_until::text as featured_until from gyms where slug = $1", [slug])).rows[0];

async function chain() {
  const db = await boot(true);
  for (const f of ["0008_gym_cards_last_verified.sql", "0009_featured.sql", "0010_outbound_clicks.sql", "0011_featured_subscriptions.sql", "0011_featured_subscriptions.sql"]) await db.exec(sql(f));
  return db;
}
const sync = (db: Awaited<ReturnType<typeof boot>>, status: string, until: string | null, s = slug, sub = "sub_A1") =>
  db.query<{ r: string }>("select public.sync_featured_subscription($1, $2, 'cus_A1', $3, $4::date, 'evt_1') as r", [s, sub, status, until]).then((x) => x.rows[0].r);

test("0011 re-runs cleanly, features on payment, only moves the end date forward and lets a cancel lapse", async () => {
  const db = await chain();
  try {
    assert.equal(await sync(db, "active", "2026-12-23"), "featured");
    assert.deepEqual(await gym(db), { featured: true, featured_until: "2026-12-23" });
    assert.equal(await sync(db, "active", "2026-12-23"), "featured", "a replayed event is a no-op");
    assert.deepEqual(await gym(db), { featured: true, featured_until: "2026-12-23" });
    assert.equal(await sync(db, "active", "2027-01-23"), "featured");
    assert.equal((await gym(db)).featured_until, "2027-01-23");
    assert.equal(await sync(db, "active", "2026-12-23"), "featured", "an older event delivered late");
    assert.equal((await gym(db)).featured_until, "2027-01-23");
    assert.equal(await sync(db, "canceled", "2027-01-23"), "recorded");
    assert.deepEqual(await gym(db), { featured: true, featured_until: "2027-01-23" }, "a cancel leaves the paid period");
    assert.equal(await sync(db, "past_due", "2027-02-23"), "recorded", "an unpaid renewal does not extend");
    assert.equal((await gym(db)).featured_until, "2027-01-23");
    const rows = (await db.query<{ status: string; stripe_customer_id: string; featured_until: string }>("select status, stripe_customer_id, featured_until::text as featured_until from featured_subscriptions")).rows;
    assert.deepEqual(rows, [{ status: "past_due", stripe_customer_id: "cus_A1", featured_until: "2027-01-23" }]);
  } finally { await db.close(); }
});

test("0011 never shortens a manual open-ended feature and ignores unknown or sample gyms", async () => {
  const db = await chain();
  try {
    await db.query("update gyms set featured = true, featured_until = null where slug = $1", [slug]);
    assert.equal(await sync(db, "active", "2026-12-23"), "featured");
    assert.deepEqual(await gym(db), { featured: true, featured_until: null });
    await db.query("update gyms set featured = false, featured_until = '2020-01-01' where slug = $1", [slug]);
    assert.equal(await sync(db, "active", "2026-12-23"), "featured");
    assert.deepEqual(await gym(db), { featured: true, featured_until: "2026-12-23" });
    assert.equal(await sync(db, "active", "2026-12-23", "no-such-gym", "sub_B1"), "unknown_gym");
    const sample = (await db.query<{ slug: string }>("select slug from gyms where is_sample limit 1")).rows[0].slug;
    assert.equal(await sync(db, "active", "2026-12-23", sample, "sub_C1"), "unknown_gym");
    assert.equal((await db.query("select 1 from featured_subscriptions where stripe_subscription_id in ('sub_B1', 'sub_C1')")).rows.length, 0);
    await assert.rejects(sync(db, "active", "2026-12-23", slug, "not-a-sub"), /invalid subscription id/);
  } finally { await db.close(); }
});

test("0011 is service-role only: visitors and owners can neither read subscriptions nor call the sync", async () => {
  const db = await chain();
  try {
    await sync(db, "active", "2026-12-23");
    for (const [role, claims] of [["anon", null], ["authenticated", owner]] as const) {
      await assert.rejects(as(db, role, claims, "select * from featured_subscriptions"), /permission denied/);
      await assert.rejects(as(db, role, claims, "select public.sync_featured_subscription($1, 'sub_X1', null, 'active', '2099-01-01', null)", [slug]), /permission denied/);
    }
    assert.equal((await gym(db)).featured_until, "2026-12-23");
  } finally { await db.close(); }
});

import assert from "node:assert/strict";
import { test } from "node:test";

Object.assign(process.env, {
  NODE_ENV: "production", VERCEL_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-only-not-a-real-key",
});
delete process.env.SHOW_SAMPLE;
import { gym } from "./fixtures";

test("live reads hide sample and unreleased gyms, and do not rank by Google reviews", async (t) => {
  const rows = [
    { ...gym, slug: "z", name: "Z gym", google_reviews: 900 },
    { ...gym, slug: "a", name: "A gym", google_reviews: 1 },
    { ...gym, slug: "sample-gym", is_sample: true },
    { ...gym, slug: "sample-misflagged", is_sample: false },
    { ...gym, slug: "bjj-only", styles: ["bjj"] },
  ];
  t.mock.method(globalThis, "fetch", async () => Response.json(rows));
  const data = await import("../src/lib/data");
  assert.deepEqual((await data.getGymsByPlace("arlington-va")).map(g => g.slug), ["a", "z"]);
  assert.deepEqual((await data.getAllGyms()).map(g => g.slug).sort(), ["a", "z"]);
});

test("event reads filter seeded sample events, past dates and other states", async (t) => {
  const date = "2099-01-01";
  t.mock.method(globalThis, "fetch", async () => Response.json([
    { slug: "sample-event", date, places: { state: "VA" } },
    { slug: "past", date: "2000-01-01", places: { state: "VA" } },
    { slug: "out-of-state", date, places: { state: "MD" } },
    { slug: "test-event", date, places: { state: "VA" } },
  ]));
  const data = await import("../src/lib/data");
  assert.deepEqual((await data.getUpcomingEvents("VA")).map(e => e.slug), ["test-event"]);
});

test("Supabase read errors reject rather than masquerading as empty directories", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ message: "test read denied" }), { status: 403 }));
  const data = await import("../src/lib/data");
  for (const read of [() => data.getAllGyms(), () => data.getPlaces(), () => data.getPlace("arlington-va"), () => data.getGymsByPlace("arlington-va"), () => data.getGym("a-gym"), () => data.getUpcomingEvents()]) {
    await assert.rejects(read, /Directory data is temporarily unavailable/);
  }
});

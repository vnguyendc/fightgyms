import assert from "node:assert/strict";
import { test } from "node:test";

// No credentials and no network: exercise the production default, not a mock.
Object.assign(process.env, { NODE_ENV: "production" });
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
delete process.env.SHOW_SAMPLE;

test("partial and invalid production config stays empty even with SHOW_SAMPLE=1", async () => {
  const data = await import("../src/lib/data");
  for (const config of [
    { NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "" },
    { NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-only" },
    { NEXT_PUBLIC_SUPABASE_URL: "invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-only" },
  ]) {
    Object.assign(process.env, { ...config, SHOW_SAMPLE: "1" });
    assert.equal((await data.getAllGyms()).length, 0);
    assert.equal(await data.getPlace("arlington-va"), null);
    assert.equal(await data.getGym("sample-siam-strike-arlington-va"), null);
    assert.deepEqual(await data.getUpcomingEvents(), []);
  }
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SHOW_SAMPLE;
});

test("production without a backend never returns fictional rows on any data path", async () => {
  const data = await import("../src/lib/data");
  assert.deepEqual(await Promise.all([
    data.getAllGyms(), data.getPlaces(), data.getGymsByPlace("arlington-va"),
    data.getPlace("arlington-va"), data.getGym("sample-siam-strike-arlington-va"),
    data.getUpcomingEvents(),
  ]), [[], [], [], null, null, []]);
});

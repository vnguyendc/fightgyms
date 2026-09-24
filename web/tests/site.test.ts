import assert from "node:assert/strict";
import { test } from "node:test";
import { SITE } from "../src/lib/site";
import * as site from "../src/lib/site";

test("URL overrides accept origins only, with HTTPS except local development", () => {
  assert.equal(typeof site.resolveSiteUrl, "function");
  assert.equal(site.resolveSiteUrl(undefined), "https://findfightgyms.com");
  assert.equal(site.resolveSiteUrl("  "), "https://findfightgyms.com");
  assert.equal(site.resolveSiteUrl(" https://www.findfightgyms.com/ "), "https://www.findfightgyms.com");
  assert.equal(site.resolveSiteUrl("http://localhost:3000", false), "http://localhost:3000");
  for (const url of ["not-a-url", "//evil.test", "javascript:alert(1)", "https://user:pass@evil.test", "https://example.com/path", "https://example.com?query=1", "https://example.com/#x", "http://example.com", "https://localhost", "https://127.0.0.1", "https://example.com:9999"]) {
    assert.throws(() => site.resolveSiteUrl(url, true), /NEXT_PUBLIC_SITE_URL/);
  }
});

test("only configured production deployments are indexable; demo is explicit and never production data", () => {
  assert.equal(typeof site.runtimePolicy, "function");
  const live = { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-only" };
  assert.deepEqual(site.runtimePolicy(live), { mode: "live", indexable: true });
  for (const VERCEL_ENV of ["preview", "development"]) {
    assert.deepEqual(site.runtimePolicy({ ...live, VERCEL_ENV }), { mode: "live", indexable: false });
    assert.deepEqual(site.runtimePolicy({ ...live, VERCEL_ENV, SHOW_SAMPLE: "1" }), { mode: "demo", indexable: false });
  }
  assert.deepEqual(site.runtimePolicy({ ...live, SHOW_SAMPLE: "1" }), { mode: "live", indexable: false });
  assert.deepEqual(site.runtimePolicy({ NODE_ENV: "development", SHOW_SAMPLE: "1" }), { mode: "demo", indexable: false });
  for (const override of [{ NEXT_PUBLIC_SUPABASE_URL: "" }, { NEXT_PUBLIC_SUPABASE_ANON_KEY: " " }, { NEXT_PUBLIC_SUPABASE_URL: "bad-url" }]) {
    assert.deepEqual(site.runtimePolicy({ ...live, ...override }), { mode: "unavailable", indexable: false });
  }
  assert.deepEqual(site.runtimePolicy({ NODE_ENV: "production", SHOW_SAMPLE: "1" }), { mode: "unavailable", indexable: false });
});

test("canonical origin defaults to the owned findfightgyms.com domain", () => {
  assert.equal(SITE.url, "https://findfightgyms.com");
});

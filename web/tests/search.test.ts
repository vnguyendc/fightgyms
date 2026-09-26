import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_INDEX, matchIndex } from "../src/lib/search";
import { buildSearchIndex } from "../src/lib/search-index";
import { gym, place } from "./fixtures";

const index = buildSearchIndex(
  [
    { ...gym, slug: "b", name: "Bangkok Boxing" },
    { ...gym, slug: "a", name: "Arlington Muay Thai" },
    { ...gym, slug: "c", name: "Capital Kickboxing", place_slug: "washington-dc", city: "Washington", state: "DC" },
  ],
  [place, { ...place, slug: "washington-dc", city: "Washington", state: "DC" }, { ...place, slug: "empty-va", city: "Empty" }],
);

test("index carries names, paths and counts only, sorted for display", () => {
  assert.deepEqual(index.gyms.map((g) => g.slug), ["a", "b", "c"]);
  assert.deepEqual(index.places.map((p) => [p.slug, p.count, p.path]), [["arlington-va", 2, "/gyms/va/arlington"], ["washington-dc", 1, "/gyms/dc/washington"]]);
  assert.equal(index.gyms[0].path, "/gym/a");
  assert.deepEqual(Object.keys(index.gyms[0]).sort(), ["city", "name", "path", "slug", "state"]);
});

test("matching is case-insensitive, prefix before substring, bounded, and safe for odd input", () => {
  assert.deepEqual(matchIndex("ARL", index).places.map((p) => p.slug), ["arlington-va"]);
  assert.deepEqual(matchIndex("a", index).gyms.map((g) => g.slug), ["a", "b", "c"]); // prefix first, then substring in index order
  assert.deepEqual(matchIndex("bang", index).gyms.map((g) => g.slug), ["b"]);
  assert.deepEqual(matchIndex("ki", index).gyms.map((g) => g.slug), ["c"]);
  assert.deepEqual(matchIndex("wash", index).places.map((p) => p.slug), ["washington-dc"]);
  assert.deepEqual(matchIndex("  ", index), EMPTY_INDEX);
  assert.deepEqual(matchIndex("(", index), EMPTY_INDEX);
  assert.deepEqual(matchIndex("a".repeat(500), index), EMPTY_INDEX);
  assert.equal(matchIndex("a", index, 1).gyms.length, 1);
  const long = buildSearchIndex([{ ...gym, slug: "long", name: "a".repeat(80) + "zzz" }], [place]);
  assert.deepEqual(matchIndex("a".repeat(80) + "qqq", long).gyms.map((g) => g.slug), ["long"]); // cut at 80 chars before matching
});

test("search index route returns the public index, and an empty index without a backend", async (t) => {
  Object.assign(process.env, { NODE_ENV: "production", VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-only-not-real" });
  delete process.env.SHOW_SAMPLE;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    return Response.json(url.includes("/places") ? [place] : [gym]);
  });
  const route = await import("../src/app/api/search-index/route");
  assert.equal(route.revalidate, 3600);
  const body = await (await route.GET()).json();
  assert.deepEqual(body.gyms.map((g: { slug: string }) => g.slug), ["test-gym"]);
  assert.equal(body.places[0].slug, "arlington-va");
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  assert.deepEqual(await (await route.GET()).json(), { gyms: [], places: [] });
});

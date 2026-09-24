import assert from "node:assert/strict";
import { test } from "node:test";
import * as site from "../src/lib/site";
import { gym, place } from "./fixtures";

test("sitemap publishes only populated public city/style paths, never samples or placeholders", () => {
  assert.equal(typeof site.directorySitemap, "function");
  const places = [place, { ...place, slug: "empty-va" }];
  const gyms = [gym, gym, { ...gym, slug: "sample-hidden", is_sample: true, styles: ["kickboxing" as const] }, { ...gym, slug: "bjj-only", styles: ["bjj" as const] }];
  const urls = site.directorySitemap(places, gyms, true, false).map(e => e.url);
  assert.deepEqual(urls, [
    "https://findfightgyms.com", "https://findfightgyms.com/gyms",
    "https://findfightgyms.com/gyms/va/arlington", "https://findfightgyms.com/gyms/va/arlington/muay-thai",
    "https://findfightgyms.com/gym/test-gym",
  ]);
  assert.deepEqual(site.directorySitemap(places, gyms, false, true), []);
  assert.deepEqual(site.directorySitemap(places, [], true, false), []);
  assert.ok(site.directorySitemap(places, gyms, true, true).some(e => e.url.endsWith("/events")));
  assert.deepEqual(site.directorySitemap([], [], true, true).map(e => e.url), ["https://findfightgyms.com/events"]);
  assert.deepEqual(site.directorySitemap([], [gym], true, false).map(e => e.url), ["https://findfightgyms.com", "https://findfightgyms.com/gym/test-gym"]);
  assert.deepEqual(site.directorySitemap(places, [{ ...gym, slug: "sample-misflagged" }], true, false), []);
});

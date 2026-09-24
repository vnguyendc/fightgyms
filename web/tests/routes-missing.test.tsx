import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as home from "../src/app/page";
import * as cities from "../src/app/gyms/page";
import * as events from "../src/app/events/page";
import * as claim from "../src/app/claim/page";
import * as city from "../src/app/gyms/[state]/[city]/page";
import * as style from "../src/app/gyms/[state]/[city]/[style]/page";
import * as profile from "../src/app/gym/[slug]/page";
import sitemap from "../src/app/sitemap";
import robots from "../src/app/robots";

Object.assign(process.env, { NODE_ENV: "production" });
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
delete process.env.SHOW_SAMPLE;

test("unconfigured directory pages have self canonicals, noindex, and explicit unavailable UI", async () => {
  for (const [route, path] of [[home, "/"], [cities, "/gyms"], [events, "/events"]] as const) {
    assert.equal(typeof route.generateMetadata, "function");
    const metadata = await route.generateMetadata();
    assert.equal(metadata.alternates?.canonical, `https://findfightgyms.com${path === "/" ? "" : path}`);
    assert.deepEqual(metadata.robots, { index: false, follow: false });
    const html = renderToStaticMarkup(await route.default());
    assert.match(html, /Directory temporarily unavailable/);
    assert.doesNotMatch(html, /Siam Strike|Sample Arena|verified drop-in|Every number|Tapology|most active fighters/);
  }
});

test("production has no sample route params or sitemap without a backend", async () => {
  assert.deepEqual(await sitemap(), []);
  assert.equal(robots().sitemap, undefined);
  for (const route of [city, style, profile]) assert.deepEqual(await route.generateStaticParams(), []);
});

test("fictional city, style and profile requests are 404s, not empty success pages", async () => {
  await assert.rejects(() => city.default({ params: Promise.resolve({ state: "va", city: "arlington" }), searchParams: Promise.resolve({}) }), /NEXT_HTTP_ERROR_FALLBACK;404/);
  await assert.rejects(() => style.default({ params: Promise.resolve({ state: "va", city: "arlington", style: "muay-thai" }), searchParams: Promise.resolve({}) }), /NEXT_HTTP_ERROR_FALLBACK;404/);
  await assert.rejects(() => profile.default({ params: Promise.resolve({ slug: "sample-siam-strike-arlington-va" }), searchParams: Promise.resolve({}) }), /NEXT_HTTP_ERROR_FALLBACK;404/);
});

test("claim stays noindex and says the feature is not available yet, independently of Jev signups", async () => {
  const html = renderToStaticMarkup(await claim.default({ searchParams: Promise.resolve({}), params: Promise.resolve({}) }));
  assert.doesNotMatch(html, /<form|api\/submissions|verified badge|paused|Jev/i);
  assert.match(html, /not available yet/);
  assert.equal(claim.metadata.alternates?.canonical, "https://findfightgyms.com/claim");
  // Layout imports build-time next/font and CSS; check its static footer copy offline.
  const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(layout, /paused/i);
  assert.match(layout, /Updates \(not available yet\)/);
});

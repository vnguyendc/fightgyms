import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as city from "../src/app/gyms/[state]/[city]/page";
import * as style from "../src/app/gyms/[state]/[city]/[style]/page";
import * as profile from "../src/app/gym/[slug]/page";
import * as home from "../src/app/page";
import * as cities from "../src/app/gyms/page";
import * as events from "../src/app/events/page";
import * as search from "../src/app/search/page";
import sitemap from "../src/app/sitemap";
import robots from "../src/app/robots";
import { gym, place } from "./fixtures";

Object.assign(process.env, {
  NODE_ENV: "production", VERCEL_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-only-not-real",
});
delete process.env.SHOW_SAMPLE;

const cityProps = { params: Promise.resolve({ state: "va", city: "arlington" }), searchParams: Promise.resolve({}) };
const styleProps = { ...cityProps, params: Promise.resolve({ state: "va", city: "arlington", style: "muay-thai" }) };
const gymProps = { ...cityProps, params: Promise.resolve({ slug: gym.slug }) };

function fixtureResponse(input: string | URL | Request) {
  const url = new URL(input instanceof Request ? input.url : input);
  const table = url.pathname.split("/").at(-1);
  const single = url.searchParams.get("slug")?.startsWith("eq.");
  if (table === "gym_cards") return Response.json(single ? gym : [gym]);
  if (table === "places") return Response.json(single ? place : [place]);
  if (table === "gyms") return Response.json({ description: null, phone: null, affiliation: null, founded_year: null });
  return Response.json([]);
}

test("populated routes have precise self canonicals and truthful metadata; empty styles 404", async t => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => fixtureResponse(input));
  for (const [metadata, path] of [
    [await city.generateMetadata(cityProps), "/gyms/va/arlington"],
    [await style.generateMetadata(styleProps), "/gyms/va/arlington/muay-thai"],
    [await profile.generateMetadata(gymProps), "/gym/test-gym"],
  ] as const) {
    assert.equal(metadata.alternates?.canonical, `https://findfightgyms.com${path}`);
    assert.equal(metadata.openGraph?.url, `https://findfightgyms.com${path}`);
    assert.deepEqual(metadata.robots, { index: true, follow: true });
    assert.doesNotMatch(metadata.description ?? "", /Every |real drop-in|Prices, class schedule, coaches and fighter records/);
  }
  assert.deepEqual(await style.generateStaticParams(), [{ state: "va", city: "arlington", style: "muay-thai" }]);
  const empty = { ...styleProps, params: Promise.resolve({ state: "va", city: "arlington", style: "kickboxing" }) };
  await assert.rejects(() => style.generateMetadata(empty), /NEXT_HTTP_ERROR_FALLBACK;404/);
  await assert.rejects(() => style.default(empty), /NEXT_HTTP_ERROR_FALLBACK;404/);
  const urls = (await sitemap()).map(e => e.url);
  assert.ok(urls.includes("https://findfightgyms.com/gym/test-gym"));
  assert.ok(!urls.some(url => /kickboxing$|\/events$|\/claim$|\/search$/.test(url)));
  assert.equal(robots().sitemap, "https://findfightgyms.com/sitemap.xml");
  const html = renderToStaticMarkup(await home.default());
  assert.match(html, /1 gym in 1 city across VA\./);
  assert.match(html, /Most complete listings/);
  assert.match(html, /name="q"/);
  assert.doesNotMatch(html, /Explore the directory|listed alphabetically/);
  assert.match(html, /href="\/gyms\/va\/arlington\/muay-thai"/);
  assert.doesNotMatch(html, /href="\/gyms\/va\/arlington\/kickboxing"/);
});

test("profiles use escaped, rating-free JSON-LD and preserve usable city links without bogus claims", async t => {
  const hostile = { ...gym, name: '</script><script>alert("test")</script>', website: "javascript:alert(1)" };
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    if (String(input).includes("/gym_cards")) return Response.json(hostile);
    return fixtureResponse(input);
  });
  const html = renderToStaticMarkup(await profile.default(gymProps));
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  const schema = JSON.parse(html.match(/type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
  assert.equal(schema.name, hostile.name);
  assert.equal(schema.url, "https://findfightgyms.com/gym/test-gym");
  assert.equal(schema.aggregateRating, undefined);
  assert.doesNotMatch(html, /★|Google reviews|javascript:|Claim free|we&#x27;ll verify|Monthly unlimited|paused/i);
  assert.match(html, /Gym claims and submissions are not available yet\./);
  assert.match(html, /href="\/gyms\/va\/arlington"/);
  assert.match(html, /href="\/gyms\/va\/arlington\/muay-thai"/);
});

test("preview and demo routes stay noindex even with content; sitemap is empty", async t => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => fixtureResponse(input));
  process.env.VERCEL_ENV = "preview";
  try {
    for (const metadata of [await home.generateMetadata(), await cities.generateMetadata(), await events.generateMetadata(), await city.generateMetadata(cityProps), await style.generateMetadata(styleProps), await profile.generateMetadata(gymProps)]) {
      assert.deepEqual(metadata.robots, { index: false, follow: false });
    }
    assert.deepEqual(await sitemap(), []);
    assert.equal(robots().sitemap, undefined);
    process.env.SHOW_SAMPLE = "1";
    const sampleProps = { ...gymProps, params: Promise.resolve({ slug: "sample-siam-strike-arlington-va" }) };
    assert.deepEqual((await profile.generateMetadata(sampleProps)).robots, { index: false, follow: false });
    assert.match(renderToStaticMarkup(await profile.default(sampleProps)), /Sample listing/);
    assert.deepEqual(await sitemap(), []);
  } finally {
    process.env.VERCEL_ENV = "production";
    delete process.env.SHOW_SAMPLE;
  }
});

test("search page lists matching cities and gyms, and says so when nothing matches", async t => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => fixtureResponse(input));
  const page = (q: string | string[]) => search.default({ params: Promise.resolve({}), searchParams: Promise.resolve({ q }) });
  let html = renderToStaticMarkup(await page("test"));
  assert.match(html, /href="\/gym\/test-gym"/);
  html = renderToStaticMarkup(await page("arl"));
  assert.match(html, /href="\/gyms\/va\/arlington"/);
  html = renderToStaticMarkup(await page(["zzz", "test"]));
  assert.match(html, /No listed gyms or cities match/);
  assert.doesNotMatch(html, /href="\/gym\/test-gym"/);
});

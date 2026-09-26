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
    if (String(input).includes("/gym_cards")) return Response.json(String(input).includes("slug=eq.") ? hostile : [hostile]);
    return fixtureResponse(input);
  });
  const html = renderToStaticMarkup(await profile.default(gymProps));
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  const schema = JSON.parse(html.match(/type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
  assert.equal(schema.name, hostile.name);
  assert.equal(schema.url, "https://findfightgyms.com/gym/test-gym");
  assert.equal(schema.aggregateRating, undefined);
  assert.doesNotMatch(html, /★|Google reviews|javascript:|Claim free|we&#x27;ll verify|Monthly unlimited|paused/i);
  assert.doesNotMatch(html, /not available yet/);
  assert.match(html, /<form[^>]*action="\/api\/submissions"[^>]*method="post"/);
  assert.match(html, /name="gym" value="test-gym"/);
  assert.match(html, /name="website_url"/);
  assert.match(html, /What it costs[\s\S]*No prices listed yet/);
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
    const demoHtml = renderToStaticMarkup(await profile.default(sampleProps));
    assert.doesNotMatch(demoHtml, /api\/submissions/);
    assert.match(demoHtml, /not available in this environment/);
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

test("profiles show what it costs, where the facts came from, and the nearest gyms", async t => {
  const near = { ...gym, id: "near", slug: "near-gym", name: "Near Gym", lat: 38.8827, lng: -77.0831 };
  const trial = { gym_id: gym.id, kind: "trial", amount_cents: 2000, currency: "usd", contract_months: null, free_trial: null, notes: null, verified_at: "2026-09-01", verified_by: "website" };
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const u = String(input instanceof Request ? input.url : input);
    if (u.includes("/gym_current_prices")) return Response.json([trial]);
    if (u.includes("/gym_cards")) return Response.json(u.includes("slug=eq.") ? gym : [gym, near]);
    return fixtureResponse(input);
  });
  const html = renderToStaticMarkup(await profile.default(gymProps));
  assert.match(html, /What it costs[\s\S]{0,400}Intro \/ trial[\s\S]{0,300}from gym website[\s\S]{0,300}\$20/);
  assert.match(html, /Listed from the gym’s website · prices last verified 2026-09-01/);
  assert.match(html, /Nearby gyms[\s\S]*href="\/gym\/near-gym"[\s\S]*mi</);
  const schema = JSON.parse(html.match(/type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
  assert.equal(schema.priceRange, "$20 trial");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as city from "../src/app/gyms/[state]/[city]/page";
import * as style from "../src/app/gyms/[state]/[city]/[style]/page";
import * as profile from "../src/app/gym/[slug]/page";
import * as home from "../src/app/page";
import * as cities from "../src/app/gyms/page";
import * as all from "../src/app/gyms/all/page";
import * as allPage from "../src/app/gyms/all/page/[n]/page";
import * as events from "../src/app/events/page";
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
    [await all.generateMetadata(), "/gyms/all"],
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
  assert.ok(urls.includes("https://findfightgyms.com/gyms/all"));
  assert.ok(!urls.some(url => /kickboxing$|\/events$|\/claim$/.test(url)));
  assert.equal(robots().sitemap, "https://findfightgyms.com/sitemap.xml");
  const html = renderToStaticMarkup(await home.default());
  assert.match(html, /href="\/gyms\/va\/arlington\/muay-thai"/);
  assert.doesNotMatch(html, /href="\/gyms\/va\/arlington\/kickboxing"/);
  assert.match(html, /href="\/gyms\/all"/);
  assert.match(renderToStaticMarkup(await cities.default()), /href="\/gyms\/all"/);
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
    for (const metadata of [await home.generateMetadata(), await cities.generateMetadata(), await all.generateMetadata(), await events.generateMetadata(), await city.generateMetadata(cityProps), await style.generateMetadata(styleProps), await profile.generateMetadata(gymProps)]) {
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

test("all-gyms page lists every public gym alphabetically with escaped JSON-LD and no ratings", async t => {
  const hostile = { ...gym, id: "a", slug: "alpha-gym", name: 'Alpha </script><script>alert("x")</script> & \u2028' };
  const zulu = { ...gym, id: "z", slug: "zulu-gym", name: "Zulu Muay Thai" };
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    if (String(input).includes("/gym_cards")) return Response.json([zulu, hostile]);
    return fixtureResponse(input);
  });
  const html = renderToStaticMarkup(await all.default());
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  const schema = JSON.parse(html.match(/type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
  assert.equal(schema["@type"], "ItemList");
  assert.deepEqual(schema.itemListElement.map((i: { url: string }) => i.url),
    ["https://findfightgyms.com/gym/alpha-gym", "https://findfightgyms.com/gym/zulu-gym"]);
  assert.equal(schema.itemListElement[0].name, hostile.name);
  assert.ok(html.indexOf('href="/gym/alpha-gym"') < html.indexOf('href="/gym/zulu-gym"'));
  assert.match(html, /2 gyms listed across 1 city\./);
  assert.match(html, /href="\/gyms"/);
  assert.doesNotMatch(html, /★|reviews|Ranked by|Siam Strike/);
});

test("all-gyms pagination: 30 per page, numbered links, page routes 404 outside range", async t => {
  const many = Array.from({ length: 31 }, (_, i) => ({ ...gym, id: `g${i}`, slug: `gym-${String(i).padStart(2, "0")}`, name: `Gym ${String(i).padStart(2, "0")}` }));
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    if (String(input).includes("/gym_cards")) return Response.json(many);
    return fixtureResponse(input);
  });
  const first = renderToStaticMarkup(await all.default());
  assert.equal((first.match(/href="\/gym\/gym-/g) ?? []).length, 30);
  assert.match(first, /href="\/gym\/gym-00"/);
  assert.doesNotMatch(first, /href="\/gym\/gym-30"/);
  assert.match(first, /href="\/gyms\/all\/page\/2"/);
  assert.doesNotMatch(first, /href="\/gyms\/all\/page\/3"/);
  assert.match(first, /Page 1 of 2/);
  const props = (n: string) => ({ params: Promise.resolve({ n }), searchParams: Promise.resolve({}) });
  const second = renderToStaticMarkup(await allPage.default(props("2")));
  assert.equal((second.match(/href="\/gym\/gym-/g) ?? []).length, 1);
  assert.match(second, /href="\/gym\/gym-30"/);
  assert.match(second, /href="\/gyms\/all"/);
  assert.match(second, /Page 2 of 2/);
  const schema = JSON.parse(second.match(/type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
  assert.deepEqual(schema.itemListElement.map((i: { position: number }) => i.position), [31]);
  const metadata = await allPage.generateMetadata(props("2"));
  assert.equal(metadata.alternates?.canonical, "https://findfightgyms.com/gyms/all/page/2");
  assert.deepEqual(metadata.robots, { index: true, follow: true });
  assert.deepEqual(await allPage.generateStaticParams(), [{ n: "2" }]);
  for (const n of ["1", "3", "02", "x", "-1"]) {
    await assert.rejects(() => allPage.generateMetadata(props(n)), /NEXT_HTTP_ERROR_FALLBACK;404/, n);
    await assert.rejects(() => allPage.default(props(n)), /NEXT_HTTP_ERROR_FALLBACK;404/, n);
  }
  const urls = (await sitemap()).map(e => e.url);
  assert.ok(urls.includes("https://findfightgyms.com/gyms/all/page/2"));
  assert.ok(!urls.includes("https://findfightgyms.com/gyms/all/page/3"));
});

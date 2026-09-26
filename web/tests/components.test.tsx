import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import CityPage from "../src/components/CityPage";
import GymCard from "../src/components/GymCard";
import SiteSearch from "../src/components/SiteSearch";
import SuggestionList from "../src/components/SuggestionList";
import { money } from "../src/lib/data";
import { gym, place } from "./fixtures";

test("city structured data cannot break out of a script; card UI does not republish Google stars", () => {
  const hostileGym = { ...gym, name: '</script><script>alert("x")</script> & \u2028', tags: ["beginner_friendly" as const] };
  const html = renderToStaticMarkup(<CityPage place={place} gyms={[hostileGym]} />);
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  const json = html.match(/type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(json);
  assert.equal(JSON.parse(json).itemListElement[0].name, hostileGym.name);
  assert.doesNotMatch(html, /free or cheap first class|dedicated beginner|Ranked by|typical drop-in/);
  assert.doesNotMatch(renderToStaticMarkup(<GymCard gym={gym} />), /★|reviews/);
  assert.match(html, /href="\/gym\/test-gym"/);
  assert.doesNotMatch(html, /href="\/gyms\/va\/arlington\/kickboxing"/);
});

test("route failures have an explicit retry state without exposing backend errors", async () => {
  assert.ok(existsSync("src/app/error.tsx"), "missing route error boundary");
  const ErrorPage = (await import("../src/app/error")).default;
  const html = renderToStaticMarkup(<ErrorPage retry={() => {}} />);
  assert.match(html, /Directory temporarily unavailable/);
  assert.match(html, /Try again/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
});

test("prices preserve cents instead of rounding the published amount", () => {
  assert.equal(money(2599), "$25.99");
  assert.equal(money(2500), "$25");
  assert.equal(money(0), "$0");
  assert.equal(money(null), "—");
});

test("cards lead with the first listed price and never render empty price boxes", () => {
  const priced = { ...gym, trial_cents: 2000, drop_in_cents: 2500, monthly_cents: 15000, class_count: 2 };
  let html = renderToStaticMarkup(<GymCard gym={priced} />);
  assert.match(html, /Trial \$20/);
  assert.doesNotMatch(html, /Drop-in|Monthly|—/);
  assert.match(html, /Schedule listed/);
  html = renderToStaticMarkup(<GymCard gym={{ ...priced, trial_cents: null }} />);
  assert.match(html, /Drop-in \$25/);
  html = renderToStaticMarkup(<GymCard gym={{ ...priced, trial_cents: null, drop_in_cents: null }} />);
  assert.match(html, /Monthly \$150\/mo/);
  const bare = { ...gym, trial_cents: null, drop_in_cents: null, monthly_cents: null, class_count: 0 };
  html = renderToStaticMarkup(<GymCard gym={bare} />);
  assert.match(html, /Prices not listed/);
  assert.doesNotMatch(html, /Schedule listed|—/);
  const legacy = { ...bare } as Record<string, unknown>;
  delete legacy.trial_cents; delete legacy.class_count; // rows served before migration 0003
  assert.match(renderToStaticMarkup(<GymCard gym={legacy as typeof bare} />), /Prices not listed/);
});

test("cards show a distance chip only when given one and put beginner friendly first", () => {
  const tagged = { ...gym, tags: ["kids" as const, "beginner_friendly" as const] };
  const html = renderToStaticMarkup(<GymCard gym={tagged} distanceMi={0.84} />);
  assert.match(html, /0\.8 mi/);
  assert.ok(html.indexOf("Beginner friendly") < html.indexOf("Kids classes"));
  assert.doesNotMatch(renderToStaticMarkup(<GymCard gym={tagged} />), / mi</);
});

test("city pages order by completeness, state coverage honestly, and offer nearby cities", () => {
  const bare = { ...gym, trial_cents: null, drop_in_cents: null, monthly_cents: null, class_count: 0, photo_path: null, website: null, tags: [] as typeof gym.tags };
  const rows = [{ ...bare, slug: "zed", name: "Zed", id: "1" }, { ...bare, slug: "able", name: "Able", id: "2", trial_cents: 2000, tags: ["beginner_friendly" as const] }];
  const dc = { ...place, slug: "washington-dc", city: "Washington", state: "DC", lat: 38.9072, lng: -77.0369 };
  const nearby = [{ place: dc, distanceMi: 3.4, count: 16 }];
  const html = renderToStaticMarkup(<CityPage place={place} gyms={rows} nearby={nearby} />);
  assert.match(html, /2 gyms · 1 beginner friendly · 1 with a listed price · most complete listings first/);
  assert.ok(html.indexOf('href="/gym/able"') < html.indexOf('href="/gym/zed"'), "server order is the completeness order");
  const json = JSON.parse(html.match(/type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
  assert.deepEqual(json.itemListElement.map((e: { name: string }) => e.name), ["Able", "Zed"]);
  assert.match(html, /aria-pressed="true"[^>]*>Most complete/);
  assert.match(html, /Nearest to me/);
  assert.equal((html.match(/Nearby cities/g) ?? []).length, 2, "thin cities show nearby above and below the list");
  assert.match(html, /href="\/gyms\/dc\/washington"[^>]*>Washington, DC/);
  assert.match(html, /3\.4 mi/);
  const many = Array.from({ length: 4 }, (_, i) => ({ ...bare, slug: `g${i}`, id: `g${i}`, name: `Gym ${i}` }));
  assert.equal((renderToStaticMarkup(<CityPage place={place} gyms={many} nearby={nearby} />).match(/Nearby cities/g) ?? []).length, 1);
  assert.doesNotMatch(renderToStaticMarkup(<CityPage place={place} gyms={many} />), /Nearby cities/);
  assert.doesNotMatch(html, /Listed alphabetically/);
});

test("site search is a plain GET form to /search with no suggestions until focused", () => {
  const html = renderToStaticMarkup(<SiteSearch size="large" initialQuery="arl" />);
  assert.match(html, /<form[^>]*action="\/search"[^>]*method="get"/);
  assert.match(html, /name="q"[^>]*value="arl"/);
  assert.doesNotMatch(html, /role="listbox"|Use my location/);
});

test("suggestion list renders options with ids, hrefs, the active item and the locate button", () => {
  const items = [
    { key: "p-arlington-va", label: "Arlington, VA", detail: "9 gyms", href: "/gyms/va/arlington" },
    { key: "g-alpha-gym", label: "Alpha Gym", detail: "Arlington, VA", href: "/gym/alpha-gym" },
  ];
  const html = renderToStaticMarkup(<SuggestionList listId="s-listbox" items={items} active={1} locate={true} locating={false} onLocate={() => {}} linkRef={() => {}} />);
  assert.match(html, /<ul[^>]*id="s-listbox"[^>]*role="listbox"/);
  assert.match(html, /id="s-listbox-0"[^>]*role="option"[^>]*aria-selected="false"[\s\S]*?Use my location/);
  assert.match(html, /id="s-listbox-1"[^>]*role="option"[^>]*aria-selected="true"[\s\S]*?href="\/gyms\/va\/arlington"/);
  assert.match(html, /id="s-listbox-2"[^>]*aria-selected="false"[\s\S]*?href="\/gym\/alpha-gym"/);
  assert.equal((html.match(/role="option"/g) ?? []).length, 3);
  const noLocate = renderToStaticMarkup(<SuggestionList listId="s-listbox" items={items} active={0} locate={false} locating={false} onLocate={() => {}} linkRef={() => {}} />);
  assert.doesNotMatch(noLocate, /Use my location/);
  assert.match(noLocate, /id="s-listbox-0"[^>]*aria-selected="true"[\s\S]*?href="\/gyms\/va\/arlington"/);
  assert.equal((noLocate.match(/role="option"/g) ?? []).length, 2);
});

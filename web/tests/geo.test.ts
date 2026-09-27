import assert from "node:assert/strict";
import { test } from "node:test";
import * as geo from "../src/lib/geo";
import { listStates, miles } from "../src/lib/format";
import { gym, place } from "./fixtures";

const arlington = { lat: 38.8816, lng: -77.091 }, dc = { lat: 38.9072, lng: -77.0369 };
const bare = { ...gym, trial_cents: null, drop_in_cents: null, monthly_cents: null, class_count: 0, photo_path: null, website: null, tags: [] as typeof gym.tags };

test("haversine matches known distances and is null without coordinates", () => {
  const d = geo.haversineMiles(arlington, dc);
  assert.ok(d > 3.2 && d < 3.6, String(d)); // Arlington VA to Washington DC centre
  const nyla = geo.haversineMiles({ lat: 40.7128, lng: -74.006 }, { lat: 34.0522, lng: -118.2437 });
  assert.ok(nyla > 2430 && nyla < 2460, String(nyla));
  assert.equal(geo.haversineMiles(arlington, arlington), 0);
  assert.equal(geo.distanceMi({ lat: null, lng: null }, dc), null);
  assert.equal(geo.distanceMi(arlington, { lat: 38.9, lng: null }), null);
});

test("completeness counts price, schedule, photo, website; legacy rows score zero; ordering is stable", () => {
  assert.equal(geo.completeness(bare), 0);
  assert.equal(geo.completeness({ ...bare, trial_cents: 2000 }), 1);
  assert.equal(geo.completeness({ ...bare, drop_in_cents: 2500, monthly_cents: 15000 }), 1);
  assert.equal(geo.completeness({ ...bare, class_count: 3, photo_path: "x.webp", website: "https://example.com" }), 3);
  const legacy = { ...bare } as Record<string, unknown>;
  delete legacy.trial_cents; delete legacy.class_count; // rows served before migration 0003
  assert.equal(geo.completeness(legacy as typeof bare), 0);
  const a = { ...bare, slug: "a", name: "Alpha" }, b = { ...bare, slug: "b", name: "Bravo", website: "https://example.com" }, c = { ...bare, slug: "c", name: "Alpha" };
  assert.deepEqual([c, b, a].sort(geo.byCompleteness).map((g) => g.slug), ["b", "a", "c"]);
});

test("distance sort keeps unlocated gyms at the end without a distance", () => {
  const far = { ...gym, slug: "far", lat: dc.lat, lng: dc.lng };
  const near = { ...gym, slug: "near", lat: 38.8827, lng: -77.0831 };
  const unknown = { ...gym, slug: "unknown", lat: null, lng: null };
  const out = geo.withDistances([unknown, far, near], arlington);
  assert.deepEqual(out.map((x) => x.gym.slug), ["near", "far", "unknown"]);
  assert.equal(out[2].distanceMi, null);
  assert.ok(out[0].distanceMi! < out[1].distanceMi!);
});

test("nearby places respect radius, limit, counts and skip the origin; nearest gyms skip self", () => {
  const dcPlace = { ...place, slug: "washington-dc", city: "Washington", state: "DC", lat: dc.lat, lng: dc.lng };
  const baltimore = { ...place, slug: "baltimore-md", city: "Baltimore", state: "MD", lat: 39.2904, lng: -76.6122 };
  const empty = { ...place, slug: "empty-va", city: "Empty", lat: 38.89, lng: -77.09 };
  const nowhere = { ...place, slug: "nowhere-va", city: "Nowhere", lat: null, lng: null };
  const counts = new Map([["arlington-va", 11], ["washington-dc", 16], ["baltimore-md", 9], ["nowhere-va", 2]]);
  assert.deepEqual(geo.nearbyPlaces(place, [place, dcPlace, baltimore, empty, nowhere], counts).map((x) => [x.place.slug, x.count]), [["washington-dc", 16]]);
  assert.deepEqual(geo.nearbyPlaces(place, [place, dcPlace, baltimore], counts, { radiusMi: 100, limit: 1 }).map((x) => x.place.slug), ["washington-dc"]);
  const self = { ...gym, slug: "self", lat: arlington.lat, lng: arlington.lng };
  const others = [{ ...gym, slug: "b", lat: 38.9, lng: -77.1 }, { ...gym, slug: "a", lat: 38.882, lng: -77.091 }, { ...gym, slug: "c", lat: 39.5, lng: -77 }, { ...gym, slug: "n", lat: null, lng: null }];
  assert.deepEqual(geo.nearestGyms(self, [self, ...others], 2).map((x) => x.gym.slug), ["a", "b"]);
  assert.equal(geo.nearestPlace({ lat: 39.3, lng: -76.6 }, [place, dcPlace, baltimore])?.slug, "baltimore-md");
  assert.equal(geo.nearestPlace({ lat: 39.3, lng: -76.6 }, [nowhere]), null);
  assert.deepEqual([...geo.placeCounts([gym, gym, { ...gym, place_slug: null }]).entries()], [["arlington-va", 2]]);
});

test("coverage line omits zero parts; formatting helpers", () => {
  assert.equal(geo.coverageLine(geo.coverage([bare])), "1 gym");
  const rows = [bare, { ...bare, tags: ["beginner_friendly" as const], trial_cents: 2000 }, { ...bare, class_count: 2, monthly_cents: 10000 }];
  assert.equal(geo.coverageLine(geo.coverage(rows)), "3 gyms · 1 beginner friendly · 2 with a listed price · 1 with a schedule");
  assert.equal(miles(0.84), "0.8 mi");
  assert.equal(miles(12.4), "12 mi");
  assert.equal(listStates(["VA", "DC", "VA", "MD"]), "DC, MD and VA");
  assert.equal(listStates(["VA"]), "VA");
  assert.equal(listStates([]), "");
});

test("listing summary is one quotable sentence built only from listed counts and prices", () => {
  assert.equal(typeof geo.listingSummary, "function");
  const dropIn = { ...gym, trial_cents: null, drop_in_cents: 3000, monthly_cents: null };
  const trial = { ...gym, slug: "t", trial_cents: 4900, drop_in_cents: null, monthly_cents: 15000 };
  const monthlyOnly = { ...gym, slug: "m", trial_cents: null, drop_in_cents: null, monthly_cents: 12000 };
  const none = { ...gym, slug: "n", trial_cents: null, drop_in_cents: null, monthly_cents: null };
  assert.equal(geo.listingSummary("Muay Thai", place, [dropIn]),
    "1 Muay Thai gym is listed in Arlington, VA. 1 of them lists a price; trial or drop-in classes start at $30.");
  assert.equal(geo.listingSummary("Muay Thai & Kickboxing", place, [trial, dropIn, none]),
    "3 Muay Thai & Kickboxing gyms are listed in Arlington, VA. 2 of them list a price; trial or drop-in classes start at $30.");
  assert.equal(geo.listingSummary("Kickboxing", place, [monthlyOnly, none]),
    "2 Kickboxing gyms are listed in Arlington, VA. 1 of them lists a price.");
  assert.equal(geo.listingSummary("Kickboxing", place, [none]), "1 Kickboxing gym is listed in Arlington, VA.");
  assert.equal(geo.listingSummary("Kickboxing", place, []), "");
});

test("nearby-or-nearest falls back to the closest listed cities when none are within the radius", () => {
  assert.equal(typeof geo.nearbyOrNearest, "function");
  const mk = (slug: string, lat: number, lng: number) => ({ ...place, slug, city: slug, lat, lng });
  const close = mk("close-va", 38.95, -77.1);          // ~5 mi
  const far1 = mk("far1-va", 39.6, -77.1);             // ~50 mi
  const far2 = mk("far2-va", 40.0, -77.1);             // ~77 mi
  const far3 = mk("far3-va", 40.5, -77.1);
  const far4 = mk("far4-va", 41.0, -77.1);
  const counts = new Map([["close-va", 2], ["far1-va", 1], ["far2-va", 3], ["far3-va", 1], ["far4-va", 1]]);
  assert.deepEqual(geo.nearbyOrNearest(place, [place, close, far1], counts).map((x) => x.place.slug), ["close-va"], "within radius: unchanged behaviour");
  const fallback = geo.nearbyOrNearest(place, [place, far1, far2, far3, far4], counts);
  assert.deepEqual(fallback.map((x) => x.place.slug), ["far1-va", "far2-va", "far3-va"], "nearest three, nearest first");
  assert.ok(fallback.every((x) => x.distanceMi > 25));
  assert.deepEqual(geo.nearbyOrNearest(place, [place], counts), []);
});

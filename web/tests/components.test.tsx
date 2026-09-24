import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import CityPage from "../src/components/CityPage";
import GymCard from "../src/components/GymCard";
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

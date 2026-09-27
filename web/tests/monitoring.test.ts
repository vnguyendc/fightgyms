import assert from "node:assert/strict";
import { test } from "node:test";
import { formatRequestError } from "../src/lib/monitoring";

const request = { path: "/search?q=arlington%20muay%20thai", method: "GET", headers: { cookie: "secret=1", "x-forwarded-for": "203.0.113.9" } };
const context = {
  routerKind: "App Router" as const, routePath: "/search", routeType: "render" as const,
  renderSource: "react-server-components" as const, revalidateReason: "stale" as const, renderType: "dynamic" as const,
};

test("server error lines carry route, digest and message but never headers or query strings", () => {
  const err = Object.assign(new Error("fetch failed: gym_cards"), { digest: "1234567890" });
  const line = formatRequestError(err, request, context);
  assert.equal(line.event, "request_error");
  assert.equal(line.level, "error");
  assert.equal(line.message, "fetch failed: gym_cards");
  assert.equal(line.name, "Error");
  assert.equal(line.digest, "1234567890");
  assert.equal(line.method, "GET");
  assert.equal(line.path, "/search");
  assert.equal(line.route, "/search");
  assert.equal(line.routeType, "render");
  assert.equal(line.renderSource, "react-server-components");
  assert.equal(line.revalidateReason, "stale");
  assert.match(line.stack ?? "", /^Error: fetch failed: gym_cards/);
  const json = JSON.stringify(line);
  assert.doesNotMatch(json, /secret=1|203\.0\.113\.9|arlington|headers/);
});

test("non-Error throwables and missing digests still produce a complete line", () => {
  const line = formatRequestError("boom", { path: "/gyms", method: "GET", headers: {} }, { ...context, routeType: "route", revalidateReason: undefined });
  assert.equal(line.message, "boom");
  assert.equal(line.name, "string");
  assert.equal(line.digest, undefined);
  assert.equal(line.stack, undefined);
  assert.equal(line.path, "/gyms");
  assert.equal(line.revalidateReason, undefined);
});

test("stack traces are capped so one error cannot flood the log", () => {
  const err = new Error("deep");
  err.stack = "Error: deep\n" + "    at frame\n".repeat(1000);
  const line = formatRequestError(err, request, context);
  assert.ok((line.stack ?? "").length <= 2000);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCents, parseSubmission } from "../src/lib/submissions";
import { gym } from "./fixtures";

const live = { NODE_ENV: "production", VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-only-not-real" };
function unconfigured() {
  Object.assign(process.env, { NODE_ENV: "production" });
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SHOW_SAMPLE;
}
unconfigured();

function post(body: Record<string, string> | string, type = "application/x-www-form-urlencoded") {
  const text = typeof body === "string" ? body : new URLSearchParams(body).toString();
  return new Request("http://localhost:3000/api/submissions", { method: "POST", headers: { "content-type": type, "content-length": String(text.length) }, body: text });
}
const good = { gym: "test-gym", field: "trial_price", value: "$20", note: "first class", email: "" };
const url = (r: Response) => new URL(r.headers.get("location")!);

test("prices parse to cents within a sane range", () => {
  assert.equal(parseCents("$25"), 2500);
  assert.equal(parseCents("25.5"), 2550);
  assert.equal(parseCents(" 25.00 "), 2500);
  assert.equal(parseCents("1000"), 100000);
  assert.equal(parseCents("1,000"), 100000);
  assert.equal(parseCents("$1,000.00"), 100000);
  for (const bad of ["twenty", "0.50", "1001", "-5", "25.999", "$", "", "1e3"]) assert.equal(parseCents(bad), null, bad);
});

test("parsing enforces the allowlist, value rules, note and email limits, and the honeypot", () => {
  assert.deepEqual(parseSubmission(good), { ok: true, honeypot: false, input: { gym: "test-gym", field: "trial_price", value: "$20", cents: 2000, note: "first class", email: null } });
  assert.deepEqual(parseSubmission({ ...good, website_url: "http://spam.example" }), { ok: true, honeypot: true, gym: "test-gym" });
  assert.deepEqual(parseSubmission({ ...good, gym: "../etc" }), { ok: false, error: "gym" });
  assert.deepEqual(parseSubmission({ ...good, field: "google_rating" }), { ok: false, error: "field" });
  assert.deepEqual(parseSubmission({ ...good, value: "twenty" }), { ok: false, error: "value" });
  assert.deepEqual(parseSubmission({ ...good, field: "website", value: "javascript:alert(1)" }), { ok: false, error: "value" });
  assert.equal(parseSubmission({ ...good, field: "website", value: "https://example.com/prices" }).ok, true);
  assert.deepEqual(parseSubmission({ ...good, field: "other", value: "" }), { ok: false, error: "value" });
  assert.deepEqual(parseSubmission({ ...good, field: "other", value: "x".repeat(201) }), { ok: false, error: "value" });
  assert.deepEqual(parseSubmission({ ...good, note: "x".repeat(1001) }), { ok: false, error: "value" });
  assert.deepEqual(parseSubmission({ ...good, email: "not-an-email" }), { ok: false, error: "value" });
  const withEmail = parseSubmission({ ...good, email: "a@b.co" });
  assert.equal(withEmail.ok && !withEmail.honeypot ? withEmail.input.email : null, "a@b.co");
  assert.deepEqual(parseSubmission({ ...good, value: ["$20"] }), { ok: false, error: "value" });
  assert.deepEqual(parseSubmission({}), { ok: false, error: "gym" });
});

test("route refuses outside the live directory and never contacts the backend", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not be called"); });
  const route = await import("../src/app/api/submissions/route");
  assert.equal((await route.POST(post(good))).status, 503);
  Object.assign(process.env, { ...live, NODE_ENV: "development", SHOW_SAMPLE: "1" }); // demo mode
  assert.equal((await route.POST(post(good))).status, 503);
  assert.equal(fetchMock.mock.callCount(), 0);
  unconfigured();
});

test("route validates, looks up the gym, inserts a pending row and redirects with 303", async (t) => {
  Object.assign(process.env, live);
  delete process.env.SHOW_SAMPLE;
  const calls: { url: string; method: string; body: string }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const u = String(input instanceof Request ? input.url : input);
    calls.push({ url: u, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : "" });
    if (u.includes("/gym_cards")) return Response.json(u.includes("slug=eq.missing") ? null : gym);
    if (u.includes("/submissions")) return new Response(null, { status: 201 });
    return Response.json([]);
  });
  const route = await import("../src/app/api/submissions/route");
  let res = await route.POST(post(good));
  assert.equal(res.status, 303);
  assert.equal(url(res).pathname + url(res).search, "/claim?submitted=1&gym=test-gym");
  const insert = calls.find((c) => c.url.includes("/submissions"));
  assert.ok(insert && insert.method === "POST", "insert was sent");
  assert.deepEqual(JSON.parse(insert.body), { entity_type: "gym", entity_id: "test-gym", field: "trial_price", proposed_value: { value: "$20", cents: 2000 }, note: "first class", contact_email: null, status: "pending" });

  calls.length = 0;
  res = await route.POST(post({ ...good, website_url: "x" }));
  assert.equal(url(res).search, "?submitted=1&gym=test-gym");
  assert.ok(!calls.some((c) => c.url.includes("/submissions")), "honeypot never inserts");

  for (const [body, error] of [[{ ...good, field: "nope" }, "field"], [{ ...good, value: "free" }, "value"], [{ ...good, gym: "missing" }, "notfound&gym=missing"], [{}, "gym"]] as const) {
    assert.equal(url(await route.POST(post(body))).search, `?error=${error}`, error);
  }
  assert.equal(url(await route.POST(post(JSON.stringify(good), "application/json"))).search, "?submitted=1&gym=test-gym");
  assert.equal(url(await route.POST(post("[1,2]", "application/json"))).search, "?error=gym");
  assert.equal(url(await route.POST(post("not json", "application/json"))).search, "?error=gym");
  assert.equal((await route.POST(post({ ...good, note: "x".repeat(9000) }))).status, 413);

  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
    String(input instanceof Request ? input.url : input).includes("/submissions")
      ? new Response(JSON.stringify({ message: "denied" }), { status: 403 })
      : Response.json(gym));
  assert.equal(url(await route.POST(post(good))).search, "?error=1&gym=test-gym", "a failed insert is never a thank-you");
  unconfigured();
});

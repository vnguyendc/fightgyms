import assert from "node:assert/strict";
import { test } from "node:test";
import { insertClaim, parseClaim } from "../src/lib/claims";
import { gym } from "./fixtures";
import { TEST_USER, goLive, sessionCookie, unconfigured, userJson } from "./session";

unconfigured();

const ORIGIN = "http://localhost:3000";
function post(body: Record<string, string>, headers: Record<string, string> = {}) {
  const text = new URLSearchParams(body).toString();
  return new Request(`${ORIGIN}/api/claims`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "content-length": String(text.length), ...headers }, body: text });
}
const loc = (r: Response) => { const u = new URL(r.headers.get("location")!); return u.pathname + u.search; };
const good = { gym: "test-gym", role: "owner", note: "head coach" };
const signedIn = { cookie: sessionCookie(), origin: ORIGIN };

type Call = { url: string; method: string; body: string; auth: string | null };
function stub(t: import("node:test").TestContext, opts: { claimStatus?: number; user?: number; gymFound?: boolean } = {}) {
  const calls: Call[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : "", auth: headers.get("authorization") });
    if (url.includes("/auth/v1/user")) return (opts.user ?? 200) === 200 ? Response.json(userJson()) : new Response(JSON.stringify({ message: "invalid" }), { status: opts.user });
    if (url.includes("/gym_cards")) return Response.json(opts.gymFound === false ? null : gym);
    if (url.includes("/rest/v1/claims")) {
      const status = opts.claimStatus ?? 201;
      return status === 201 ? new Response(null, { status: 201 }) : new Response(JSON.stringify({ code: status === 409 ? "23505" : "42501", message: "refused" }), { status, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected ${url}`);
  });
  return calls;
}

test("parseClaim needs a slug and a known role, keeps the honeypot looking valid", () => {
  assert.deepEqual(parseClaim(good), { ok: true, honeypot: false, input: { gym: "test-gym", role: "owner", note: "head coach" } });
  assert.deepEqual(parseClaim({ ...good, note: "" }), { ok: true, honeypot: false, input: { gym: "test-gym", role: "owner", note: null } });
  assert.deepEqual(parseClaim({ ...good, website_url: "spam", role: "nope" }), { ok: true, honeypot: true, input: { gym: "test-gym", role: "other", note: null } });
  assert.deepEqual(parseClaim({ ...good, gym: "../x" }), { ok: false, error: "gym", gym: null });
  assert.deepEqual(parseClaim({ ...good, role: "ceo" }), { ok: false, error: "claim", gym: "test-gym" });
  assert.deepEqual(parseClaim({ ...good, note: "x".repeat(1001) }), { ok: false, error: "claim", gym: "test-gym" });
  assert.deepEqual(parseClaim({}), { ok: false, error: "gym", gym: null });
});

test("insertClaim maps a unique violation to duplicate and anything else to a thrown error", async (t) => {
  const responses = [new Response(null, { status: 201 }), new Response(JSON.stringify({ code: "23505", message: "dup" }), { status: 409, headers: { "content-type": "application/json" } }), new Response(JSON.stringify({ code: "42501", message: "rls" }), { status: 403, headers: { "content-type": "application/json" } })];
  t.mock.method(globalThis, "fetch", async () => responses.shift()!);
  goLive();
  try {
    const { requestClient } = await import("../src/lib/auth");
    const client = requestClient(new Request(ORIGIN))!.client;
    assert.equal(await insertClaim(client, "gym-1", TEST_USER.id, { gym: "test-gym", role: "owner", note: null }), "ok");
    assert.equal(await insertClaim(client, "gym-1", TEST_USER.id, { gym: "test-gym", role: "owner", note: null }), "duplicate");
    await assert.rejects(insertClaim(client, "gym-1", TEST_USER.id, { gym: "test-gym", role: "owner", note: null }), /could not be saved/);
  } finally { unconfigured(); }
});

test("claims route: 503 offline, sign-in required, same origin required, honeypot writes nothing", async (t) => {
  const calls = stub(t);
  const route = await import("../src/app/api/claims/route");
  assert.equal((await route.POST(post(good, signedIn))).status, 503);
  assert.equal(calls.length, 0);
  goLive();
  try {
    assert.equal(loc(await route.POST(post(good, { origin: ORIGIN }))), "/claim?error=signin&gym=test-gym", "no cookie");
    assert.equal(loc(await route.POST(post(good, { origin: ORIGIN, cookie: "sb-127-auth-token=base64-!!!" }))), "/claim?error=signin&gym=test-gym", "garbage cookie");
    assert.equal((await route.POST(post(good, { cookie: sessionCookie() }))).status, 403, "no origin");
    assert.equal((await route.POST(post(good, { cookie: sessionCookie(), origin: "https://evil.test" }))).status, 403);
    assert.ok(!calls.some((c) => c.url.includes("/rest/v1/claims")), "nothing written so far");
    assert.equal(loc(await route.POST(post({ ...good, website_url: "x" }, signedIn))), "/claim?claimed=1&gym=test-gym");
    assert.ok(!calls.some((c) => c.url.includes("/rest/v1/claims")), "honeypot never inserts");
    assert.equal(loc(await route.POST(post({ ...good, role: "ceo" }, signedIn))), "/claim?error=claim&gym=test-gym");
    assert.equal(loc(await route.POST(post({ ...good, gym: "../x" }, signedIn))), "/claim?error=notfound");
  } finally { unconfigured(); }
});

test("claims route: inserts as the user, treats a repeat as success, and never turns a refusal into a thank-you", async (t) => {
  goLive();
  try {
    let calls = stub(t);
    const route = await import("../src/app/api/claims/route");
    const res = await route.POST(post(good, signedIn));
    assert.equal(res.status, 303);
    assert.equal(loc(res), "/claim?claimed=1&gym=test-gym");
    const insert = calls.find((c) => c.url.includes("/rest/v1/claims"));
    assert.ok(insert && insert.method === "POST", "insert sent");
    assert.deepEqual(JSON.parse(insert.body), { entity_type: "gym", entity_id: "test-gym", user_id: TEST_USER.id, role: "owner", note: "head coach", status: "pending", plan: "free" });
    assert.match(insert.auth ?? "", /^Bearer eyJ/, "inserted with the user's own token, so rls applies");
    calls = stub(t, { claimStatus: 409 });
    assert.equal(loc(await route.POST(post(good, signedIn))), "/claim?claimed=1&gym=test-gym", "already claimed by this user");
    calls = stub(t, { claimStatus: 403 });
    assert.equal(loc(await route.POST(post(good, signedIn))), "/claim?error=claim&gym=test-gym");
    calls = stub(t, { gymFound: false });
    assert.equal(loc(await route.POST(post(good, signedIn))), "/claim?error=notfound&gym=test-gym");
    assert.ok(!calls.some((c) => c.url.includes("/rest/v1/claims")));
    calls = stub(t, { user: 401 });
    assert.equal(loc(await route.POST(post(good, signedIn))), "/claim?error=signin&gym=test-gym", "auth server rejects the token");
    assert.ok(!calls.some((c) => c.url.includes("/rest/v1/claims")));
  } finally { unconfigured(); }
});

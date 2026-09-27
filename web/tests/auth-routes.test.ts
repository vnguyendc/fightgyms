import assert from "node:assert/strict";
import { test } from "node:test";
import { COOKIE_NAME, goLive, sessionCookie, sessionJson, unconfigured } from "./session";

unconfigured();

function post(path: string, body: Record<string, string>, headers: Record<string, string> = {}) {
  const text = new URLSearchParams(body).toString();
  return new Request(`http://localhost:3000${path}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "content-length": String(text.length), ...headers }, body: text });
}
const loc = (r: Response) => { const u = new URL(r.headers.get("location")!); return u.pathname + u.search; };

type Call = { url: string; method: string; body: string };
function stub(t: import("node:test").TestContext, handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input instanceof Request ? input.url : input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : "" };
    calls.push(call);
    return handler(call);
  });
  return calls;
}

test("link route: refuses when not live, validates, never reveals whether an address exists", async (t) => {
  const calls = stub(t, () => { throw new Error("must not be called"); });
  const route = await import("../src/app/api/auth/link/route");
  assert.equal((await route.POST(post("/api/auth/link", { email: "a@b.co" }))).status, 503);
  goLive();
  try {
    assert.equal(loc(await route.POST(post("/api/auth/link", { email: "nope" }))), "/claim?error=email");
    assert.equal(loc(await route.POST(post("/api/auth/link", { email: "nope", gym: "test-gym" }))), "/claim?error=email&gym=test-gym");
    assert.equal(loc(await route.POST(post("/api/auth/link", { email: "a@b.co", gym: "test-gym", website_url: "spam" }))), "/claim?sent=1&gym=test-gym", "honeypot looks like success");
    assert.equal(calls.length, 0);
    assert.equal((await route.POST(post("/api/auth/link", { email: "a@b.co" }, { "content-length": "9000" }))).status, 413);
  } finally { unconfigured(); }
});

test("link route: sends the otp with the site redirect and reports send failures", async (t) => {
  goLive();
  try {
    let status = 200;
    const calls = stub(t, () => status === 200 ? Response.json({}) : new Response(JSON.stringify({ code: 429, msg: "For security purposes, you can only request this after 60 seconds." }), { status: 429, headers: { "content-type": "application/json" } }));
    const route = await import("../src/app/api/auth/link/route");
    const res = await route.POST(post("/api/auth/link", { email: "owner@siamstrike.example", gym: "test-gym" }));
    assert.equal(res.status, 303);
    assert.equal(loc(res), "/claim?sent=1&gym=test-gym");
    const otp = calls.find((c) => c.url.includes("/auth/v1/otp"));
    assert.ok(otp && otp.method === "POST", "otp requested");
    assert.equal(new URL(otp.url).searchParams.get("redirect_to"), "https://findfightgyms.com/claim?gym=test-gym");
    const body = JSON.parse(otp.body);
    assert.equal(body.email, "owner@siamstrike.example");
    assert.equal(body.create_user, true);
    assert.equal(loc(await route.POST(post("/api/auth/link", { email: "owner@siamstrike.example", gym: "../x" }))), "/claim?sent=1", "a bad slug is dropped, not echoed");
    assert.equal(new URL(calls.at(-1)!.url).searchParams.get("redirect_to"), "https://findfightgyms.com/claim");
    status = 429;
    assert.equal(loc(await route.POST(post("/api/auth/link", { email: "owner@siamstrike.example", gym: "test-gym" }))), "/claim?error=link&gym=test-gym");
  } finally { unconfigured(); }
});

test("confirm route: verifies the token hash, sets the session cookie, and only follows a safe next", async (t) => {
  const route = await import("../src/app/auth/confirm/route");
  const get = (q: string) => route.GET(new Request(`http://localhost:3000/auth/confirm${q}`));
  let res = await get("?token_hash=abc&type=email");
  assert.equal(res.status, 303);
  assert.equal(loc(res), "/claim");
  assert.equal(res.headers.getSetCookie().length, 0, "no cookies outside live mode");
  goLive();
  try {
    let ok = true;
    const calls = stub(t, (c) => c.url.includes("/auth/v1/verify") ? (ok ? Response.json(sessionJson()) : new Response(JSON.stringify({ code: 403, msg: "Token has expired or is invalid" }), { status: 403, headers: { "content-type": "application/json" } })) : Response.json({}));
    assert.equal(loc(await get("")), "/claim?error=auth");
    assert.equal(loc(await get("?token_hash=abc&type=sms")), "/claim?error=auth");
    assert.equal(calls.length, 0);
    res = await get("?token_hash=abc&type=email&next=" + encodeURIComponent("https://findfightgyms.com/claim?gym=test-gym"));
    assert.equal(loc(res), "/claim?gym=test-gym");
    const verify = calls.find((c) => c.url.includes("/auth/v1/verify"));
    assert.ok(verify && verify.method === "POST");
    assert.deepEqual([JSON.parse(verify.body).token_hash, JSON.parse(verify.body).type], ["abc", "email"]);
    const set = res.headers.getSetCookie();
    assert.ok(set.some((c) => c.startsWith(`${COOKIE_NAME}=`) && /HttpOnly/.test(c) && /SameSite=lax/i.test(c) && /Secure/.test(c)), set.join("\n"));
    assert.equal(loc(await get("?token_hash=abc&type=magiclink&next=https://evil.test/claim")), "/claim", "foreign next is dropped");
    ok = false;
    res = await get("?token_hash=abc&type=email&next=/claim?gym=test-gym");
    assert.equal(loc(res), "/claim?error=auth");
    assert.equal(res.headers.getSetCookie().length, 0, "a failed verification sets nothing");
  } finally { unconfigured(); }
});

test("signout route: clears the session cookie and returns to /claim", async (t) => {
  const route = await import("../src/app/api/auth/signout/route");
  assert.equal((await route.POST(post("/api/auth/signout", {}))).status, 503);
  goLive();
  try {
    const calls = stub(t, (c) => c.url.includes("/auth/v1/logout") ? new Response(null, { status: 204 }) : Response.json({}));
    const res = await route.POST(post("/api/auth/signout", {}, { cookie: sessionCookie() }));
    assert.equal(res.status, 303);
    assert.equal(loc(res), "/claim");
    assert.ok(calls.some((c) => c.url.includes("/auth/v1/logout")), "server session revoked");
    assert.ok(res.headers.getSetCookie().some((c) => c.startsWith(`${COOKIE_NAME}=`) && /Max-Age=0/.test(c)), "cookie cleared");
  } finally { unconfigured(); }
});

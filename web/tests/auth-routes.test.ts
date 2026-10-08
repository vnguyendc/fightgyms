import assert from "node:assert/strict";
import { test } from "node:test";
import { COOKIE_NAME, goLive, sessionCookie, sessionJson, unconfigured } from "./session";

process.env.NEXT_PUBLIC_SITE_URL = "https://www.findfightgyms.com";
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
    assert.equal(new URL(otp.url).searchParams.get("redirect_to"), "https://www.findfightgyms.com/claim?gym=test-gym");
    const body = JSON.parse(otp.body);
    assert.equal(body.email, "owner@siamstrike.example");
    assert.equal(body.create_user, true);
    assert.equal(loc(await route.POST(post("/api/auth/link", { email: "owner@siamstrike.example", gym: "../x" }))), "/claim?sent=1", "a bad slug is dropped, not echoed");
    assert.equal(new URL(calls.at(-1)!.url).searchParams.get("redirect_to"), "https://www.findfightgyms.com/claim");
    status = 429;
    assert.equal(loc(await route.POST(post("/api/auth/link", { email: "owner@siamstrike.example", gym: "test-gym" }))), "/claim?error=link&gym=test-gym");
  } finally { unconfigured(); }
});

test("confirm route: verifies the token hash, sets the session cookie, and only follows a safe next", async (t) => {
  const route = await import("../src/app/auth/confirm/route");
  const get = (q: string) => route.GET(new Request(`https://www.findfightgyms.com/auth/confirm${q}`));
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
    res = await get("?token_hash=abc&type=email&next=" + encodeURIComponent("https://www.findfightgyms.com/claim?gym=test-gym"));
    assert.equal(loc(res), "/claim?gym=test-gym");
    const verify = calls.find((c) => c.url.includes("/auth/v1/verify"));
    assert.ok(verify && verify.method === "POST");
    assert.deepEqual([JSON.parse(verify.body).token_hash, JSON.parse(verify.body).type], ["abc", "email"]);
    const set = res.headers.getSetCookie();
    assert.ok(set.some((c) => c.startsWith(`${COOKIE_NAME}=`) && /HttpOnly/.test(c) && /SameSite=lax/i.test(c) && /Secure/.test(c)), set.join("\n"));
    assert.equal(loc(await get("?token_hash=abc&type=magiclink&next=https://evil.test/claim")), "/claim", "foreign next is dropped");
    ok = false;
    res = await get("?token_hash=abc&type=email&next=/claim?gym=test-gym");
    assert.equal(loc(res), "/claim?error=auth&gym=test-gym");
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


test("production auth requires an explicit matching public origin before contacting Supabase", async (t) => {
  const calls = stub(t, () => Response.json({}));
  const route = await import("../src/app/api/auth/link/route");
  const confirm = await import("../src/app/auth/confirm/route");
  goLive();
  try {
    for (const origin of [undefined, "", "http://localhost:3000", "https://findfightgyms.com", "https://evil.test", "https://www.findfightgyms.com/claim"]) {
      if (origin === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
      else process.env.NEXT_PUBLIC_SITE_URL = origin;
      assert.equal((await route.POST(post("/api/auth/link", { email: "owner@siamstrike.example" }))).status, 503, "unsafe or missing origin refuses to send");
      const response = await confirm.GET(new Request("https://www.findfightgyms.com/auth/confirm?token_hash=fixture&type=email"));
      assert.equal(response.status, 503, "unsafe config refuses verification too");
      assert.equal(response.headers.getSetCookie().length, 0);
    }
    assert.equal(calls.length, 0);
  } finally { process.env.NEXT_PUBLIC_SITE_URL = "https://www.findfightgyms.com"; unconfigured(); }
});

test("production links and response redirects ignore internal and hostile request hosts", async (t) => {
  const route = await import("../src/app/api/auth/link/route");
  const confirm = await import("../src/app/auth/confirm/route");
  const calls = stub(t, c => c.url.includes("/auth/v1/verify") ? Response.json(sessionJson()) : Response.json({}));
  goLive();
  try {
    for (const host of ["http://localhost:3000", "https://evil.test", "https://preview.example"]) {
      const request = post("/api/auth/link", { email: "owner@siamstrike.example", gym: "test-gym" }, { host: "evil.test", "x-forwarded-host": "evil.test", "x-forwarded-proto": "http" });
      const response = await route.POST(new Request(host + "/api/auth/link", request));
      assert.equal(new URL(response.headers.get("location")!).origin, "https://www.findfightgyms.com");
      const otp = calls.findLast(c => c.url.includes("/auth/v1/otp"))!;
      assert.equal(new URL(otp.url).searchParams.get("redirect_to"), "https://www.findfightgyms.com/claim?gym=test-gym");
      const count = calls.filter(c => c.url.includes("/auth/v1/verify")).length;
      const callback = host + "/auth/confirm?token_hash=fixture&type=email&next=/claim?gym=test-gym";
      const canonicalized = await confirm.GET(new Request(callback));
      const destination = new URL(canonicalized.headers.get("location")!);
      assert.equal(destination.origin, "https://www.findfightgyms.com");
      assert.equal(destination.pathname, "/auth/confirm", "canonicalize before one-time token use");
      assert.equal(destination.search, new URL(callback).search);
      assert.equal(canonicalized.headers.getSetCookie().length, 0, "noncanonical response sets no host-bound session");
      assert.equal(calls.filter(c => c.url.includes("/auth/v1/verify")).length, count);
      const verified = await confirm.GET(new Request(destination));
      assert.equal(loc(verified), "/claim?gym=test-gym");
      assert.ok(verified.headers.getSetCookie().some(c => c.startsWith(COOKIE_NAME + "=")));
      assert.ok(!verified.headers.get("location")!.includes("token_hash"));
    }
  } finally { unconfigured(); }
});

test("local sign-in and confirmation preserve the loopback origin and selected gym", async (t) => {
  const route = await import("../src/app/api/auth/link/route");
  const confirm = await import("../src/app/auth/confirm/route");
  const calls = stub(t, c => c.url.includes("/auth/v1/verify") ? Response.json(sessionJson()) : Response.json({}));
  goLive();
  Object.assign(process.env, { NODE_ENV: "development" });
  delete process.env.NEXT_PUBLIC_SITE_URL;
  try {
    for (const origin of ["http://localhost:3000", "http://127.0.0.1:3100", "http://[::1]:3000"]) {
      const request = new Request(origin + "/api/auth/link", post("/api/auth/link", { email: "owner@siamstrike.example", gym: "test-gym" }));
      assert.equal((await route.POST(request)).status, 303);
      const next = new URL(calls.findLast(c => c.url.includes("/auth/v1/otp"))!.url).searchParams.get("redirect_to")!;
      assert.equal(next, origin + "/claim?gym=test-gym");
      const response = await confirm.GET(new Request(origin + "/auth/confirm?token_hash=fixture&type=email&next=" + encodeURIComponent(next)));
      assert.equal(loc(response), "/claim?gym=test-gym");
      assert.equal(new URL(response.headers.get("location")!).origin, origin);
      assert.ok(response.headers.getSetCookie().some(c => c.startsWith(COOKIE_NAME + "=") && /HttpOnly/.test(c) && /SameSite=Lax/i.test(c) && /Path=\//.test(c) && !/Secure/i.test(c)));
    }
    const count = calls.length;
    const external = new Request("https://evil.test/api/auth/link", post("/api/auth/link", { email: "owner@siamstrike.example" }));
    assert.equal((await route.POST(external)).status, 503);
    assert.equal(calls.length, count, "development never trusts an arbitrary request host");
  } finally { process.env.NEXT_PUBLIC_SITE_URL = "https://www.findfightgyms.com"; unconfigured(); }
});

test("malformed or expired links retain only safe gym context and never set a session", async (t) => {
  const route = await import("../src/app/auth/confirm/route");
  const calls = stub(t, () => Response.json({ code: "otp_expired", msg: "Token has expired or is invalid" }, { status: 403 }));
  goLive();
  try {
    const destination = encodeURIComponent("https://www.findfightgyms.com/claim?gym=test-gym");
    for (const query of ["", "token_hash=fixture&type=sms", "token_hash=&type=email", "token_hash=one&token_hash=two&type=email", "token_hash=fixture&type=email&type=signup"]) {
      const response = await route.GET(new Request("https://www.findfightgyms.com/auth/confirm?" + query + "&next=" + destination));
      assert.equal(loc(response), "/claim?error=auth&gym=test-gym");
      assert.equal(response.headers.getSetCookie().length, 0);
    }
    assert.equal(calls.length, 0, "malformed links never verify");
    const expired = await route.GET(new Request("https://www.findfightgyms.com/auth/confirm?token_hash=fixture&type=email&next=" + destination));
    assert.equal(loc(expired), "/claim?error=auth&gym=test-gym");
    assert.equal(expired.headers.getSetCookie().length, 0);
    const hostile = await route.GET(new Request("https://www.findfightgyms.com/auth/confirm?token_hash=fixture&type=email&next=" + encodeURIComponent("https://evil.test/claim?gym=test-gym")));
    assert.equal(loc(hostile), "/claim?error=auth");
  } finally { unconfigured(); }
});


test("preview deployments refuse production auth before sending or consuming tokens", async (t) => {
  const calls = stub(t, () => Response.json({}));
  const link = await import("../src/app/api/auth/link/route");
  const confirm = await import("../src/app/auth/confirm/route");
  goLive();
  process.env.VERCEL_ENV = "preview";
  try {
    assert.equal((await link.POST(post("/api/auth/link", { email: "owner@siamstrike.example" }))).status, 503);
    assert.equal((await confirm.GET(new Request("https://preview.example/auth/confirm?token_hash=fixture&type=email"))).status, 503);
    assert.equal(calls.length, 0);
  } finally { process.env.VERCEL_ENV = "production"; unconfigured(); }
});

test("successful verification discards external and ambiguous return URLs", async (t) => {
  const confirm = await import("../src/app/auth/confirm/route");
  stub(t, () => Response.json(sessionJson()));
  goLive();
  try {
    for (const next of ["https://evil.test/claim?gym=test-gym", "//evil.test/claim", "https://www.findfightgyms.com.evil.test/claim", "javascript:alert(1)", "/claim?gym=test-gym&gym=other", "/claim?gym=test-gym#fragment", "/claim?gym=test-gym&next=https://evil.test", "/gym/test-gym"]) {
      const response = await confirm.GET(new Request("https://www.findfightgyms.com/auth/confirm?token_hash=fixture&type=email&next=" + encodeURIComponent(next)));
      assert.equal(new URL(response.headers.get("location")!).origin, "https://www.findfightgyms.com");
      assert.equal(loc(response), "/claim");
    }
  } finally { unconfigured(); }
});

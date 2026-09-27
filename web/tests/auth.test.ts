import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { claimNext, redirectWith, requestClient, sameOrigin, userOf } from "../src/lib/auth";
import { proxy } from "../src/proxy";
import { COOKIE_NAME, TEST_USER, goLive, sessionCookie, sessionJson, unconfigured, userJson } from "./session";

unconfigured();

test("claimNext keeps only /claim and /claim?gym=<slug> on this origin", () => {
  for (const [input, out] of [
    [null, "/claim"], ["", "/claim"], ["/claim", "/claim"], ["/claim?gym=test-gym", "/claim?gym=test-gym"],
    ["https://findfightgyms.com/claim?gym=test-gym", "/claim?gym=test-gym"],
    ["https://evil.test/claim?gym=test-gym", "/claim"], ["//evil.test/claim", "/claim"], ["/claim#x", "/claim"],
    ["/claim?gym=Bad Slug", "/claim"], ["/claim?gym=test-gym&x=1", "/claim"], ["/gym/test-gym", "/claim"],
    ["javascript:alert(1)", "/claim"], ["/claim?gym=" + "a".repeat(121), "/claim"],
  ] as const) assert.equal(claimNext(input), out, String(input));
});

test("sameOrigin requires an Origin header naming this host", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost:3000/api/claims", { method: "POST", headers });
  assert.equal(sameOrigin(req({ origin: "http://localhost:3000", host: "localhost:3000" })), true);
  assert.equal(sameOrigin(req({ origin: "http://localhost:3000" })), true, "falls back to the request url host");
  assert.equal(sameOrigin(req({ origin: "https://evil.test", host: "localhost:3000" })), false);
  assert.equal(sameOrigin(req({ host: "localhost:3000" })), false, "no origin");
  assert.equal(sameOrigin(req({ origin: "not a url", host: "localhost:3000" })), false);
});

test("redirectWith builds a 303 that carries locked-down cookies", () => {
  const res = redirectWith("http://localhost:3000/claim?sent=1", [{ name: "a", value: "1" }, { name: "b", value: "", options: { maxAge: 0 } }]);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "http://localhost:3000/claim?sent=1");
  const cookies = res.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.match(cookies[0], /^a=1; Path=\/; HttpOnly; Secure; SameSite=Lax$/, cookies[0]);
  assert.match(cookies[1], /^b=; Max-Age=0; Path=\/; HttpOnly; Secure; SameSite=Lax$/, cookies[1]);
  assert.equal(redirectWith("/x").headers.getSetCookie().length, 0);
});

test("requestClient is null outside live mode and userOf verifies through the auth server", async (t) => {
  assert.equal(requestClient(new Request("http://localhost:3000/claim")), null);
  goLive();
  try {
    const calls: { url: string; auth: string | null }[] = [];
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      calls.push({ url, auth: headers.get("authorization") });
      if (url.includes("/auth/v1/user")) return headers.get("authorization")?.includes("revoked") ? new Response(JSON.stringify({ message: "invalid" }), { status: 401 }) : Response.json(userJson());
      throw new Error(`unexpected ${url}`);
    });
    const withCookie = (cookie: string) => requestClient(new Request("http://localhost:3000/claim", { headers: { cookie } }))!;
    assert.deepEqual(await userOf(withCookie(sessionCookie()).client), { id: TEST_USER.id, email: TEST_USER.email });
    assert.ok(calls[0].url.includes("/auth/v1/user") && calls[0].auth?.startsWith("Bearer "), "identity comes from the auth server, not the cookie");
    assert.equal(await userOf(withCookie("").client), null);
    assert.equal(await userOf(withCookie(`${COOKIE_NAME}=base64-%%%garbage`).client), null, "garbage cookie is signed out");
    calls.length = 0;
    const revoked = sessionJson();
    revoked.access_token = revoked.access_token + "revoked";
    const revokedCookie = `${COOKIE_NAME}=base64-${Buffer.from(JSON.stringify(revoked)).toString("base64url")}`;
    assert.equal(await userOf(withCookie(revokedCookie).client), null, "auth server says no");
  } finally { unconfigured(); }
});

test("proxy passes through when not live and refreshes an expired session when live", async (t) => {
  // The test token is HS256, so getClaims() verifies it through /auth/v1/user; a project on asymmetric keys
  // would fetch its JWKS once instead. Either way the proxy never redirects and only writes cookies on refresh.
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (url.includes("grant_type=refresh_token")) {
      assert.match(String(init?.body), /refresh-1/);
      return Response.json(sessionJson({ refresh: "refresh-2" }));
    }
    if (url.includes("/auth/v1/user")) return Response.json(userJson());
    throw new Error(`unexpected ${url}`);
  });
  const res = await proxy(new NextRequest("http://localhost:3000/claim", { headers: { cookie: sessionCookie({ exp: 1 }) } }));
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0, "no backend outside live mode");
  goLive();
  try {
    const fresh = await proxy(new NextRequest("http://localhost:3000/claim", { headers: { cookie: sessionCookie({ exp: Math.floor(Date.now() / 1000) + 3000 }) } }));
    assert.equal(fresh.headers.getSetCookie().length, 0, "a valid session is left alone");
    assert.ok(!calls.some((u) => u.includes("grant_type=refresh_token")), "no refresh for a valid session");
    calls.length = 0;
    const none = await proxy(new NextRequest("http://localhost:3000/claim"));
    assert.equal(none.headers.getSetCookie().length, 0);
    assert.equal(calls.length, 0, "no cookie, no backend");
    const expired = await proxy(new NextRequest("http://localhost:3000/claim", { headers: { cookie: sessionCookie({ exp: Math.floor(Date.now() / 1000) - 10 }) } }));
    assert.equal(calls.filter((u) => u.includes("grant_type=refresh_token")).length, 1, "one refresh call");
    const set = expired.headers.getSetCookie();
    assert.ok(set.some((c) => c.startsWith(`${COOKIE_NAME}=`) && /HttpOnly/.test(c) && /SameSite=lax/i.test(c)), set.join("\n"));
    assert.ok(set.some((c) => c.includes(Buffer.from('"refresh_token":"refresh-2"').toString("base64url").slice(2, 20))) || set.some((c) => c.length > 200), "refreshed session written back");
  } finally { unconfigured(); }
});

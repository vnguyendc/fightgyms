import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { COOKIE_NAME, goLive, sessionCookie, sessionJson, unconfigured, userJson } from "./session";

unconfigured();
const ORIGIN = "http://localhost:3000";
const good = { gym: "test-gym", name: "New name", address: "10 Main St", website: "https://gym.example/", phone: "202-555-0100", description: "Owner description", trial_action: "set", trial_price: "0", drop_in_action: "set", drop_in_price: "25.50", monthly_action: "keep", monthly_price: "" };
function post(body: unknown = good, headers: Record<string, string> = {}, form = false) {
  return new Request(`${ORIGIN}/api/owner-edit`, { method: "POST", headers: { "content-type": form ? "application/x-www-form-urlencoded" : "application/json", cookie: sessionCookie(), origin: ORIGIN, ...headers }, body: form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body) });
}
function stub(t: import("node:test").TestContext, code?: string) {
  const calls: { url: string; body: unknown; auth: string | null }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/auth/v1/user")) return Response.json(userJson());
    calls.push({ url, body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get("authorization") });
    if (url.includes("/rpc/edit_owned_gym")) return code ? Response.json({ code, message: "private DB diagnostic" }, { status: 400 }) : Response.json("test-gym");
    throw new Error(`unexpected ${url}`);
  });
  return calls;
}

test("owner form schema: strict strings, field limits, safe URLs, exact cents, explicit keep/set/clear", async () => {
  const { parseOwnerEdit } = await import("../src/lib/owner-edits");
  assert.deepEqual(parseOwnerEdit(good), { ok: true, gym: "test-gym", changes: { name: "New name", address: "10 Main St", website: "https://gym.example/", phone: "202-555-0100", description: "Owner description", prices: { trial: 0, drop_in: 2550 } } });
  const clear = parseOwnerEdit({ ...good, phone: "", description: "", website: "", monthly_action: "clear" });
  assert.ok(clear.ok);
  assert.equal(clear.changes.phone, null);
  assert.equal(clear.changes.website, null);
  assert.equal(clear.changes.description, null);
  assert.equal(clear.changes.prices.monthly, null);
  for (const changed of [{ gym: "../x" }, { name: "" }, { name: ["name"] }, { name: "x".repeat(161) }, { address: "x".repeat(241) }, { website: "https://user:pass@gym.example" }, { website: "javascript:alert(1)" }, { website: "https://gym.example\n.evil" }, { phone: "x".repeat(41) }, { phone: "<script>" }, { description: "x".repeat(2001) }, { description: {} }, { trial_price: "1e3" }, { trial_price: "1.001" }, { trial_price: "1000.01" }, { trial_price: "-1" }, { drop_in_price: "0" }, { trial_action: "bogus" }, { monthly_price: "20" }, { gym_id: "forged" }, { submitted_by: "forged" }, { status: "verified" }, { claimed: true }, { role: "owner" }]) assert.equal(parseOwnerEdit({ ...good, ...changed }).ok, false, JSON.stringify(changed));
  const missing = Object.fromEntries(Object.entries(good).filter(([key]) => key !== "name"));
  assert.equal(parseOwnerEdit(missing).ok, false);
});

test("owner route: live only, verified session, strict origin and bounded request; no writes for bad input", async (t) => {
  const calls = stub(t);
  const { POST } = await import("../src/app/api/owner-edit/route");
  assert.equal((await POST(post())).status, 503);
  goLive();
  try {
    assert.equal((await POST(post(good, { cookie: "" }))).status, 401);
    assert.equal((await POST(post(good, { cookie: "sb-127-auth-token=base64-!!!" }))).status, 401);
    for (const origin of ["", "https://evil.example", "https://localhost:3000", `${ORIGIN}/path`]) assert.equal((await POST(post(good, { origin }))).status, 403, origin);
    assert.equal((await POST(post({ ...good, description: "x".repeat(9000) }))).status, 413);
    assert.equal((await POST(post(good, { "content-type": "text/plain" }))).status, 415);
    for (const body of [{ ...good, gym_id: "other" }, { ...good, status: "verified" }, { ...good, role: "owner" }, { ...good, submitted_by: "other" }, { ...good, name: "" }, []]) assert.equal((await POST(post(body))).status, 400);
    const duplicate = post(good, {}, true);
    const dup = new Request(duplicate.url, { method: "POST", headers: duplicate.headers, body: `${await duplicate.text()}&name=forged` });
    assert.equal((await POST(dup)).status, 400);
    assert.equal(calls.length, 0);
  } finally { unconfigured(); }
});

test("owner route publishes via authenticated narrow RPC and invalidates public listings only after success", async (t) => {
  const cache = createRequire(import.meta.url)("next/cache") as typeof import("next/cache");
  const paths: unknown[][] = [];
  t.mock.method(cache, "revalidatePath", (...args: unknown[]) => { paths.push(args); });
  goLive();
  try {
    const calls = stub(t);
    const { POST } = await import("../src/app/api/owner-edit/route");
    const response = await POST(post(good, {}, true));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), `${ORIGIN}/claim?gym=test-gym&saved=1`);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/rpc\/edit_owned_gym$/);
    assert.match(calls[0].auth ?? "", /^Bearer eyJ/);
    assert.deepEqual(calls[0].body, { p_slug: "test-gym", p_changes: { name: "New name", address: "10 Main St", website: "https://gym.example/", phone: "202-555-0100", description: "Owner description", prices: { trial: 0, drop_in: 2550 } } });
    assert.ok(paths.some(p => p[0] === "/" && p[1] === "layout"));
    assert.ok(paths.some(p => p[0] === "/api/search-index"));
    paths.length = 0;
    for (const [code, status] of [["42501", 403], ["22023", 400], ["XX000", 500]] as const) {
      stub(t, code);
      const refused = await POST(post());
      assert.equal(refused.status, status, code);
      assert.equal(refused.headers.get("location"), null);
      assert.doesNotMatch(await refused.text(), /private DB diagnostic/);
    }
    assert.equal(paths.length, 0, "no invalidation on pending/rejected/other-gym/revoked or failed edits");
  } finally { unconfigured(); }
});

test("a cache failure after commit reports the saved edit honestly without inviting a duplicate submission", async (t) => {
  const cache = createRequire(import.meta.url)("next/cache") as typeof import("next/cache");
  t.mock.method(cache, "revalidatePath", () => { throw new Error("cache unavailable"); });
  goLive();
  try {
    const calls = stub(t);
    const { POST } = await import("../src/app/api/owner-edit/route");
    const response = await POST(post());
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), `${ORIGIN}/claim?gym=test-gym&saved=1&refresh=delayed`);
    assert.equal(calls.length, 1);
  } finally { unconfigured(); }
});


test("owner error responses preserve refreshed or cleared session cookies", async (t) => {
  goLive();
  try {
    const { POST } = await import("../src/app/api/owner-edit/route");
    for (const status of [400, 403, 401]) {
      t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("grant_type=refresh_token")) return status === 401
          ? Response.json({ error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }, { status: 400 })
          : Response.json(sessionJson({ refresh: "refresh-2" }));
        if (url.includes("/auth/v1/user")) return Response.json(userJson());
        if (url.includes("/rpc/edit_owned_gym")) return Response.json({ code: "42501", message: "revoked claim" }, { status: 403 });
        throw new Error(`unexpected ${url}`);
      });
      const response = await POST(post(status === 400 ? { ...good, name: "" } : good, { cookie: sessionCookie({ exp: 1 }) }));
      assert.equal(response.status, status);
      assert.equal(response.headers.get("location"), null);
      assert.ok(response.headers.getSetCookie().some(c => c.startsWith(`${COOKIE_NAME}=`) && /HttpOnly/.test(c)), `status ${status} must carry refreshed or removed cookie`);
    }
  } finally { unconfigured(); }
});

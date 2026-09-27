import assert from "node:assert/strict";
import { test } from "node:test";
import { readBody } from "../src/lib/forms";
import { parseNewGym } from "../src/lib/submissions";
import { TEST_USER, goLive, sessionCookie, unconfigured, userJson } from "./session";

unconfigured();

const ORIGIN = "http://localhost:3000";
function post(pairs: [string, string][], headers: Record<string, string> = {}) {
  const text = new URLSearchParams(pairs).toString();
  return new Request(`${ORIGIN}/api/submissions/gym`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "content-length": String(text.length), ...headers }, body: text });
}
const loc = (r: Response) => { const u = new URL(r.headers.get("location")!); return u.pathname + u.search; };
const good: Record<string, unknown> = { name: "Reston Muay Thai", address: "1800 Sunrise Valley Dr", city: "Reston", state: "va", website: "https://restonmt.example", instagram: "@RestonMT", styles: ["muay_thai", "kickboxing"], role: "owner", note: "opened in march" };
const pairs = (o: Record<string, unknown>): [string, string][] => Object.entries(o).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, String(x)] as [string, string]) : [[k, String(v)] as [string, string]]));
const signedIn = { cookie: sessionCookie(), origin: ORIGIN };

test("readBody keeps every value of a repeated form key", async () => {
  const body = await readBody(post([["styles", "muay_thai"], ["styles", "boxing"], ["name", "X"]]));
  assert.deepEqual(body, { styles: ["muay_thai", "boxing"], name: "X" });
});

test("parseNewGym normalizes state and handle, dedupes styles, and rejects by field", () => {
  const ok = parseNewGym(good);
  assert.ok(ok.ok && !ok.honeypot);
  assert.deepEqual(ok.input, { name: "Reston Muay Thai", address: "1800 Sunrise Valley Dr", city: "Reston", state: "VA", website: "https://restonmt.example/", instagram: "restonmt", styles: ["muay_thai", "kickboxing"], role: "owner", note: "opened in march" });
  assert.deepEqual(parseNewGym({ ...good, website_url: "spam" }), { ok: true, honeypot: true });
  const single = parseNewGym({ ...good, styles: "mma", website: "", instagram: "", note: "" });
  assert.ok(single.ok && !single.honeypot);
  assert.deepEqual([single.input.styles, single.input.website, single.input.instagram, single.input.note], [["mma"], null, null, null]);
  const dup = parseNewGym({ ...good, styles: ["muay_thai", "muay_thai", "bjj"] });
  assert.ok(dup.ok && !dup.honeypot && dup.input.styles.length === 2);
  for (const [patch, field] of [
    [{ name: "" }, "name"], [{ name: "x".repeat(161) }, "name"],
    [{ address: "Sunrise Valley Dr" }, "address"], [{ address: "PO Box 12" }, "address"], [{ address: "1 " + "x ".repeat(130) }, "address"],
    [{ city: "" }, "city"], [{ state: "Virginia" }, "state"], [{ state: "v1" }, "state"],
    [{ website: "javascript:alert(1)" }, "website"], [{ website: "ftp://x.test" }, "website"],
    [{ instagram: "has space" }, "instagram"], [{ instagram: "x".repeat(31) }, "instagram"],
    [{ styles: [] }, "styles"], [{ styles: ["muay_thai", "kickboxing", "boxing", "mma"] }, "styles"], [{ styles: ["karate"] }, "styles"],
    [{ role: "ceo" }, "role"], [{ note: "x".repeat(1001) }, "note"],
  ] as const) assert.deepEqual(parseNewGym({ ...good, ...patch }), { ok: false, field }, JSON.stringify(patch));
});

test("gym route: sign-in and origin required, field errors named, inserts a new_gym row as the user", async (t) => {
  const calls: { url: string; method: string; body: string; auth: string | null }[] = [];
  let insertStatus = 201;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : "", auth: headers.get("authorization") });
    if (url.includes("/auth/v1/user")) return Response.json(userJson());
    if (url.includes("/rest/v1/submissions")) return insertStatus === 201 ? new Response(null, { status: 201 }) : new Response(JSON.stringify({ code: "42501", message: "refused" }), { status: 403, headers: { "content-type": "application/json" } });
    throw new Error(`unexpected ${url}`);
  });
  const route = await import("../src/app/api/submissions/gym/route");
  assert.equal((await route.POST(post(pairs(good), signedIn))).status, 503);
  goLive();
  try {
    assert.equal(loc(await route.POST(post(pairs(good), { origin: ORIGIN }))), "/claim?error=signin");
    assert.equal((await route.POST(post(pairs(good), { cookie: sessionCookie() }))).status, 403);
    assert.equal(loc(await route.POST(post(pairs({ ...good, state: "Virginia" }), signedIn))), "/claim?error=gym&field=state");
    assert.ok(!calls.some((c) => c.url.includes("/rest/v1/submissions")), "nothing written yet");
    assert.equal(loc(await route.POST(post(pairs({ ...good, website_url: "x" }), signedIn))), "/claim?submitted=gym");
    assert.ok(!calls.some((c) => c.url.includes("/rest/v1/submissions")), "honeypot never inserts");
    const res = await route.POST(post(pairs(good), signedIn));
    assert.equal(loc(res), "/claim?submitted=gym");
    const insert = calls.find((c) => c.url.includes("/rest/v1/submissions"))!;
    assert.equal(insert.method, "POST");
    assert.deepEqual(JSON.parse(insert.body), {
      entity_type: "gym", entity_id: null, field: "new_gym",
      proposed_value: { name: "Reston Muay Thai", address: "1800 Sunrise Valley Dr", city: "Reston", state: "VA", website: "https://restonmt.example/", instagram: "restonmt", styles: ["muay_thai", "kickboxing"], role: "owner" },
      note: "opened in march", submitted_by: TEST_USER.id, contact_email: TEST_USER.email, status: "pending",
    });
    assert.match(insert.auth ?? "", /^Bearer eyJ/);
    insertStatus = 403;
    assert.equal(loc(await route.POST(post(pairs(good), signedIn))), "/claim?error=1");
  } finally { unconfigured(); }
});

test("getGymCardsByIds returns only listed, non-sample cards for the ids given", async (t) => {
  const { gym } = await import("./fixtures");
  goLive();
  try {
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      assert.equal(url.pathname.split("/").at(-1), "gym_cards");
      assert.match(url.searchParams.get("id") ?? "", /^in\.\(/);
      return Response.json([gym, { ...gym, id: "s", slug: "sample-x", is_sample: true }]);
    });
    const { getGymCardsByIds } = await import("../src/lib/data");
    assert.deepEqual((await getGymCardsByIds(["test-gym", "s"])).map((g) => g.slug), ["test-gym"]);
    assert.deepEqual(await getGymCardsByIds([]), []);
  } finally { unconfigured(); }
});

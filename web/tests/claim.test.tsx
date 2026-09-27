import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ClaimView, { type ClaimState } from "../src/components/ClaimView";
import * as page from "../src/app/claim/page";
import { gym } from "./fixtures";
import { TEST_USER, goLive, unconfigured } from "./session";

unconfigured();
const render = (state: ClaimState) => renderToStaticMarkup(<ClaimView state={state} />);

test("unconfigured and demo modes render the honest placeholder with no form", async () => {
  const html = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({ gym: "test-gym" }), params: Promise.resolve({}) }));
  assert.match(html, /not available yet/);
  assert.doesNotMatch(html, /<form|verified badge/i);
  assert.match(html, /href="\/gym\/test-gym"/);
  Object.assign(process.env, { NODE_ENV: "development", SHOW_SAMPLE: "1", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1", NEXT_PUBLIC_SUPABASE_ANON_KEY: "x" });
  try {
    assert.deepEqual(await page.resolveClaimState({}), { kind: "unavailable", gym: null });
  } finally { unconfigured(); }
  assert.deepEqual(page.metadata.robots, { index: false, follow: false });
  assert.equal(page.metadata.alternates?.canonical, "https://findfightgyms.com/claim");
});

test("query states win, and outside a request scope the page is signed out", async (t) => {
  goLive();
  try {
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => String(input instanceof Request ? input.url : input).includes("/gym_cards") ? Response.json(gym) : Response.json([]));
    assert.deepEqual(await page.resolveClaimState({ sent: "1", gym: "test-gym" }), { kind: "sent", gym: "test-gym" });
    assert.deepEqual(await page.resolveClaimState({ claimed: "1", gym: "../x" }), { kind: "claimed", gym: null });
    assert.deepEqual(await page.resolveClaimState({ submitted: "gym" }), { kind: "submitted-gym" });
    assert.deepEqual(await page.resolveClaimState({ submitted: "1", gym: "test-gym" }), { kind: "submitted", gym: "test-gym" });
    assert.deepEqual(await page.resolveClaimState({ error: "gym", field: "state" }), { kind: "error", code: "gym", field: "state", gym: null });
    assert.deepEqual(await page.resolveClaimState({ error: "claim", gym: "test-gym" }), { kind: "error", code: "claim", field: null, gym: "test-gym" });
    const signin = await page.resolveClaimState({ error: "signin", gym: "test-gym" });
    assert.equal(signin.kind, "signed-out");
    assert.ok(signin.kind === "signed-out" && signin.notice === "signin" && signin.gym?.slug === "test-gym");
    const plain = await page.resolveClaimState({});
    assert.deepEqual(plain, { kind: "signed-out", gym: null, gymSlug: null, notice: null });
    const auth = await page.resolveClaimState({ error: "auth" });
    assert.ok(auth.kind === "signed-out" && auth.notice === "auth");
  } finally { unconfigured(); }
});

test("signed-out view offers the magic link with the gym kept and a honeypot", () => {
  const html = render({ kind: "signed-out", gym, gymSlug: "test-gym", notice: "signin" });
  assert.match(html, /Claim Test gym/);
  assert.match(html, /Sign in first/);
  assert.match(html, /action="\/api\/auth\/link" method="post"/);
  assert.match(html, /name="gym" value="test-gym"/);
  assert.match(html, /<input type="email" required=""[^>]*name="email"\/>/);
  assert.match(html, /name="website_url"/);
  assert.doesNotMatch(html, /api\/submissions|upload|premium/i);
  const bare = render({ kind: "signed-out", gym: null, gymSlug: null, notice: null });
  assert.match(bare, /Gym updates/);
  assert.doesNotMatch(bare, /name="gym"/);
  for (const [notice, copy] of [["auth", /invalid or has expired/], ["link", /Wait a minute/], ["email", /valid email/]] as const) {
    assert.match(render({ kind: "signed-out", gym: null, gymSlug: null, notice }), copy);
  }
});

test("signed-in view shows the claim panel, own rows with status words, and the submit-a-gym form", () => {
  const claims = [{ id: "c1", entity_id: "other-gym", status: "verified", role: "owner", created_at: "2026-09-20T00:00:00Z" }];
  const submissions = [
    { id: "s1", entity_id: null, field: "new_gym", proposed_value: { name: "Reston Muay Thai" }, status: "pending", created_at: "2026-09-21T00:00:00Z" },
    { id: "s2", entity_id: "test-gym", field: "trial_price", proposed_value: { value: "$20" }, status: "rejected", created_at: "2026-09-22T00:00:00Z" },
  ];
  const other = { ...gym, id: "other-gym", slug: "other-gym", name: "Other gym" };
  const base = { kind: "signed-in" as const, user: TEST_USER, gymSlug: "test-gym", claims, submissions, gyms: [gym, other] };
  const html = render({ ...base, gym });
  assert.match(html, /Signed in as owner@siamstrike\.example/);
  assert.match(html, /action="\/api\/auth\/signout" method="post"/);
  assert.match(html, /action="\/api\/claims" method="post"/);
  assert.match(html, /name="gym" value="test-gym"/);
  assert.match(html, /<option value="owner">Owner<\/option>/);
  assert.match(html, /Other gym[\s\S]*verified/);
  assert.match(html, /Reston Muay Thai[\s\S]*under review/);
  assert.match(html, /Trial or intro price[\s\S]*Test gym[\s\S]*not approved/);
  assert.match(html, /id="submit"[\s\S]*action="\/api\/submissions\/gym" method="post"/);
  assert.match(html, /name="styles" value="muay_thai"/);
  assert.match(html, /name="styles" value="bjj"/);
  assert.match(html, /only Muay Thai and kickboxing pages are live/);
  assert.match(html, /checked by hand/);
  assert.doesNotMatch(html, /upload|premium/i);
  const already = render({ ...base, gym: other });
  assert.doesNotMatch(already, /action="\/api\/claims"/);
  assert.match(already, /already claimed Other gym[\s\S]*verified/i);
  const noGym = render({ ...base, gym: null, gymSlug: null, claims: [], submissions: [] });
  assert.doesNotMatch(noGym, /action="\/api\/claims"/);
  assert.match(noGym, /No claims yet/);
});

test("one-off panels carry the right copy and a back link", () => {
  assert.match(render({ kind: "sent", gym: "test-gym" }), /Check your email[\s\S]*expires in an hour[\s\S]*href="\/gym\/test-gym"/);
  assert.match(render({ kind: "claimed", gym: "test-gym" }), /Claim received[\s\S]*by hand/);
  assert.match(render({ kind: "submitted-gym" }), /Gym received/);
  assert.match(render({ kind: "submitted", gym: null }), /Thanks for the correction/);
  assert.match(render({ kind: "error", code: "gym", field: "state", gym: null }), /two-letter state code[\s\S]*href="\/claim#submit"/);
  assert.match(render({ kind: "error", code: "claim", field: null, gym: "test-gym" }), /could not be saved/);
  assert.match(render({ kind: "error", code: "value", field: null, gym: null }), /dollar amounts/);
  assert.match(render({ kind: "error", code: "zzz", field: null, gym: null }), /Something went wrong/);
  assert.match(render({ kind: "unavailable", gym: null }), /not available yet/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import Stripe from "stripe";
import { checkoutConfig, featuredUntil, GRACE_DAYS, syncFor, webhookConfig } from "../src/lib/featured";
import { unconfigured } from "./session";

unconfigured();

// fake values shaped like stripe ids; none is a real credential.
const env = {
  STRIPE_SECRET_KEY: "sk_test_notreal123", STRIPE_FEATURED_PRICE_ID: "price_notreal123", STRIPE_WEBHOOK_SECRET: "whsec_notreal123",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-not-real", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
};
const unix = (iso: string) => Date.parse(iso) / 1000;

test("featured_until is the new york day of period end plus grace, inclusive", () => {
  assert.equal(GRACE_DAYS, 3);
  assert.equal(featuredUntil(unix("2026-12-20T15:00:00Z")), "2026-12-23");
  // 02:00 utc on the 1st is still the previous evening in new york
  assert.equal(featuredUntil(unix("2027-01-01T02:00:00Z"), 0), "2026-12-31");
  assert.equal(featuredUntil(unix("2027-01-01T02:00:00Z")), "2027-01-03");
  assert.equal(featuredUntil(0), null);
  assert.equal(featuredUntil(Number.NaN), null);
});

test("sync reads the latest item period, the slug from subscription metadata, and expanded customers", () => {
  const sub = { id: "sub_1", status: "active", customer: { id: "cus_1" }, metadata: { gym_slug: "real-gym" },
    items: { data: [{ current_period_end: unix("2026-12-20T15:00:00Z") }, { current_period_end: unix("2026-12-25T15:00:00Z") }] } };
  assert.deepEqual(syncFor(sub), { slug: "real-gym", subscription: "sub_1", customer: "cus_1", status: "active", until: "2026-12-28" });
  assert.equal(syncFor({ ...sub, metadata: {} }, "from-session").slug, "from-session");
  assert.equal(syncFor({ ...sub, metadata: { gym_slug: "../x" } }).slug, null);
  assert.equal(syncFor({ ...sub, items: { data: [] } }).until, null);
  assert.equal(syncFor({ ...sub, customer: "cus_2" }).customer, "cus_2");
});

test("stripe config needs every value, and only well-formed ones", () => {
  assert.equal(checkoutConfig({}), null);
  assert.deepEqual(checkoutConfig(env), { secretKey: env.STRIPE_SECRET_KEY, priceId: env.STRIPE_FEATURED_PRICE_ID });
  assert.equal(checkoutConfig({ ...env, STRIPE_FEATURED_PRICE_ID: "prod_123" }), null);
  assert.equal(checkoutConfig({ ...env, STRIPE_SECRET_KEY: "pk_test_123" }), null, "a publishable key is not a secret key");
  assert.ok(webhookConfig(env));
  for (const k of ["STRIPE_WEBHOOK_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "STRIPE_SECRET_KEY"] as const) {
    assert.equal(webhookConfig({ ...env, [k]: "" }), null, k);
  }
});

test("checkout falls back to /for-gyms without stripe and refuses cross-site posts", async () => {
  const { POST } = await import("../src/app/api/stripe/checkout/route");
  const post = (origin = "https://www.findfightgyms.com", gym = "real-gym") => POST(new Request("https://www.findfightgyms.com/api/stripe/checkout", {
    method: "POST", headers: { origin, host: "www.findfightgyms.com", "content-type": "application/x-www-form-urlencoded" }, body: `gym=${gym}`,
  }));
  const res = await post();
  assert.equal(res.status, 303);
  assert.match(res.headers.get("location") ?? "", /\/for-gyms$/);
  assert.equal((await post("https://evil.test")).status, 403);
  assert.equal((await post(undefined, "..%2Fx")).status, 400);
});

test("webhook refuses without config, without or with a bad signature, and acknowledges unhandled events", async () => {
  const { POST } = await import("../src/app/api/stripe/webhook/route");
  const payload = JSON.stringify({ id: "evt_1", object: "event", type: "customer.created", data: { object: {} } });
  const send = (signature?: string) => POST(new Request("https://www.findfightgyms.com/api/stripe/webhook", {
    method: "POST", headers: signature ? { "stripe-signature": signature } : {}, body: payload,
  }));
  assert.equal((await send("t=1,v1=x")).status, 503);
  Object.assign(process.env, env);
  try {
    assert.equal((await send()).status, 400);
    assert.equal((await send("t=1,v1=deadbeef")).status, 400);
    const signed = Stripe.webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_WEBHOOK_SECRET });
    const res = await send(signed);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true, ignored: "customer.created" });
  } finally {
    for (const k of Object.keys(env)) delete process.env[k];
    unconfigured();
  }
});

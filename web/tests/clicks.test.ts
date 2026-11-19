import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClick } from "../src/lib/clicks";
import { salesEmail, salesPaymentLink } from "../src/lib/sales";
import { goLive, unconfigured } from "./session";

unconfigured();

test("click bodies accept a public slug and link type only", () => {
  assert.deepEqual(parseClick({ slug: "test-gym", type: "website" }), { slug: "test-gym", link: "website" });
  assert.deepEqual(parseClick({ slug: " test-gym ", type: " phone " }), { slug: "test-gym", link: "phone" });
  for (const body of [{ slug: "../x", type: "website" }, { slug: "test-gym", type: "maps" }, { slug: "test-gym", type: "https://evil.test" }, { slug: "", type: "website" }]) {
    assert.equal(parseClick(body), null);
  }
});

test("sales contact hides an unset, malformed or non-stripe target", () => {
  assert.equal(salesEmail(undefined), null);
  assert.equal(salesEmail("  owners@findfightgyms.com "), "owners@findfightgyms.com");
  assert.equal(salesEmail("not an email"), null);
  assert.equal(salesPaymentLink(undefined), null);
  assert.equal(salesPaymentLink("https://buy.stripe.com/abc"), "https://buy.stripe.com/abc");
  for (const value of ["http://buy.stripe.com/abc", "https://stripe.com.evil.test/abc", "https://user:pass@buy.stripe.com/abc", "javascript:alert(1)", "https://buy.stripe.com:443/abc"]) {
    assert.equal(salesPaymentLink(value), null, value);
  }
});

test("click route rejects cross-site and invalid bodies, and stores a valid click only when live", async (t) => {
  const { POST } = await import("../src/app/api/clicks/route");
  const post = (body: unknown, headers: Record<string, string> = {}) => POST(new Request("https://www.findfightgyms.com/api/clicks", {
    method: "POST",
    headers: { origin: "https://www.findfightgyms.com", host: "www.findfightgyms.com", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
  assert.equal((await post({ slug: "test-gym", type: "website" })).status, 204, "unconfigured still acknowledges the click");
  assert.equal((await post({ slug: "test-gym", type: "website" }, { origin: "https://evil.test" })).status, 403);
  assert.equal((await post({ slug: "../x", type: "website" })).status, 400);
  assert.equal((await post({ slug: "test-gym", type: "email" })).status, 400);
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(`${input instanceof Request ? input.url : input} ${String(init?.body ?? "")}`);
    return Response.json(null);
  });
  goLive();
  try {
    assert.equal((await post({ slug: "test-gym", type: "phone" })).status, 204);
    assert.ok(calls.some((c) => c.includes("/rpc/record_outbound_click") && c.includes('"p_slug":"test-gym"') && c.includes('"p_type":"phone"')), calls.join("\n"));
    assert.equal(calls.filter((c) => c.includes("test-gym")).length, 1);
  } finally { unconfigured(); }
});

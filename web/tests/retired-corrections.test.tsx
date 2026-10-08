import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ClaimView from "../src/components/ClaimView";
import { gym } from "./fixtures";
import { goLive, sessionCookie, unconfigured } from "./session";

unconfigured();
test("retired correction endpoint always returns 410 without reading the body or contacting a backend", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not contact backend"); });
  const { POST } = await import("../src/app/api/submissions/route");
  for (const live of [false, true]) {
    if (live) goLive();
    try {
      for (const cookie of ["", sessionCookie()]) {
        const req = new Request("http://localhost:3000/api/submissions", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: '{"gym":"test-gym","field":"other","value":"x"}' });
        const res = await POST(req);
        assert.equal(res.status, 410);
        assert.equal(res.headers.get("location"), null);
        assert.equal(req.bodyUsed, false);
      }
    } finally { unconfigured(); }
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("claim and public information pages describe direct editing and do not advertise corrections", async () => {
  const { default: About } = await import("../src/app/about/page");
  const { default: Privacy } = await import("../src/app/privacy/page");
  const about = renderToStaticMarkup(await About());
  const privacy = renderToStaticMarkup(await Privacy());
  assert.match(about, /publish immediately/i);
  assert.match(about, /owner-supplied[\s\S]*not independently checked/i);
  assert.match(privacy, /before and after[\s\S]*account ID/i);
  for (const html of [about, privacy, renderToStaticMarkup(<ClaimView state={{ kind: "unavailable", gym: gym.slug }} />), renderToStaticMarkup(<ClaimView state={{ kind: "signed-out", gym, gymSlug: gym.slug, notice: null }} />)]) assert.doesNotMatch(html, /correction box|your corrections|nothing is published automatically|when claims launch/i);
});

test("gym profile retains the claim entry point and removes the correction form and missing-price CTA", async (t) => {
  goLive();
  try {
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      const u = new URL(String(input instanceof Request ? input.url : input));
      const table = u.pathname.split("/").at(-1);
      if (table === "gym_cards") return Response.json(u.searchParams.has("slug") ? gym : [gym]);
      if (table === "gyms") return Response.json({ description: null, phone: null });
      if (table === "places") return Response.json(null);
      return Response.json([]);
    });
    const { default: Profile } = await import("../src/app/gym/[slug]/page");
    const html = renderToStaticMarkup(await Profile({ params: Promise.resolve({ slug: gym.slug }), searchParams: Promise.resolve({}) }));
    assert.match(html, /href="\/claim\?gym=test-gym"/);
    assert.doesNotMatch(html, /api\/submissions|#correct|Correct this listing|Know a price|Corrections/);
  } finally { unconfigured(); }
});

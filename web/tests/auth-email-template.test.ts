import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { gym } from "./fixtures";
import { goLive, sessionJson, TEST_USER, unconfigured, userJson } from "./session";

process.env.NEXT_PUBLIC_SITE_URL = "https://www.findfightgyms.com";
unconfigured();

// Fixture values only. Do not print the rendered verification link or cookies.
function templateLink(file: string, redirectTo: string, siteUrl: string): URL {
  const path = new URL(`../../supabase/templates/${file}.html`, import.meta.url);
  assert.ok(existsSync(path), `${file} template must be checked in`);
  const html = readFileSync(path, "utf8");
  const href = html.match(/href="([^"]+)"/)?.[1];
  assert.ok(href, "template has a verification link");
  return new URL(href.replaceAll("&amp;", "&")
    .replaceAll("{{ .TokenHash }}", "fixture-token")
    .replaceAll("{{ .RedirectTo }}", redirectTo)
    .replaceAll("{{ .SiteURL }}", siteUrl));
}

for (const template of ["magic-link", "confirmation", "local-auth"]) {
  test(`${template}: sign-in request through email verification to a pending claim keeps the selected gym`, async (t) => {
    const local = template === "local-auth";
    const origin = local ? "http://localhost:3000" : "https://www.findfightgyms.com";
    let redirectTo = "";
    let claim: Record<string, unknown> | undefined;
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/auth/v1/otp") {
        redirectTo = url.searchParams.get("redirect_to") ?? "";
        return Response.json({});
      }
      if (url.pathname === "/auth/v1/verify") return Response.json(sessionJson());
      if (url.pathname === "/auth/v1/user") return Response.json(userJson());
      if (url.pathname === "/rest/v1/gym_cards") return Response.json(gym);
      if (url.pathname === "/rest/v1/claims") {
        claim = JSON.parse(String(init?.body));
        return new Response(null, { status: 201 });
      }
      throw new Error("Unexpected backend endpoint");
    });
    const link = await import("../src/app/api/auth/link/route");
    const confirm = await import("../src/app/auth/confirm/route");
    const claims = await import("../src/app/api/claims/route");
    goLive();
    if (local) Object.assign(process.env, { NODE_ENV: "development" });
    try {
      const sent = await link.POST(new Request(origin + "/api/auth/link", {
        method: "POST", body: new URLSearchParams({ email: TEST_USER.email, gym: gym.slug }),
      }));
      assert.equal(sent.status, 303);
      assert.equal(redirectTo, origin + "/claim?gym=" + gym.slug);
      // Production verification must survive a stale hosted Site URL.
      const url = templateLink(template, redirectTo, "http://localhost:3000");
      assert.equal(url.origin, origin);
      assert.equal(url.pathname, "/auth/confirm");
      assert.equal(url.searchParams.get("next"), redirectTo);
      assert.equal(url.searchParams.get("type"), "email");
      const verified = await confirm.GET(new Request(url));
      const destination = new URL(verified.headers.get("location")!);
      assert.equal(destination.origin, origin);
      assert.equal(destination.pathname, "/claim");
      assert.equal(destination.searchParams.get("gym"), gym.slug);
      assert.equal(destination.searchParams.has("token_hash"), false);
      const cookies = verified.headers.getSetCookie();
      assert.ok(cookies.length > 0);
      const submitted = await claims.POST(new Request(origin + "/api/claims", {
        method: "POST", headers: { origin, cookie: cookies.map(c => c.split(";")[0]).join("; ") },
        body: new URLSearchParams({ gym: destination.searchParams.get("gym")!, role: "owner" }),
      }));
      assert.equal(submitted.status, 303);
      assert.equal(new URL(submitted.headers.get("location")!).searchParams.get("claimed"), "1");
      assert.equal(claim?.entity_id, gym.id);
      assert.equal(claim?.user_id, TEST_USER.id);
      assert.equal(claim?.status, "pending", "sign-in is not ownership verification");
    } finally { unconfigured(); }
  });
}

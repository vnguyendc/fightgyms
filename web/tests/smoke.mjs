import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

// Run after an unconfigured production build. No credentials or real backend needed.
assert.ok(!process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  "Smoke tests require a build with no Supabase config; do not use a live-data build.");
const port = process.env.SMOKE_PORT ?? "3108";
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", port], {
  env: { ...process.env, NODE_ENV: "production", VERCEL_ENV: "production", SHOW_SAMPLE: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
const exited = once(server, "exit");
async function request(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { "user-agent": "Googlebot" }, signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, html: await response.text(), headers: response.headers };
}
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server readiness timed out: ${logs}`)), 30000);
    const onData = chunk => {
      logs += chunk.toString();
      if (logs.includes("Ready in")) { clearTimeout(timeout); resolve(); }
    };
    server.stdout.on("data", onData);
    server.stderr.on("data", onData);
    server.once("error", error => { clearTimeout(timeout); reject(error); });
    server.once("exit", () => { clearTimeout(timeout); reject(new Error(`Server exited early: ${logs}`)); });
  });
  for (const path of ["/", "/gyms", "/gyms/all", "/events", "/claim?gym=sample-siam-strike-arlington-va", "/search?q=arlington"]) {
    const { status, html } = await request(path);
    assert.equal(status, 200, path);
    assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
    const canonical = `https://findfightgyms.com${path === "/" ? "" : path.split("?")[0]}`;
    assert.ok(html.includes(`<link rel="canonical" href="${canonical}"`), path);
    assert.doesNotMatch(html, /Siam Strike Muay Thai|DMV Fight Night|aggregateRating|action="\/api\/submissions"/);
    assert.match(html, path.startsWith("/claim") ? /not available yet/ : /Directory temporarily unavailable/);
    console.log(`PASS ${status} ${path}: self canonical, noindex, honest state`);
  }
  for (const path of ["/about", "/privacy"]) {
    const { status, html } = await request(path);
    assert.equal(status, 200, path);
    assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
    assert.ok(html.includes(`<link rel="canonical" href="https://findfightgyms.com${path}"`), path);
    assert.doesNotMatch(html, /Directory temporarily unavailable/);
    console.log(`PASS ${status} ${path}: static page renders without a backend`);
  }
  const home = await request("/");
  const homeHtml = home.html;
  assert.equal(home.headers.get("x-content-type-options"), "nosniff");
  assert.equal(home.headers.get("x-frame-options"), "DENY");
  assert.equal(home.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.ok(home.headers.get("permissions-policy"), "permissions-policy header");
  assert.equal(home.headers.get("x-powered-by"), null, "framework header removed");
  console.log("PASS /: security headers, no x-powered-by");
  assert.match(homeHtml, /href="\/about"/);
  assert.match(homeHtml, /href="\/privacy"/);
  assert.match(homeHtml, /"@type":"WebSite"/);
  assert.match(homeHtml, /"@type":"Organization"/);
  assert.match(homeHtml, /"@type":"SearchAction"/);
  console.log("PASS /: footer links about + privacy; site JSON-LD present");
  const missing = await request("/no-such-page");
  assert.equal(missing.status, 404);
  const directives = [...missing.html.matchAll(/<meta name="robots" content="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(directives.length >= 1 && directives.every((d) => d.startsWith("noindex")), `404 pages must never carry an index directive: ${directives}`);
  console.log("PASS 404: robots directives all noindex");
  for (const path of ["/gym/sample-siam-strike-arlington-va", "/gyms/va/arlington", "/gyms/va/arlington/muay-thai", "/gyms/all/page/2"]) {
    const { status, html } = await request(path);
    assert.equal(status, 404, path);
    assert.match(html, /noindex/);
    assert.doesNotMatch(html, /Siam Strike Muay Thai|aggregateRating/);
    console.log(`PASS ${status} ${path}: no fictional listing`);
  }
  const sitemap = await request("/sitemap.xml");
  assert.equal(sitemap.status, 200);
  assert.doesNotMatch(sitemap.html, /<loc>/);
  const robots = await request("/robots.txt");
  assert.equal(robots.status, 200);
  assert.doesNotMatch(robots.html, /Sitemap:/);
  console.log("PASS sitemap.xml: zero URLs; robots.txt: no sitemap advertised");
  const index = await request("/api/search-index");
  assert.equal(index.status, 200);
  assert.equal(index.html, '{"gyms":[],"places":[]}');
  console.log("PASS /api/search-index: empty index without a backend");
  const post = await fetch(`http://127.0.0.1:${port}/api/submissions`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "gym=x&field=other&value=y", redirect: "manual", signal: AbortSignal.timeout(15000),
  });
  assert.equal(post.status, 410);
  console.log("PASS 410 /api/submissions: correction requests retired");
  const edit = await fetch(`http://127.0.0.1:${port}/api/owner-edit`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}", redirect: "manual", signal: AbortSignal.timeout(15000),
  });
  assert.equal(edit.status, 503);
  console.log("PASS 503 /api/owner-edit: refuses without a live backend");
  const claim = await fetch(`http://127.0.0.1:${port}/api/claims`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "gym=x&role=owner", redirect: "manual", signal: AbortSignal.timeout(15000),
  });
  assert.equal(claim.status, 503);
  const confirm = await fetch(`http://127.0.0.1:${port}/auth/confirm?token_hash=x&type=email&next=https://evil.test/`, { redirect: "manual", signal: AbortSignal.timeout(15000) });
  assert.equal(confirm.status, 303);
  assert.match(confirm.headers.get("location") ?? "", /\/claim$/);
  assert.equal(confirm.headers.getSetCookie().length, 0);
  console.log("PASS claims and confirm refuse without a live backend, no cookies set");
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  if (server.exitCode === null) server.kill("SIGTERM");
  await exited;
}

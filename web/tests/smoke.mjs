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
  return { status: response.status, html: await response.text() };
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
  assert.equal(post.status, 503);
  console.log("PASS 503 /api/submissions: refuses without a live backend");
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  if (server.exitCode === null) server.kill("SIGTERM");
  await exited;
}

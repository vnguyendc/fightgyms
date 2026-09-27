import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_BODY, readBody } from "../src/lib/forms";
import { goLive, unconfigured } from "./session";

function streamed(chunks: string[], headers: Record<string, string> = {}, path = "/api/auth/link") {
  let reads = 0, cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (reads < chunks.length) controller.enqueue(new TextEncoder().encode(chunks[reads++]));
      else controller.close();
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const request = new Request(`http://localhost:3000${path}`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: stream, duplex: "half",
  } as RequestInit & { duplex: "half" });
  return { request, reads: () => reads, cancelled: () => cancelled };
}

test("oversized streams are cancelled at the byte limit regardless of Content-Length", async () => {
  for (const headers of [{}, { "content-length": "1" }] as Record<string, string>[]) {
    const input = streamed(["x=" + "a".repeat(MAX_BODY - 2), "b", "unread tail"], headers);
    assert.equal(await readBody(input.request), null);
    assert.equal(input.reads(), 2, "stop before reading the rest of the body");
    assert.equal(input.cancelled(), true);
  }
  const advertised = streamed(["unread"], { "content-length": String(MAX_BODY + 1) });
  assert.equal(await readBody(advertised.request), null);
  assert.equal(advertised.reads(), 0, "retain the header shortcut");
  assert.equal(advertised.cancelled(), true);
});

test("the exact byte boundary is accepted and UTF-8 bytes, not characters, are counted", async () => {
  const note = "é".repeat(4090) + "a";
  const body = JSON.stringify({ note });
  assert.equal(Buffer.byteLength(body), MAX_BODY);
  assert.deepEqual(await readBody(streamed([body], { "content-type": "application/json" }).request), { note });
  assert.equal(await readBody(streamed([body, " "], { "content-type": "application/json" }).request), null);
});

test("bounded form parsing preserves repeated fields, multipart strings, and file handling", async () => {
  const styles = Array.from({ length: 500 }, (_, i) => i % 2 ? "boxing" : "muay_thai");
  const encoded = new URLSearchParams(styles.map((style) => ["styles", style])).toString();
  assert.ok(Buffer.byteLength(encoded) <= MAX_BODY);
  assert.deepEqual(await readBody(streamed([encoded]).request), { styles });

  const form = new FormData();
  form.append("styles", "muay_thai");
  form.append("styles", "boxing");
  form.append("name", "Test gym");
  form.append("photo", new Blob(["test"]), "test.txt");
  const multipart = new Request("http://localhost:3000/api/submissions/gym", { method: "POST", body: form });
  assert.deepEqual(await readBody(multipart), { styles: ["muay_thai", "boxing"], name: "Test gym", photo: "" });
});

test("malformed JSON, non-object JSON, and malformed forms still produce an empty body", async () => {
  for (const body of ["not json", "[]", "null", "3"]) {
    assert.deepEqual(await readBody(streamed([body], { "content-type": "application/json" }).request), {});
  }
  assert.deepEqual(await readBody(streamed(["broken"], { "content-type": "multipart/form-data" }).request), {});
});

test("every body-consuming route returns 413 for oversized streamed bodies before backend calls", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not contact backend"); });
  goLive();
  try {
    const routes = [
      ["/api/auth/link", await import("../src/app/api/auth/link/route")],
      ["/api/claims", await import("../src/app/api/claims/route")],
      ["/api/submissions", await import("../src/app/api/submissions/route")],
      ["/api/submissions/gym", await import("../src/app/api/submissions/gym/route")],
    ] as const;
    for (const [path, route] of routes) {
      for (const headers of [{}, { "content-length": "1" }] as Record<string, string>[]) {
        const input = streamed(["x=" + "a".repeat(MAX_BODY - 2), "b", "unread tail"], headers, path);
        assert.equal((await route.POST(input.request)).status, 413, path);
        assert.equal(input.cancelled(), true, path);
      }
    }
    assert.equal(fetch.mock.callCount(), 0);
  } finally { unconfigured(); }
});

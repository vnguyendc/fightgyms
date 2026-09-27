/** Body handling shared by every POST route: bounded size, form-encoded or JSON, strings only. */
export const MAX_BODY = 8 * 1024;

export const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** null means oversized; malformed bodies retain the empty-object validation path. */
export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) {
    await request.body?.cancel().catch(() => {});
    return null;
  }
  try {
    const reader = request.body?.getReader();
    if (!reader) return {};
    const bytes = new Uint8Array(MAX_BODY);
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (size + value.byteLength > MAX_BODY) {
          await reader.cancel().catch(() => {});
          return null;
        }
        bytes.set(value, size);
        size += value.byteLength;
      }
    } finally { reader.releaseLock(); }
    const body = new Response(bytes.subarray(0, size), { headers: request.headers });
    if ((request.headers.get("content-type") ?? "").includes("application/json")) {
      const json: unknown = await body.json();
      return json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
    }
    const form = await body.formData();
    const out: Record<string, string | string[]> = {};
    for (const [k, v] of form.entries()) {
      const s = typeof v === "string" ? v : "";
      const prev = out[k];
      if (Array.isArray(prev)) prev.push(s);
      else out[k] = prev === undefined ? s : [prev, s];
    }
    return out;
  } catch {
    return {};
  }
}

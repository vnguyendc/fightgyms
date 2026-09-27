/** Body handling shared by every POST route: bounded size, form-encoded or JSON, strings only. */
export const MAX_BODY = 8 * 1024;

export const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function tooLarge(request: Request): boolean {
  return Number(request.headers.get("content-length") ?? 0) > MAX_BODY;
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    if ((request.headers.get("content-type") ?? "").includes("application/json")) {
      const json: unknown = await request.json();
      return json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
    }
    const form = await request.formData();
    return Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));
  } catch {
    return {};
  }
}

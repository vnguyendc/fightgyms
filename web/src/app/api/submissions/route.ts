import { getGymCard } from "@/lib/data";
import { runtimePolicy } from "@/lib/site";
import { insertSubmission, parseSubmission } from "@/lib/submissions";

const MAX_BODY = 8 * 1024;

async function readBody(request: Request): Promise<Record<string, unknown>> {
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

/**
 * Files a pending correction from a gym page. Never publishes, never updates directory tables,
 * never runs outside the live directory. Redirects are 303 so the browser GETs /claim after a POST.
 */
export async function POST(request: Request) {
  if (runtimePolicy().mode !== "live") return Response.json({ error: "Submissions are not available in this environment." }, { status: 503 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "Submission too large." }, { status: 413 });
  const back = (query: string) => Response.redirect(new URL(`/claim?${query}`, request.url), 303);
  const parsed = parseSubmission(await readBody(request));
  if (!parsed.ok) return back(`error=${parsed.error}`);
  if (parsed.honeypot) return back(parsed.gym ? `submitted=1&gym=${parsed.gym}` : "submitted=1");
  try {
    const card = await getGymCard(parsed.input.gym);
    if (!card) return back(`error=notfound&gym=${parsed.input.gym}`);
    await insertSubmission(card.id, parsed.input);
    return back(`submitted=1&gym=${card.slug}`);
  } catch {
    return back(`error=1&gym=${parsed.input.gym}`);
  }
}

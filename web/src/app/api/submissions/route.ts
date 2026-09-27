import { recordEvent } from "@/lib/analytics";
import { redirectWith, requestClient, userOf } from "@/lib/auth";
import { getGymCard } from "@/lib/data";
import { readBody } from "@/lib/forms";
import { runtimePolicy } from "@/lib/site";
import { insertSubmission, parseSubmission } from "@/lib/submissions";

/**
 * Files a pending correction from a gym page. Never publishes, never updates directory tables,
 * never runs outside the live directory. A signed-in visitor's row carries their user id; anyone else stays
 * anonymous, including a visitor with a broken cookie. Redirects are 303 so the browser GETs /claim after a POST.
 */
export async function POST(request: Request) {
  if (runtimePolicy().mode !== "live") return Response.json({ error: "Submissions are not available in this environment." }, { status: 503 });
  const body = await readBody(request);
  if (body === null) return Response.json({ error: "Submission too large." }, { status: 413 });
  const back = (query: string) => redirectWith(new URL(`/claim?${query}`, request.url));
  const parsed = parseSubmission(body);
  if (!parsed.ok) return back(`error=${parsed.error}`);
  if (parsed.honeypot) return back(parsed.gym ? `submitted=1&gym=${parsed.gym}` : "submitted=1");
  try {
    const card = await getGymCard(parsed.input.gym);
    if (!card) return back(`error=notfound&gym=${parsed.input.gym}`);
    const bound = requestClient(request);
    const user = bound && request.headers.get("cookie") ? await userOf(bound.client) : null;
    await insertSubmission(card.id, parsed.input, user && bound ? { client: bound.client, user } : undefined);
    await recordEvent("correction_submitted", { field: parsed.input.field }, request);
    return redirectWith(new URL(`/claim?submitted=1&gym=${card.slug}`, request.url), bound?.pending);
  } catch {
    return back(`error=1&gym=${parsed.input.gym}`);
  }
}

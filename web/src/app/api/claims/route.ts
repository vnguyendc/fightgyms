import { recordEvent } from "@/lib/analytics";
import { redirectWith, requestClient, sameOrigin, userOf } from "@/lib/auth";
import { insertClaim, parseClaim } from "@/lib/claims";
import { getGymCard } from "@/lib/data";
import { readBody, tooLarge } from "@/lib/forms";
import { runtimePolicy } from "@/lib/site";

/**
 * Files a pending claim as the signed-in user. Row-level security, not this file, decides what may be inserted.
 * A repeat claim on the same gym hits the unique index and reads as success. Redirects are 303.
 */
export async function POST(request: Request) {
  if (runtimePolicy().mode !== "live") return Response.json({ error: "Claims are not available in this environment." }, { status: 503 });
  if (tooLarge(request)) return Response.json({ error: "Request too large." }, { status: 413 });
  const parsed = parseClaim(await readBody(request));
  const back = (query: string) => redirectWith(new URL(`/claim?${query}`, request.url));
  if (!parsed.ok) return back(parsed.error === "gym" ? "error=notfound" : `error=claim&gym=${parsed.gym}`);
  const tail = `&gym=${parsed.input.gym}`;
  const bound = requestClient(request)!;
  const user = await userOf(bound.client);
  if (!user) return back(`error=signin${tail}`);
  if (!sameOrigin(request)) return Response.json({ error: "Cross-site request refused." }, { status: 403 });
  if (parsed.honeypot) return redirectWith(new URL(`/claim?claimed=1${tail}`, request.url), bound.pending);
  try {
    const card = await getGymCard(parsed.input.gym);
    if (!card) return back(`error=notfound${tail}`);
    await insertClaim(bound.client, card.id, user.id, parsed.input);
    await recordEvent("claim_submitted", { role: parsed.input.role }, request);
    return redirectWith(new URL(`/claim?claimed=1&gym=${card.slug}`, request.url), bound.pending);
  } catch {
    return back(`error=claim${tail}`);
  }
}

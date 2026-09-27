import { recordEvent } from "@/lib/analytics";
import { redirectWith, requestClient, sameOrigin, userOf } from "@/lib/auth";
import { readBody, tooLarge } from "@/lib/forms";
import { runtimePolicy } from "@/lib/site";
import { insertNewGym, parseNewGym } from "@/lib/submissions";

/** Files a gym that is not listed yet as a pending new_gym submission. Signed-in only; reviewed by hand. */
export async function POST(request: Request) {
  if (runtimePolicy().mode !== "live") return Response.json({ error: "Submissions are not available in this environment." }, { status: 503 });
  if (tooLarge(request)) return Response.json({ error: "Submission too large." }, { status: 413 });
  const back = (query: string) => redirectWith(new URL(`/claim?${query}`, request.url));
  const bound = requestClient(request)!;
  const user = await userOf(bound.client);
  if (!user) return back("error=signin");
  if (!sameOrigin(request)) return Response.json({ error: "Cross-site request refused." }, { status: 403 });
  const parsed = parseNewGym(await readBody(request));
  if (!parsed.ok) return back(`error=gym&field=${parsed.field}`);
  if (parsed.honeypot) return redirectWith(new URL("/claim?submitted=gym", request.url), bound.pending);
  try {
    await insertNewGym(bound.client, user, parsed.input);
    await recordEvent("gym_submitted", { styles: parsed.input.styles.length }, request);
    return redirectWith(new URL("/claim?submitted=gym", request.url), bound.pending);
  } catch {
    return back("error=1");
  }
}

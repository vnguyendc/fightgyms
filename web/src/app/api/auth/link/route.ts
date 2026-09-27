import { SLUG, redirectWith, requestClient } from "@/lib/auth";
import { readBody, str, tooLarge } from "@/lib/forms";
import { SITE, runtimePolicy } from "@/lib/site";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

/** Sends a magic link. The same "check your email" answer for known and unknown addresses; the honeypot gets it for free. */
export async function POST(request: Request) {
  if (runtimePolicy().mode !== "live") return Response.json({ error: "Sign-in is not available in this environment." }, { status: 503 });
  if (tooLarge(request)) return Response.json({ error: "Request too large." }, { status: 413 });
  const body = await readBody(request);
  const gym = SLUG.test(str(body.gym)) ? str(body.gym) : null;
  const tail = gym ? `&gym=${gym}` : "";
  const back = (query: string) => redirectWith(new URL(`/claim?${query}${tail}`, request.url));
  if (str(body.website_url)) return back("sent=1");
  const email = str(body.email);
  if (email.length > 254 || !EMAIL.test(email)) return back("error=email");
  const bound = requestClient(request)!;
  const { error } = await bound.client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: `${SITE.url}/claim${gym ? `?gym=${gym}` : ""}` },
  });
  if (error) return back("error=link");
  return redirectWith(new URL(`/claim?sent=1${tail}`, request.url), bound.pending);
}

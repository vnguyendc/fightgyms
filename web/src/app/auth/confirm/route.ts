import type { EmailOtpType } from "@supabase/supabase-js";
import { authOrigin, claimNext, redirectWith, requestClient } from "@/lib/auth";
import { runtimePolicy } from "@/lib/site";

const TYPES = new Set(["email", "magiclink", "signup"]);

/**
 * Target of the email templates: /auth/confirm?token_hash=…&type=email&next=…
 * Verifies server-side, sets the session cookie on this response, follows `next` only when it is /claim on this site.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (runtimePolicy().mode !== "live") return redirectWith(new URL("/claim", request.url));
  const origin = authOrigin(request);
  if (!origin) return Response.json({ error: "Sign-in is not configured in this environment." }, { status: 503 });
  // A one-use OTP must be consumed on the same host that receives its session cookie.
  // If an alias reaches this route, canonicalize before asking Supabase to verify it.
  if (url.origin !== origin) {
    const canonical = new URL(url.pathname + url.search, origin);
    return new Response(null, { status: 307, headers: {
      location: canonical.href,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    } });
  }
  const to = (path: string, pending: Parameters<typeof redirectWith>[1] = []) => redirectWith(new URL(path, origin), pending);
  const next = claimNext(url.searchParams.getAll("next").length === 1 ? url.searchParams.get("next") : null, origin);
  const gym = new URL(next, origin).searchParams.get("gym");
  const failure = `/claim?error=auth${gym ? `&gym=${gym}` : ""}`;
  const tokenHash = url.searchParams.get("token_hash") ?? "";
  const type = url.searchParams.get("type") ?? "";
  if (!tokenHash || !TYPES.has(type) || url.searchParams.getAll("token_hash").length !== 1 || url.searchParams.getAll("type").length !== 1) return to(failure);
  const bound = requestClient(request)!;
  const { error } = await bound.client.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash });
  if (error) return to(failure);
  return to(next, bound.pending);
}

import type { EmailOtpType } from "@supabase/supabase-js";
import { claimNext, redirectWith, requestClient } from "@/lib/auth";
import { runtimePolicy } from "@/lib/site";

const TYPES = new Set(["email", "magiclink", "signup"]);

/**
 * Target of the email templates: /auth/confirm?token_hash=…&type=email&next=…
 * Verifies server-side, sets the session cookie on this response, follows `next` only when it is /claim on this site.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const to = (path: string, pending: Parameters<typeof redirectWith>[1] = []) => redirectWith(new URL(path, request.url), pending);
  if (runtimePolicy().mode !== "live") return to("/claim");
  const tokenHash = url.searchParams.get("token_hash") ?? "";
  const type = url.searchParams.get("type") ?? "";
  if (!tokenHash || !TYPES.has(type)) return to("/claim?error=auth");
  const bound = requestClient(request)!;
  const { error } = await bound.client.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash });
  if (error) return to("/claim?error=auth");
  return to(claimNext(url.searchParams.get("next")), bound.pending);
}

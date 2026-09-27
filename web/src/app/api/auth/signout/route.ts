import { redirectWith, requestClient } from "@/lib/auth";
import { runtimePolicy } from "@/lib/site";

/** Revokes the server session when there is one and clears the cookies either way. */
export async function POST(request: Request) {
  if (runtimePolicy().mode !== "live") return Response.json({ error: "Sign-in is not available in this environment." }, { status: 503 });
  const bound = requestClient(request)!;
  await bound.client.auth.signOut();
  return redirectWith(new URL("/claim", request.url), bound.pending);
}

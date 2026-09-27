import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { cookieOptions } from "@/lib/auth";
import { runtimePolicy } from "@/lib/site";

/**
 * /claim is a server component and cannot write cookies, so an expired session is refreshed here and the
 * refreshed cookies ride the response. Never redirects, never gates, never runs on static pages (matcher).
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (runtimePolicy().mode !== "live") return response;
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: cookieOptions(),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set({ name, value, ...options });
      },
    },
  });
  await supabase.auth.getClaims();
  return response;
}

export const config = { matcher: ["/claim"] };

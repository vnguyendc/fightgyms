/**
 * Server-only session helpers. Imported by /claim, route handlers and the proxy; never by a client component
 * or a static page. Every client here is the public anon key plus the visitor's own cookies, so row-level
 * security is the boundary, not this file.
 */
import { createServerClient, parseCookieHeader, serializeCookieHeader, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SITE, runtimePolicy } from "./site";

export const SLUG = /^[a-z0-9-]{1,120}$/;

export interface SessionUser { id: string; email: string | null }
export interface CookieToSet { name: string; value: string; options?: CookieOptions }
export interface BoundClient { client: SupabaseClient; pending: CookieToSet[] }

/** The library defaults to httpOnly: false. Nothing client-side reads the session, so lock it down. */
export function cookieOptions(): CookieOptions {
  return { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" };
}

function env(): { url: string; key: string } | null {
  if (runtimePolicy().mode !== "live") return null;
  return { url: process.env.NEXT_PUBLIC_SUPABASE_URL!, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! };
}

/** A client over the request's Cookie header. Cookies it wants written pile up in `pending` for redirectWith(). */
export function requestClient(request: Request): BoundClient | null {
  const e = env();
  if (!e) return null;
  const pending: CookieToSet[] = [];
  const client = createServerClient(e.url, e.key, {
    cookieOptions: cookieOptions(),
    cookies: {
      getAll: () => parseCookieHeader(request.headers.get("cookie") ?? "").map((c) => ({ name: c.name, value: c.value ?? "" })),
      setAll: (list) => { pending.push(...list); },
    },
  });
  return { client, pending };
}

/** A client over Next's request cookies for a server component. It cannot write cookies; proxy.ts refreshes /claim. */
export async function pageClient(): Promise<SupabaseClient | null> {
  const e = env();
  if (!e) return null;
  let store: { getAll(): { name: string; value: string }[] };
  try {
    const { cookies } = await import("next/headers");
    store = await cookies();
  } catch {
    return null; // outside a request scope (tests, prerender) there is no session to read
  }
  return createServerClient(e.url, e.key, {
    cookieOptions: cookieOptions(),
    cookies: { getAll: () => store.getAll(), setAll: () => { /* server components cannot set cookies */ } },
  });
}

/** Verified identity or null. getClaims() checks the signature or asks the auth server; a cookie alone proves nothing. */
export async function userOf(client: SupabaseClient): Promise<SessionUser | null> {
  try {
    const { data } = await client.auth.getClaims();
    const claims = data?.claims;
    if (!claims?.sub) return null;
    return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
  } catch {
    return null;
  }
}

export async function currentUser(): Promise<{ user: SessionUser; client: SupabaseClient } | null> {
  const client = await pageClient();
  if (!client) return null;
  const user = await userOf(client);
  return user ? { user, client } : null;
}

/** Response.redirect() has immutable headers, so a redirect that must carry Set-Cookie is built by hand. */
export function redirectWith(url: URL | string, pending: CookieToSet[] = [], status = 303): Response {
  const headers = new Headers({ location: String(url) });
  for (const c of pending) headers.append("set-cookie", serializeCookieHeader(c.name, c.value, { ...cookieOptions(), ...c.options }));
  return new Response(null, { status, headers });
}

/** CSRF belt and braces on top of SameSite=Lax: the Origin header must name this host. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("host") ?? new URL(request.url).host;
  try { return new URL(origin).host === host; } catch { return false; }
}

/** Only "/claim" or "/claim?gym=<slug>" on this site's origin survive; everything else lands on /claim. */
export function claimNext(next: string | null | undefined): string {
  if (!next) return "/claim";
  try {
    const u = new URL(next, SITE.url);
    if (u.origin !== SITE.url || u.pathname !== "/claim" || u.hash) return "/claim";
    const keys = [...u.searchParams.keys()];
    if (keys.length === 0) return "/claim";
    const gym = u.searchParams.get("gym") ?? "";
    return keys.length === 1 && keys[0] === "gym" && SLUG.test(gym) ? `/claim?gym=${gym}` : "/claim";
  } catch {
    return "/claim";
  }
}

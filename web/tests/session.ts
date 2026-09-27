// Fake sessions for route and page tests. Nothing here is a real credential.
// The JWT is HS256-shaped and unsigned: auth-js getClaims() finds no asymmetric key id and falls back to
// getUser(), which every test stubs. The cookie name matches what @supabase/ssr derives from the test URL
// http://127.0.0.1:1 (project ref "127").
export const TEST_USER = { id: "00000000-0000-4000-8000-000000000001", email: "owner@siamstrike.example" };
export const COOKIE_NAME = "sb-127-auth-token";
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

export function jwt(claims: Record<string, unknown>): string {
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}.c2ln`;
}

export function userJson(user = TEST_USER) {
  return { id: user.id, email: user.email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-09-01T00:00:00Z" };
}

export function sessionJson({ exp = Math.floor(Date.now() / 1000) + 3600, user = TEST_USER, refresh = "refresh-1" } = {}) {
  const token = jwt({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", exp, iat: exp - 3600, session_id: "s1" });
  return { access_token: token, refresh_token: refresh, token_type: "bearer", expires_in: 3600, expires_at: exp, user: userJson(user) };
}

/** Cookie header value carrying a session, exactly as the ssr client would have written it. */
export function sessionCookie(opts: { exp?: number; user?: typeof TEST_USER; refresh?: string } = {}): string {
  const session = sessionJson(opts);
  return `${COOKIE_NAME}=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

export const live = { NODE_ENV: "production", VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-only-not-real" };
export function unconfigured() {
  Object.assign(process.env, { NODE_ENV: "production" });
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SHOW_SAMPLE;
}
export function goLive() {
  Object.assign(process.env, live);
  delete process.env.SHOW_SAMPLE;
}

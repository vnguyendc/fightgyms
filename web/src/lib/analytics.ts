import { track } from "@vercel/analytics/server";

/**
 * Conversion events. Property values are labels or counts, never user content or emails. Headers go to Vercel's
 * first-party endpoint so the event joins the visitor's session. Off Vercel the SDK only warns, so the round
 * trip is skipped; a tracking failure never fails the request.
 */
export async function recordEvent(name: string, props: Record<string, string | number>, request: Request): Promise<void> {
  if (!process.env.VERCEL) return;
  try {
    await track(name, props, { headers: request.headers });
  } catch (error) {
    console.warn(`analytics: ${name} not recorded`, error instanceof Error ? error.message : error);
  }
}

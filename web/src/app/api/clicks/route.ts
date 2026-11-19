import { createClient } from "@supabase/supabase-js";
import { recordEvent } from "@/lib/analytics";
import { sameOrigin } from "@/lib/auth";
import { parseClick } from "@/lib/clicks";
import { readBody } from "@/lib/forms";
import { runtimePolicy } from "@/lib/site";

/**
 * One outbound click: gym slug and link type, nothing else.
 * Analytics is best-effort. A tracking failure still returns 204 so the browser does not retry the beacon.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-site request refused." }, { status: 403 });
  const body = await readBody(request);
  if (body === null) return Response.json({ error: "Request too large." }, { status: 413 });
  const click = parseClick(body);
  if (!click) return Response.json({ error: "Invalid click." }, { status: 400 });
  await recordEvent("outbound_click", { slug: click.slug, link: click.link }, request);
  if (runtimePolicy().mode === "live") {
    try {
      const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { error } = await client.rpc("record_outbound_click", { p_slug: click.slug, p_type: click.link });
      if (error) console.warn("outbound click not stored");
    } catch {
      console.warn("outbound click not stored");
    }
  }
  return new Response(null, { status: 204 });
}

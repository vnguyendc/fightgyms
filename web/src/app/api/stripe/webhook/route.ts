import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import type Stripe from "stripe";
import { slugOrNull, syncFor, webhookConfig } from "@/lib/featured";
import { stripeClient } from "@/lib/stripe";

const HANDLED = new Set(["checkout.session.completed", "invoice.paid", "customer.subscription.deleted"]);
const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : v?.id ?? null);

/** Subscription id an event is about, plus a slug fallback from the checkout session. */
function subject(event: Stripe.Event): { subscription: string | null; slug: string | null } {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object;
      if (s.mode !== "subscription") return { subscription: null, slug: null };
      return { subscription: idOf(s.subscription), slug: slugOrNull(s.metadata?.gym_slug) ?? slugOrNull(s.client_reference_id) };
    }
    case "invoice.paid":
      return { subscription: idOf(event.data.object.parent?.subscription_details?.subscription), slug: slugOrNull(event.data.object.parent?.subscription_details?.metadata?.gym_slug) };
    case "customer.subscription.deleted":
      return { subscription: event.data.object.id, slug: null };
    default:
      return { subscription: null, slug: null };
  }
}

/**
 * Stripe → featured listing. Verifies the signature over the raw body, re-reads the subscription from Stripe
 * (so retries and out-of-order delivery converge on the current state) and hands it to
 * sync_featured_subscription (0011), which only ever moves featured_until forward. Replays are no-ops.
 * 2xx tells Stripe to stop; 5xx asks it to retry.
 */
export async function POST(request: Request) {
  const config = webhookConfig();
  if (!config) return Response.json({ error: "Stripe is not configured." }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing signature." }, { status: 400 });
  const raw = await request.text();
  const stripe = stripeClient(config.secretKey);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, config.webhookSecret);
  } catch {
    return Response.json({ error: "Invalid signature." }, { status: 400 });
  }
  if (!HANDLED.has(event.type)) return Response.json({ received: true, ignored: event.type });
  const { subscription, slug: fallback } = subject(event);
  if (!subscription) return Response.json({ received: true, ignored: "no subscription" });

  let result: string;
  let slug: string | null;
  try {
    const sync = syncFor(await stripe.subscriptions.retrieve(subscription), fallback);
    slug = sync.slug;
    const db = createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data, error } = await db.rpc("sync_featured_subscription", {
      p_slug: sync.slug ?? "", p_subscription: sync.subscription, p_customer: sync.customer,
      p_status: sync.status, p_until: sync.until, p_event: event.id,
    });
    if (error) throw new Error("rpc failed");
    result = String(data);
  } catch {
    console.warn(JSON.stringify({ event: "stripe_webhook_failed", type: event.type, id: event.id }));
    return Response.json({ error: "Not processed." }, { status: 500 });
  }
  if (result === "unknown_gym") console.warn(JSON.stringify({ event: "stripe_webhook_unknown_gym", type: event.type, id: event.id }));
  if (result === "featured" && slug) {
    try {
      revalidatePath(`/gym/${slug}`);
      revalidatePath("/gyms/[state]/[city]", "page");
      revalidatePath("/gyms/[state]/[city]/[style]", "page");
    } catch { /* pages still refresh on the hourly revalidate */ }
  }
  return Response.json({ received: true, result });
}

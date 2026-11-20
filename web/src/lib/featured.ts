/** Pure rules for paid featured listings. No Stripe or Supabase imports, so tests and pages can share them. */
const SLUG = /^[a-z0-9-]{1,120}$/;
import { featuredToday } from "./geo";

/** Days past the paid period end before the badge drops, so a renewal that settles a little late does not flicker. */
export const GRACE_DAYS = 3;

export type FeaturedEnv = Record<string, string | undefined>;

/** Checkout needs a secret key and a recurring price. Anything missing means the mailto fallback. */
export function checkoutConfig(env: FeaturedEnv = process.env): { secretKey: string; priceId: string } | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim() ?? "";
  const priceId = env.STRIPE_FEATURED_PRICE_ID?.trim() ?? "";
  if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]+$/.test(secretKey) || !/^price_[A-Za-z0-9]+$/.test(priceId)) return null;
  return { secretKey, priceId };
}

/** The webhook also needs its signing secret and a server-only service-role key. */
export function webhookConfig(env: FeaturedEnv = process.env) {
  const checkout = checkoutConfig(env);
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  if (!checkout || !webhookSecret.startsWith("whsec_") || !serviceKey || !/^https?:\/\//.test(url)) return null;
  return { secretKey: checkout.secretKey, webhookSecret, serviceKey, url };
}

/** Last day shown (inclusive, America/New_York) for a period that ends at `periodEnd` unix seconds. */
export function featuredUntil(periodEnd: number, graceDays = GRACE_DAYS): string | null {
  if (!Number.isFinite(periodEnd) || periodEnd <= 0) return null;
  return featuredToday(new Date((periodEnd + graceDays * 86_400) * 1000));
}

export const slugOrNull = (v: unknown): string | null => (typeof v === "string" && SLUG.test(v.trim()) ? v.trim() : null);

/** Minimal shape read from a Stripe subscription (API 2025+ keeps the period on each item). */
export type SubscriptionLike = {
  id: string;
  status: string;
  customer: string | { id: string } | null;
  metadata?: Record<string, string> | null;
  items?: { data?: { current_period_end?: number | null }[] } | null;
};

export type FeaturedSync = { slug: string | null; subscription: string; customer: string | null; status: string; until: string | null };

/** What the database should record for this subscription right now. */
export function syncFor(sub: SubscriptionLike, fallbackSlug: string | null = null): FeaturedSync {
  const ends = (sub.items?.data ?? []).map((i) => i.current_period_end ?? 0).filter((n) => n > 0);
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
  return {
    slug: slugOrNull(sub.metadata?.gym_slug) ?? fallbackSlug,
    subscription: sub.id,
    customer,
    status: sub.status,
    until: ends.length ? featuredUntil(Math.max(...ends)) : null,
  };
}

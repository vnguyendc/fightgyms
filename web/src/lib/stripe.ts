/** Server-only Stripe access. Never import from a client component. */
import Stripe from "stripe";
import { checkoutConfig } from "./featured";
import { money } from "./format";

export function stripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 10_000, appInfo: { name: "findfightgyms" } });
}

let memo: { at: number; label: Promise<string | null> } | null = null;

/**
 * "$49 per month" for the configured price, or null when Stripe is unset or unreachable (pages then fall back).
 * Memoized per server process for an hour, so a build that renders every gym page asks Stripe once.
 */
export function featuredPriceLabel(): Promise<string | null> {
  if (!memo || Date.now() - memo.at > 3_600_000) memo = { at: Date.now(), label: loadPriceLabel() };
  return memo.label;
}

async function loadPriceLabel(): Promise<string | null> {
  const config = checkoutConfig();
  if (!config) return null;
  try {
    const price = await stripeClient(config.secretKey).prices.retrieve(config.priceId);
    if (price.unit_amount == null || !price.recurring || price.currency !== "usd") return null;
    const { interval, interval_count: n } = price.recurring;
    return `${money(price.unit_amount)} ${n === 1 ? `per ${interval}` : `every ${n} ${interval}s`}`;
  } catch {
    console.warn("featured price not loaded");
    return null;
  }
}

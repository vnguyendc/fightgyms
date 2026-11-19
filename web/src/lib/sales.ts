/** Public build-time contact for founding listings. Invalid values are treated as unset. Changing either requires a redeploy. */

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export const FOUNDING_PRICE_CENTS = 14900;

export function salesEmail(value = process.env.NEXT_PUBLIC_SALES_EMAIL): string | null {
  const email = value?.trim() ?? "";
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

/** Stripe Checkout / Payment Link only. Anything else is hidden rather than rendered. */
export function salesPaymentLink(value = process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK): string | null {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const authority = raw.slice(raw.indexOf("://") + 3).split("/")[0];
    const host = url.hostname.toLowerCase();
    const stripe = host === "stripe.com" || host.endsWith(".stripe.com");
    // URL() drops the default :443, so an explicit port has to be rejected from the raw string.
    if (url.protocol !== "https:" || url.username || url.password || authority.includes(":") || !stripe) return null;
    return url.href;
  } catch {
    return null;
  }
}

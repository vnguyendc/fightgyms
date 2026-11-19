import type { Metadata, MetadataRoute } from "next";
import { LIVE_STYLES, STYLE_SLUG, type GymCard, type Place, type Style } from "./types";

const DEFAULT_ORIGIN = "https://findfightgyms.com";

/** Reject malformed overrides instead of publishing inconsistent canonical URLs. */
export function resolveSiteUrl(value?: string, production = process.env.NODE_ENV === "production"): string {
  if (!value?.trim()) return DEFAULT_ORIGIN;
  try {
    const url = new URL(value.trim());
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      (url.protocol !== "https:" && !(local && !production && url.protocol === "http:")) ||
      (production && (local || url.port !== ""))) throw new Error();
    return url.origin;
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL must be an HTTPS origin without credentials, path, query, or fragment (local HTTP is development-only).");
  }
}
export type RuntimePolicy = { mode: "live" | "demo" | "unavailable"; indexable: boolean };

/** Vercel preview builds also use NODE_ENV=production. Never index those. */
export function runtimePolicy(env: Record<string, string | undefined> = process.env): RuntimePolicy {
  const production = env.NODE_ENV === "production" && (!env.VERCEL_ENV || env.VERCEL_ENV === "production");
  const demo = env.SHOW_SAMPLE === "1";
  if (demo && !production) return { mode: "demo", indexable: false };
  let configured = false;
  try {
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    configured = ["https:", "http:"].includes(url.protocol) && !url.username && !url.password &&
      !!env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  } catch { /* Missing or invalid configuration fails closed. */ }
  return { mode: configured ? "live" : "unavailable", indexable: configured && production && !demo };
}

/** Escapes raw-text script delimiters without changing the JSON data. */
export function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function cityPath(place: Pick<Place, "state" | "slug">, style?: Style): string {
  const base = `/gyms/${place.state.toLowerCase()}/${place.slug.replace(/-[a-z]{2}$/, "")}`;
  return style ? `${base}/${STYLE_SLUG[style]}` : base;
}

/** A discipline page earns its own URL only when it lists a strict, non-empty subset of the city page; otherwise it duplicates it. */
export function distinctStyleListing(local: Pick<GymCard, "styles">[], style: Style): boolean {
  const matching = local.filter(g => g.styles.includes(style)).length;
  return matching > 0 && matching < local.length;
}

/** Live disciplines that deserve their own page for this city listing. */
export function distinctStyles(local: Pick<GymCard, "styles">[]): Style[] {
  return LIVE_STYLES.filter(style => distinctStyleListing(local, style));
}

/** A published monthly, drop-in, or trial amount, including a free trial. A blank price is not one. */
function listedPrice(gym: Pick<GymCard, "monthly_cents" | "drop_in_cents" | "trial_cents">): boolean {
  return (gym.monthly_cents ?? 0) > 0 || (gym.drop_in_cents ?? 0) > 0 || gym.trial_cents != null;
}

/**
 * Gyms Search Console already ranks and that earn clicks, with no price or schedule on the listing.
 * Carabao (Herndon) is address + Muay Thai only; its page was around position 6.7 with real clicks.
 * A slug here still needs a street address and a live discipline. Do not add a gym for having a website or a photo.
 */
const SEARCH_DEMAND = new Set(["carabao-muay-thai-llc-herndon-va"]);

function hasStreetAddress(gym: Pick<GymCard, "address">): boolean {
  return !!gym.address && /\d/.test(gym.address);
}

/** A gym page is indexable with a listed price, a class schedule, or a named Search Console earner that still has an address and a live discipline. A claim, photo, or website alone is not enough. */
export function gymIndexable(gym: GymCard): boolean {
  if (listedPrice(gym) || (gym.class_count ?? 0) > 0) return true;
  return SEARCH_DEMAND.has(gym.slug) && hasStreetAddress(gym) && gym.styles.some((s) => LIVE_STYLES.includes(s));
}

/** A city or discipline page is strong enough to index with 3+ gyms, or with at least one listed price. */
export function listingIndexable(gyms: GymCard[]): boolean {
  return gyms.length >= 3 || gyms.some(listedPrice);
}

function lastVerified(gyms: GymCard[]): string | undefined {
  return gyms.map(g => g.last_verified_at).filter((date): date is string =>
    !!date && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)))
    .sort().at(-1);
}

export function directorySitemap(places: Place[], gyms: GymCard[], indexable: boolean, hasEvents: boolean): MetadataRoute.Sitemap {
  if (!indexable) return [];
  const publicGyms = gyms.filter((g) => g.is_sample === false && !g.slug.startsWith("sample-") && g.styles.some(s => LIVE_STYLES.includes(s)));
  const populatedPlaces = places.filter(p => publicGyms.some(g => g.place_slug === p.slug));
  const paths = new Map<string, string | undefined>();
  if (publicGyms.length) paths.set("", undefined);
  if (populatedPlaces.length) paths.set("/gyms", undefined);
  for (const place of populatedPlaces) {
    const local = publicGyms.filter(g => g.place_slug === place.slug);
    if (listingIndexable(local)) paths.set(cityPath(place), lastVerified(local));
    for (const style of LIVE_STYLES) {
      const matching = local.filter(g => g.styles.includes(style));
      if (distinctStyleListing(local, style) && listingIndexable(matching)) paths.set(cityPath(place, style), lastVerified(matching));
    }
  }
  for (const gym of publicGyms) if (gymIndexable(gym)) paths.set(`/gym/${gym.slug}`, lastVerified([gym]));
  if (publicGyms.length) paths.set("/for-gyms", undefined);
  if (hasEvents) paths.set("/events", undefined);
  return [...paths].map(([path, lastModified]) => ({ url: `${SITE.url}${path}`, ...(lastModified ? { lastModified } : {}) }));
}

export function safeExternalUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function pageMetadata(path: string, title: string, description: string, hasContent = true, indexable = true): Metadata {
  const follow = runtimePolicy().indexable && hasContent;
  const index = follow && indexable;
  const url = `${SITE.url}${path === "/" ? "" : path}`;
  return { title, description, alternates: { canonical: url },
    openGraph: { title, description, url, siteName: SITE.name, type: "website" },
    robots: { index, follow } };
}

/** Next already adds `noindex` to not-found pages; emitting an explicit index directive as well leaves two conflicting tags. */
export function layoutRobots(policy: RuntimePolicy): Metadata["robots"] {
  return policy.indexable ? undefined : { index: false, follow: false };
}

/** BreadcrumbList for a site-relative trail; the last item is the current page. */
export function breadcrumbJsonLd(trail: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, item: `${SITE.url}${t.path}` })),
  };
}

export const SITE = {
  name: process.env.NEXT_PUBLIC_SITE_NAME ?? "FightGyms",
  tagline: "Find Muay Thai & kickboxing gyms.",
  url: resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL),
  description:
    "Browse Muay Thai and kickboxing gyms by city. Find gym websites, locations and available training details, then confirm current classes and prices with the gym.",
};

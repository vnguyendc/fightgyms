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

export function directorySitemap(places: Place[], gyms: GymCard[], indexable: boolean, hasEvents: boolean): MetadataRoute.Sitemap {
  if (!indexable) return [];
  const publicGyms = gyms.filter((g) => g.is_sample === false && !g.slug.startsWith("sample-") && g.styles.some(s => LIVE_STYLES.includes(s)));
  const populatedPlaces = places.filter(p => publicGyms.some(g => g.place_slug === p.slug));
  const paths = new Set<string>();
  if (publicGyms.length) paths.add("");
  if (populatedPlaces.length) paths.add("/gyms");
  for (const place of populatedPlaces) {
    const local = publicGyms.filter(g => g.place_slug === place.slug);
    if (!local.length) continue;
    paths.add(cityPath(place));
    for (const style of LIVE_STYLES) {
      if (local.some(g => g.styles.includes(style))) paths.add(cityPath(place, style));
    }
  }
  for (const gym of publicGyms) paths.add(`/gym/${gym.slug}`);
  if (hasEvents) paths.add("/events");
  // No fabricated lastModified timestamp: the view does not expose one.
  return [...paths].map(path => ({ url: `${SITE.url}${path}` }));
}

export function safeExternalUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function pageMetadata(path: string, title: string, description: string, hasContent = true): Metadata {
  const index = runtimePolicy().indexable && hasContent;
  const url = `${SITE.url}${path === "/" ? "" : path}`;
  return { title, description, alternates: { canonical: url },
    openGraph: { title, description, url, siteName: SITE.name, type: "website" },
    robots: { index, follow: index } };
}

export const SITE = {
  name: process.env.NEXT_PUBLIC_SITE_NAME ?? "FightGyms",
  tagline: "Find Muay Thai & kickboxing gyms.",
  url: resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL),
  description:
    "Browse Muay Thai and kickboxing gyms by city. Find gym websites, locations and available training details, then confirm current classes and prices with the gym.",
};

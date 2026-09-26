import type { GymCard, Place } from "./types";

type LatLng = { lat: number | null; lng: number | null };
const EARTH_MI = 3958.8;

/** Great-circle distance in miles. */
export function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MI * Math.asin(Math.sqrt(h));
}

function located(p: LatLng): p is { lat: number; lng: number } {
  return p.lat != null && p.lng != null && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

export function distanceMi(from: LatLng, to: LatLng): number | null {
  return located(from) && located(to) ? haversineMiles(from, to) : null;
}

type Completable = Pick<GymCard, "trial_cents" | "drop_in_cents" | "monthly_cents" | "class_count" | "photo_path" | "website">;

export function hasPrice(g: Pick<Completable, "trial_cents" | "drop_in_cents" | "monthly_cents">): boolean {
  return g.trial_cents != null || g.drop_in_cents != null || g.monthly_cents != null;
}

export function hasSchedule(g: Pick<Completable, "class_count">): boolean {
  return (g.class_count ?? 0) > 0;
}

/** 0–4: any price, a schedule, a photo, a website. Rows from before migration 0003 lack the price/schedule fields and score them as missing. */
export function completeness(g: Completable): number {
  return Number(hasPrice(g)) + Number(hasSchedule(g)) + Number(!!g.photo_path) + Number(!!g.website);
}

export function byName(a: Pick<GymCard, "name" | "slug">, b: Pick<GymCard, "name" | "slug">): number {
  return a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug);
}

/** Most complete first; name then slug break ties so the order is identical on every render. */
export function byCompleteness(a: GymCard, b: GymCard): number {
  return completeness(b) - completeness(a) || byName(a, b);
}

type Located<T> = { item: T; distanceMi: number };

/** Nearest first. Items without coordinates are dropped. */
function nearest<T extends LatLng>(origin: LatLng, items: T[], limit = Infinity): Located<T>[] {
  return items.map((item) => ({ item, distanceMi: distanceMi(origin, item) }))
    .filter((x): x is Located<T> => x.distanceMi != null)
    .sort((a, b) => a.distanceMi - b.distanceMi)
    .slice(0, limit);
}

/** Gyms nearest first; unlocated gyms keep their relative order at the end with no distance. */
export function withDistances(gyms: GymCard[], origin: { lat: number; lng: number }): { gym: GymCard; distanceMi: number | null }[] {
  const near = nearest(origin, gyms).map(({ item, distanceMi }) => ({ gym: item, distanceMi }));
  const seen = new Set(near.map((x) => x.gym.slug));
  return [...near, ...gyms.filter((g) => !seen.has(g.slug)).map((gym) => ({ gym, distanceMi: null }))];
}

export type NearbyPlace = { place: Place; distanceMi: number; count: number };

/** Other populated places within radiusMi, nearest first. */
export function nearbyPlaces(origin: Place, places: Place[], counts: Map<string, number>, opts: { radiusMi?: number; limit?: number } = {}): NearbyPlace[] {
  const { radiusMi = 25, limit = 6 } = opts;
  const others = places.filter((p) => p.slug !== origin.slug && (counts.get(p.slug) ?? 0) > 0);
  return nearest(origin, others).filter((x) => x.distanceMi <= radiusMi).slice(0, limit)
    .map(({ item, distanceMi }) => ({ place: item, distanceMi, count: counts.get(item.slug) ?? 0 }));
}

/** Closest other gyms, any city. */
export function nearestGyms(origin: GymCard, gyms: GymCard[], limit = 3): { gym: GymCard; distanceMi: number }[] {
  return nearest(origin, gyms.filter((g) => g.slug !== origin.slug), limit).map(({ item, distanceMi }) => ({ gym: item, distanceMi }));
}

export function nearestPlace<T extends LatLng>(origin: { lat: number; lng: number }, places: T[]): T | null {
  return nearest(origin, places, 1)[0]?.item ?? null;
}

export function placeCounts(gyms: Pick<GymCard, "place_slug">[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const g of gyms) if (g.place_slug) counts.set(g.place_slug, (counts.get(g.place_slug) ?? 0) + 1);
  return counts;
}

export type Coverage = { total: number; beginner: number; priced: number; scheduled: number };

export function coverage(gyms: GymCard[]): Coverage {
  return {
    total: gyms.length,
    beginner: gyms.filter((g) => g.tags.includes("beginner_friendly")).length,
    priced: gyms.filter(hasPrice).length,
    scheduled: gyms.filter(hasSchedule).length,
  };
}

/** "11 gyms · 8 beginner friendly · 3 with a listed price · 4 with a schedule"; zero parts are left out. */
export function coverageLine(c: Coverage): string {
  const parts = [`${c.total} gym${c.total === 1 ? "" : "s"}`];
  if (c.beginner) parts.push(`${c.beginner} beginner friendly`);
  if (c.priced) parts.push(`${c.priced} with a listed price`);
  if (c.scheduled) parts.push(`${c.scheduled} with a schedule`);
  return parts.join(" · ");
}

import { money } from "./format";
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

const FEATURED_ZONE = "America/New_York";

/** Calendar day used for featured_until. Inclusive: the end date itself still shows. */
export function featuredToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FEATURED_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Active founding placement. The admin flag must be on, and featured_until must be empty or today-or-later
 * in America/New_York. A past date hides the placement without anyone clearing the flag.
 */
export function isFeatured(g: { featured?: boolean | null; featured_until?: string | null }, today = featuredToday()): boolean {
  if (g.featured !== true) return false;
  if (g.featured_until == null || g.featured_until === "") return true;
  const day = String(g.featured_until).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= today;
}

/** Featured gyms first. Everyone else keeps the completeness order, including expired features. */
export function byListing(a: GymCard, b: GymCard, today = featuredToday()): number {
  return Number(isFeatured(b, today)) - Number(isFeatured(a, today)) || byCompleteness(a, b);
}

/** Stable pin: featured rows keep their relative order, then the rest keep theirs. */
export function pinFeatured<T>(items: T[], featured: (item: T) => boolean): T[] {
  const top: T[] = [];
  const rest: T[] = [];
  for (const item of items) (featured(item) ? top : rest).push(item);
  return top.length ? [...top, ...rest] : items;
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

export const NEARBY_RADIUS_MI = 25;
export type NearbyPlace = { place: Place; distanceMi: number; count: number };

/** Other populated places within radiusMi, nearest first. */
export function nearbyPlaces(origin: Place, places: Place[], counts: Map<string, number>, opts: { radiusMi?: number; limit?: number } = {}): NearbyPlace[] {
  const { radiusMi = NEARBY_RADIUS_MI, limit = 6 } = opts;
  const others = places.filter((p) => p.slug !== origin.slug && (counts.get(p.slug) ?? 0) > 0);
  return nearest(origin, others).filter((x) => x.distanceMi <= radiusMi).slice(0, limit)
    .map(({ item, distanceMi }) => ({ place: item, distanceMi, count: counts.get(item.slug) ?? 0 }));
}

/** Closest other gyms, any city. */
export function nearestGyms(origin: GymCard, gyms: GymCard[], limit = 3): { gym: GymCard; distanceMi: number }[] {
  return nearest(origin, gyms.filter((g) => g.slug !== origin.slug), limit).map(({ item, distanceMi }) => ({ gym: item, distanceMi }));
}

/** Other gyms in the same city, nearest first. Gyms without coordinates follow, by name. */
export function sameCityGyms(origin: GymCard, gyms: GymCard[], limit = 6): { gym: GymCard; distanceMi: number | null }[] {
  const others = gyms.filter((g) => g.slug !== origin.slug && !!origin.place_slug && g.place_slug === origin.place_slug);
  if (!others.length) return [];
  if (origin.lat == null || origin.lng == null) return [...others].sort(byName).slice(0, limit).map((gym) => ({ gym, distanceMi: null }));
  return withDistances(others, { lat: origin.lat, lng: origin.lng }).slice(0, limit);
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

/** One plain sentence a reader or a search engine can quote; every number comes from the listed rows. Empty when nothing is listed. */
export function listingSummary(label: string, place: Pick<Place, "city" | "state">, gyms: GymCard[]): string {
  const n = gyms.length;
  if (!n) return "";
  const priced = gyms.filter(hasPrice).length;
  const entry = gyms.flatMap((g) => [g.trial_cents, g.drop_in_cents]).filter((c): c is number => c != null);
  let text = `${n} ${label} gym${n === 1 ? " is" : "s are"} listed in ${place.city}, ${place.state}.`;
  if (priced) {
    text += n === 1 ? " It lists a price" : ` ${priced} of them list${priced === 1 ? "s" : ""} a price`;
    text += entry.length ? `; trial or drop-in classes start at ${money(Math.min(...entry))}.` : ".";
  }
  return text;
}

/** Nearby cities within the radius, or, for an isolated city, the closest three listed cities anywhere. */
export function nearbyOrNearest(origin: Place, places: Place[], counts: Map<string, number>): NearbyPlace[] {
  const near = nearbyPlaces(origin, places, counts);
  return near.length ? near : nearbyPlaces(origin, places, counts, { radiusMi: Infinity, limit: 3 });
}

export type MoneyRange = { min: number; max: number; count: number };

export type CityFacts = {
  total: number;
  beginner: number;
  fightTeam: number;
  freeTrial: number;
  monthly: MoneyRange | null;
  dropIn: MoneyRange | null;
  /** Paid intro prices only. A free trial is counted in `freeTrial`, not here. */
  trial: MoneyRange | null;
};

function moneyRange(values: number[]): MoneyRange | null {
  if (!values.length) return null;
  return { min: Math.min(...values), max: Math.max(...values), count: values.length };
}

/** Counts and price spans from the rows on this page. A missing price is left out, not treated as zero. */
export function cityFacts(gyms: GymCard[]): CityFacts {
  return {
    total: gyms.length,
    beginner: gyms.filter((g) => g.tags.includes("beginner_friendly")).length,
    fightTeam: gyms.filter((g) => g.tags.includes("fighter_gym")).length,
    freeTrial: gyms.filter((g) => g.trial_cents === 0).length,
    monthly: moneyRange(gyms.flatMap((g) => (g.monthly_cents != null && g.monthly_cents > 0 ? [g.monthly_cents] : []))),
    dropIn: moneyRange(gyms.flatMap((g) => (g.drop_in_cents != null && g.drop_in_cents > 0 ? [g.drop_in_cents] : []))),
    trial: moneyRange(gyms.flatMap((g) => (g.trial_cents != null && g.trial_cents > 0 ? [g.trial_cents] : []))),
  };
}

function series(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

function amount(range: MoneyRange): string {
  return range.min === range.max ? money(range.min) : `${money(range.min)} to ${money(range.max)}`;
}

function priceBit(label: string, range: MoneyRange, solo: boolean): string {
  const span = amount(range);
  const core = range.min === range.max ? `a ${label} of ${span}` : `a ${label} from ${span}`;
  if (solo) return core;
  return range.count === 1 ? `1 lists ${core}` : `${range.count} list ${core}`;
}

function tagSentence(facts: CityFacts): string {
  if (facts.beginner && facts.fightTeam) return "It is tagged beginner friendly and as a fight team.";
  if (facts.beginner) return "It is tagged beginner friendly.";
  if (facts.fightTeam) return "It is tagged as a fight team.";
  return "";
}

/** Comparisons that exist on this page. Empty when the rows have no price, trial, beginner, or fight-team fact. */
export function cityComparison(label: string, place: Pick<Place, "city" | "state">, gyms: GymCard[]): string {
  const facts = cityFacts(gyms);
  if (!facts.total) return "";
  const solo = facts.total === 1;
  const prices: string[] = [];
  if (facts.monthly) prices.push(priceBit("monthly price", facts.monthly, solo));
  if (facts.dropIn) prices.push(priceBit("drop-in price", facts.dropIn, solo));
  if (facts.trial) prices.push(priceBit("trial price", facts.trial, solo));
  if (facts.freeTrial) prices.push(solo ? "a free trial" : facts.freeTrial === 1 ? "1 lists a free trial" : `${facts.freeTrial} list a free trial`);
  if (solo) {
    const sentences = [prices.length ? `That gym lists ${series(prices)}.` : "", tagSentence(facts)].filter(Boolean);
    return sentences.join(" ");
  }
  const parts = [...prices];
  if (facts.beginner) parts.push(facts.beginner === 1 ? "1 is tagged beginner friendly" : `${facts.beginner} are tagged beginner friendly`);
  if (facts.fightTeam) parts.push(facts.fightTeam === 1 ? "1 is tagged as a fight team" : `${facts.fightTeam} are tagged as a fight team`);
  return parts.length ? `Among the ${label} gyms in ${place.city}, ${series(parts)}.` : "";
}

export type CityFaq = { question: string; answer: string };

function namedAt(gyms: GymCard[], field: "monthly_cents" | "drop_in_cents" | "trial_cents", cents: number): string {
  return series(gyms.filter((g) => g[field] === cents).map((g) => g.name).sort((a, b) => a.localeCompare(b)));
}

function endpointSentence(gyms: GymCard[], field: "monthly_cents" | "drop_in_cents" | "trial_cents", range: MoneyRange, label: string): string {
  if (range.min === range.max) return "";
  return ` The lowest listed ${label} is ${money(range.min)}, at ${namedAt(gyms, field, range.min)}. The highest is ${money(range.max)}, at ${namedAt(gyms, field, range.max)}.`;
}

/** Questions whose answers are fully determined by the listed rows. No question is emitted for a fact the page does not have. */
export function cityFaqs(label: string, place: Pick<Place, "city" | "state">, gyms: GymCard[]): CityFaq[] {
  const facts = cityFacts(gyms);
  if (!facts.total) return [];
  const where = `${place.city}, ${place.state}`;
  const faqs: CityFaq[] = [{
    question: `How many ${label} gyms are listed in ${where}?`,
    answer: `${facts.total} ${label} gym${facts.total === 1 ? " is" : "s are"} listed in ${where}.`,
  }];
  const solo = facts.total === 1;
  const priceParts: string[] = [];
  if (facts.monthly) priceParts.push(priceBit("monthly price", facts.monthly, solo));
  if (facts.dropIn) priceParts.push(priceBit("drop-in price", facts.dropIn, solo));
  if (facts.trial) priceParts.push(priceBit("trial price", facts.trial, solo));
  if (facts.freeTrial) priceParts.push(solo ? "a free trial" : facts.freeTrial === 1 ? "1 lists a free trial" : `${facts.freeTrial} list a free trial`);
  if (priceParts.length) {
    const unpriced = gyms.filter((g) => !hasPrice(g)).length;
    const lead = solo ? `That gym lists ${series(priceParts)}.` : `Among the ${facts.total} gyms, ${series(priceParts)}.`;
    const missing = unpriced ? ` ${unpriced} ${unpriced === 1 ? "has" : "have"} no price listed.` : "";
    const ends = [
      facts.monthly ? endpointSentence(gyms, "monthly_cents", facts.monthly, "monthly price") : "",
      facts.dropIn ? endpointSentence(gyms, "drop_in_cents", facts.dropIn, "drop-in price") : "",
      facts.trial ? endpointSentence(gyms, "trial_cents", facts.trial, "trial price") : "",
    ].join("");
    faqs.push({ question: `What prices do ${label} gyms in ${where} list?`, answer: `${lead}${missing}${ends}` });
  }
  if (facts.freeTrial) {
    const names = gyms.filter((g) => g.trial_cents === 0).map((g) => g.name).sort((a, b) => a.localeCompare(b));
    faqs.push({
      question: `Which ${label} gyms in ${where} list a free trial?`,
      answer: `${facts.freeTrial === 1 ? "1 gym lists" : `${facts.freeTrial} gyms list`} a free trial: ${series(names)}.`,
    });
  }
  if (facts.beginner) {
    const names = gyms.filter((g) => g.tags.includes("beginner_friendly")).map((g) => g.name).sort((a, b) => a.localeCompare(b));
    faqs.push({
      question: `How many beginner-friendly ${label} gyms are listed in ${where}?`,
      answer: `${facts.beginner} of ${facts.total} ${facts.beginner === 1 ? "is" : "are"} tagged beginner friendly: ${series(names)}. The tag means the gym describes fundamentals or all-levels classes on its own site.`,
    });
  }
  if (facts.fightTeam) {
    const names = gyms.filter((g) => g.tags.includes("fighter_gym")).map((g) => g.name).sort((a, b) => a.localeCompare(b));
    faqs.push({
      question: `How many ${label} gyms in ${where} list a fight team?`,
      answer: `${facts.fightTeam} of ${facts.total} ${facts.fightTeam === 1 ? "is" : "are"} tagged as a fight team: ${series(names)}. The tag means the gym describes an active competition team on its site.`,
    });
  }
  return faqs;
}

/** "11 gyms · 8 beginner friendly · 3 with a listed price · 4 with a schedule"; zero parts are left out. */
export function coverageLine(c: Coverage): string {
  const parts = [`${c.total} gym${c.total === 1 ? "" : "s"}`];
  if (c.beginner) parts.push(`${c.beginner} beginner friendly`);
  if (c.priced) parts.push(`${c.priced} with a listed price`);
  if (c.scheduled) parts.push(`${c.scheduled} with a schedule`);
  return parts.join(" · ");
}

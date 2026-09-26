/** Client-safe search index shape and matcher. Imports nothing from data or site. */

export interface SearchGym { name: string; slug: string; city: string | null; state: string | null; path: string }
export interface SearchPlace { city: string; state: string; slug: string; lat: number | null; lng: number | null; count: number; path: string }
export interface SearchIndex { gyms: SearchGym[]; places: SearchPlace[] }

export const EMPTY_INDEX: SearchIndex = { gyms: [], places: [] };

export function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function rank<T>(items: T[], text: (item: T) => string, q: string, limit: number): T[] {
  const prefix: T[] = [], inner: T[] = [];
  for (const item of items) {
    const hay = normalize(text(item));
    if (hay.startsWith(q)) prefix.push(item);
    else if (hay.includes(q)) inner.push(item);
  }
  return [...prefix, ...inner].slice(0, limit);
}

/** Case-insensitive prefix matches first, then substring matches. Plain string comparison, no regex; queries are cut at 80 characters. */
export function matchIndex(query: string, index: SearchIndex, limit = 8): SearchIndex {
  const q = normalize(query).slice(0, 80);
  if (!q) return EMPTY_INDEX;
  return {
    places: rank(index.places, (p) => `${p.city}, ${p.state}`, q, limit),
    gyms: rank(index.gyms, (g) => g.name, q, limit),
  };
}

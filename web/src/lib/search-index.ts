import { getAllGyms, getPlaces } from "./data";
import { byName, placeCounts } from "./geo";
import type { SearchIndex } from "./search";
import { cityPath } from "./site";
import type { GymCard, Place } from "./types";

/** Names and paths only: the same public fields the directory pages already render. */
export function buildSearchIndex(gyms: GymCard[], places: Place[]): SearchIndex {
  const counts = placeCounts(gyms);
  return {
    gyms: [...gyms].sort(byName).map((g) => ({ name: g.name, slug: g.slug, city: g.city, state: g.state, path: `/gym/${g.slug}` })),
    places: places
      .filter((p) => (counts.get(p.slug) ?? 0) > 0)
      .sort((a, b) => (counts.get(b.slug) ?? 0) - (counts.get(a.slug) ?? 0) || a.city.localeCompare(b.city))
      .map((p) => ({ city: p.city, state: p.state, slug: p.slug, lat: p.lat, lng: p.lng, count: counts.get(p.slug) ?? 0, path: cityPath(p) })),
  };
}

export async function loadSearchIndex(): Promise<SearchIndex> {
  const [gyms, places] = await Promise.all([getAllGyms(), getPlaces()]);
  return buildSearchIndex(gyms, places);
}

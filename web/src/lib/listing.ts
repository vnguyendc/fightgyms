import type { GymCard } from "./types";

/** Gyms per page on /gyms/all. Divisible by the 2- and 3-column card grids. */
export const PAGE_SIZE = 30;

export const ALL_GYMS_TITLE = "All Muay Thai & Kickboxing Gyms";

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

export function pageSlice<T>(items: T[], page: number): T[] {
  return items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
}

/** Page 1 is the canonical /gyms/all; later pages get their own path. */
export function allGymsPath(page: number): string {
  return page === 1 ? "/gyms/all" : `/gyms/all/page/${page}`;
}

export function allGymsTitle(page: number): string {
  return page === 1 ? ALL_GYMS_TITLE : `${ALL_GYMS_TITLE} (Page ${page})`;
}

export function allGymsDescription(page: number, pages: number): string {
  const where = pages > 1 ? `, page ${page} of ${pages}` : "";
  return `Browse all listed Muay Thai and kickboxing gyms in one alphabetical list${where}. Find locations, gym websites and available training details.`;
}

/** First, last, and two pages either side of the current one; null marks a gap. */
export function pageWindow(current: number, count: number): (number | null)[] {
  const keep = new Set([1, count]);
  for (let p = current - 2; p <= current + 2; p++) if (p >= 1 && p <= count) keep.add(p);
  const out: (number | null)[] = [];
  for (const p of [...keep].sort((a, b) => a - b)) {
    const last = out.at(-1);
    if (typeof last === "number" && p !== last + 1) out.push(null);
    out.push(p);
  }
  return out;
}

/** Alphabetical only. Google rating fields are stored but never ranked on. */
export function sortByName<T extends Pick<GymCard, "name" | "slug">>(gyms: T[]): T[] {
  return [...gyms].sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
}

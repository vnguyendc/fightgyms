import { unstable_cache } from "next/cache";
import { getUpcomingEvents } from "./data";

/** Header only. Cached so the root layout does not opt every page into per-request rendering. */
export const hasUpcomingEvents = unstable_cache(
  async () => (await getUpcomingEvents()).length > 0,
  ["nav-upcoming-events"],
  { revalidate: 3600 },
);

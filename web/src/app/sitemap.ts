import type { MetadataRoute } from "next";
import { getAllGyms, getPlaces, getUpcomingEvents } from "@/lib/data";
import { directorySitemap, runtimePolicy } from "@/lib/site";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!runtimePolicy().indexable) return [];
  const [places, gyms, events] = await Promise.all([getPlaces(), getAllGyms(), getUpcomingEvents()]);
  return directorySitemap(places, gyms, true, events.length > 0);
}

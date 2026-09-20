import type { MetadataRoute } from "next";
import { getAllGyms, getPlaces } from "@/lib/data";
import { SITE } from "@/lib/site";
import { LIVE_STYLES, STYLE_SLUG } from "@/lib/types";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [places, gyms] = await Promise.all([getPlaces(), getAllGyms()]);
  const withGyms = new Set(gyms.map((g) => g.place_slug));
  const cityUrls = places
    .filter((p) => withGyms.has(p.slug))
    .flatMap((p) => {
      const base = `${SITE.url}/gyms/${p.state.toLowerCase()}/${p.slug.replace(/-[a-z]{2}$/, "")}`;
      return [
        { url: base, changeFrequency: "weekly" as const, priority: 0.8 },
        ...LIVE_STYLES.map((s) => ({ url: `${base}/${STYLE_SLUG[s]}`, changeFrequency: "weekly" as const, priority: 0.7 })),
      ];
    });
  return [
    { url: SITE.url, changeFrequency: "daily", priority: 1 },
    { url: `${SITE.url}/gyms`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE.url}/events`, changeFrequency: "daily", priority: 0.5 },
    ...cityUrls,
    ...gyms.map((g) => ({ url: `${SITE.url}/gym/${g.slug}`, changeFrequency: "weekly" as const, priority: 0.9 })),
  ];
}

import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import CityPage from "@/components/CityPage";
import { getAllGyms, getGymsByPlace, getPlace, getPlaces } from "@/lib/data";
import { nearbyOrNearest, placeCounts } from "@/lib/geo";
import { cityPath, distinctStyleListing, pageMetadata } from "@/lib/site";
import { LIVE_STYLES, STYLE_LABEL, STYLE_SLUG, type Style } from "@/lib/types";

export const revalidate = 3600;
export const dynamicParams = true;

const fromSlug = (s: string): Style | undefined => LIVE_STYLES.find((k) => STYLE_SLUG[k] === s);

/** A discipline page that would repeat the whole city listing sends crawlers and people to the city page instead. */
async function styleListing(place: { slug: string; state: string }, st: Style) {
  const cityGyms = await getGymsByPlace(place.slug);
  const gyms = cityGyms.filter(g => g.styles.includes(st));
  if (!gyms.length) notFound();
  if (!distinctStyleListing(cityGyms, st)) permanentRedirect(cityPath(place));
  return { cityGyms, gyms };
}

export async function generateStaticParams() {
  const [places, gyms] = await Promise.all([getPlaces(), getAllGyms()]);
  return places.flatMap((p) => {
    const local = gyms.filter(g => g.place_slug === p.slug);
    return LIVE_STYLES.filter(s => distinctStyleListing(local, s))
      .map((s) => ({ state: p.state.toLowerCase(), city: p.slug.replace(/-[a-z]{2}$/, ""), style: STYLE_SLUG[s] }));
  });
}

export async function generateMetadata({ params }: PageProps<"/gyms/[state]/[city]/[style]">): Promise<Metadata> {
  const { state, city, style } = await params;
  const st = fromSlug(style);
  if (!st) notFound();
  const place = await getPlace(`${city}-${state}`);
  if (!place) notFound();
  const { gyms } = await styleListing(place, st);
  return pageMetadata(cityPath(place, st), `${STYLE_LABEL[st]} Gyms in ${place.city}, ${place.state}`,
    `Browse ${gyms.length} listed ${STYLE_LABEL[st]} gym${gyms.length === 1 ? "" : "s"} in ${place.city}, ${place.state}. Find gym websites, locations and available training details.`);
}

export default async function Page({ params }: PageProps<"/gyms/[state]/[city]/[style]">) {
  const { state, city, style } = await params;
  const st = fromSlug(style);
  if (!st) notFound();
  const place = await getPlace(`${city}-${state}`);
  if (!place) notFound();
  const [{ cityGyms, gyms }, places, all] = await Promise.all([styleListing(place, st), getPlaces(), getAllGyms()]);
  return <CityPage place={place} gyms={gyms} cityGyms={cityGyms} style={st} nearby={nearbyOrNearest(place, places, placeCounts(all))} />;
}

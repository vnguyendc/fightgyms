import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CityPage from "@/components/CityPage";
import { getAllGyms, getGymsByPlace, getPlace, getPlaces } from "@/lib/data";
import { nearbyPlaces, placeCounts } from "@/lib/geo";
import { cityPath, pageMetadata } from "@/lib/site";
import { LIVE_STYLES, STYLE_LABEL, STYLE_SLUG, type Style } from "@/lib/types";

export const revalidate = 3600;
export const dynamicParams = true;

const fromSlug = (s: string): Style | undefined => LIVE_STYLES.find((k) => STYLE_SLUG[k] === s);

export async function generateStaticParams() {
  const [places, gyms] = await Promise.all([getPlaces(), getAllGyms()]);
  return places.flatMap((p) => LIVE_STYLES.filter(s => gyms.some(g => g.place_slug === p.slug && g.styles.includes(s)))
    .map((s) => ({ state: p.state.toLowerCase(), city: p.slug.replace(/-[a-z]{2}$/, ""), style: STYLE_SLUG[s] })));
}

export async function generateMetadata({ params }: PageProps<"/gyms/[state]/[city]/[style]">): Promise<Metadata> {
  const { state, city, style } = await params;
  const st = fromSlug(style);
  if (!st) notFound();
  const place = await getPlace(`${city}-${state}`);
  if (!place) notFound();
  const gyms = await getGymsByPlace(place.slug, st);
  if (!gyms.length) notFound();
  return pageMetadata(cityPath(place, st), `${STYLE_LABEL[st]} Gyms in ${place.city}, ${place.state}`,
    `Browse ${gyms.length} listed ${STYLE_LABEL[st]} gym${gyms.length === 1 ? "" : "s"} in ${place.city}, ${place.state}. Find gym websites, locations and available training details.`);
}

export default async function Page({ params }: PageProps<"/gyms/[state]/[city]/[style]">) {
  const { state, city, style } = await params;
  const st = fromSlug(style);
  if (!st) notFound();
  const place = await getPlace(`${city}-${state}`);
  if (!place) notFound();
  const [gyms, places, all] = await Promise.all([getGymsByPlace(place.slug, st), getPlaces(), getAllGyms()]);
  if (!gyms.length) notFound();
  return <CityPage place={place} gyms={gyms} style={st} nearby={nearbyPlaces(place, places, placeCounts(all))} />;
}

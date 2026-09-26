import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CityPage from "@/components/CityPage";
import { getAllGyms, getGymsByPlace, getPlace, getPlaces } from "@/lib/data";
import { nearbyPlaces, placeCounts } from "@/lib/geo";
import { cityPath, pageMetadata } from "@/lib/site";

export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  const places = await getPlaces();
  return places.map((p) => ({ state: p.state.toLowerCase(), city: p.slug.replace(/-[a-z]{2}$/, "") }));
}

export async function generateMetadata({ params }: PageProps<"/gyms/[state]/[city]">): Promise<Metadata> {
  const { state, city } = await params;
  const place = await getPlace(`${city}-${state}`);
  if (!place) notFound();
  const gyms = await getGymsByPlace(place.slug);
  if (!gyms.length) notFound();
  return pageMetadata(cityPath(place), `Muay Thai & Kickboxing Gyms in ${place.city}, ${place.state}`,
    `Browse ${gyms.length} listed Muay Thai and kickboxing gym${gyms.length === 1 ? "" : "s"} in ${place.city}, ${place.state}. Find locations, gym websites and available training details.`);
}

export default async function Page({ params }: PageProps<"/gyms/[state]/[city]">) {
  const { state, city } = await params;
  const place = await getPlace(`${city}-${state}`);
  if (!place) notFound();
  const [gyms, places, all] = await Promise.all([getGymsByPlace(place.slug), getPlaces(), getAllGyms()]);
  if (!gyms.length) notFound();
  return <CityPage place={place} gyms={gyms} nearby={nearbyPlaces(place, places, placeCounts(all))} />;
}

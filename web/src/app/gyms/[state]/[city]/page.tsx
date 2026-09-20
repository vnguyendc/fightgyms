import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CityPage from "@/components/CityPage";
import { getGymsByPlace, getPlace, getPlaces } from "@/lib/data";
import { SITE } from "@/lib/site";

export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  const places = await getPlaces();
  return places.map((p) => ({ state: p.state.toLowerCase(), city: p.slug.replace(/-[a-z]{2}$/, "") }));
}

export async function generateMetadata({ params }: PageProps<"/gyms/[state]/[city]">): Promise<Metadata> {
  const { state, city } = await params;
  const place = await getPlace(`${city}-${state}`);
  if (!place) return {};
  const title = `Muay Thai & Kickboxing Gyms in ${place.city}, ${place.state}`;
  return {
    title,
    description: `Every muay thai and kickboxing gym in ${place.city}, ${place.state} with drop-in rates, monthly prices, class schedules and which ones train fighters.`,
    alternates: { canonical: `${SITE.url}/gyms/${state}/${city}` },
  };
}

export default async function Page({ params }: PageProps<"/gyms/[state]/[city]">) {
  const { state, city } = await params;
  const place = await getPlace(`${city}-${state}`);
  if (!place) notFound();
  const gyms = await getGymsByPlace(place.slug);
  return <CityPage place={place} gyms={gyms} />;
}

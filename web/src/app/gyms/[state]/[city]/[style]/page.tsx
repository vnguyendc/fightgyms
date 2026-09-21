import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CityPage from "@/components/CityPage";
import { getGymsByPlace, getPlace, getPlaces } from "@/lib/data";
import { SITE } from "@/lib/site";
import { LIVE_STYLES, STYLE_LABEL, STYLE_SLUG, type Style } from "@/lib/types";

export const revalidate = 3600;
export const dynamicParams = true;

const fromSlug = (s: string): Style | undefined =>
  (Object.keys(STYLE_SLUG) as Style[]).find((k) => STYLE_SLUG[k] === s && LIVE_STYLES.includes(k));

export async function generateStaticParams() {
  const places = await getPlaces();
  return places.flatMap((p) =>
    LIVE_STYLES.map((s) => ({ state: p.state.toLowerCase(), city: p.slug.replace(/-[a-z]{2}$/, ""), style: STYLE_SLUG[s] })),
  );
}

export async function generateMetadata({ params }: PageProps<"/gyms/[state]/[city]/[style]">): Promise<Metadata> {
  const { state, city, style } = await params;
  const st = fromSlug(style);
  const place = await getPlace(`${city}-${state}`);
  if (!place || !st) return {};
  const label = STYLE_LABEL[st];
  return {
    title: `${label} Gyms in ${place.city}, ${place.state}`,
    description: `${label} gyms in ${place.city}, ${place.state} with real drop-in and monthly prices, class times, coaches and fighter records.`,
    alternates: { canonical: `${SITE.url}/gyms/${state}/${city}/${style}` },
  };
}

export default async function Page({ params }: PageProps<"/gyms/[state]/[city]/[style]">) {
  const { state, city, style } = await params;
  const st = fromSlug(style);
  const place = await getPlace(`${city}-${state}`);
  if (!place || !st) notFound();
  const gyms = await getGymsByPlace(place.slug, st);
  if (!gyms.length) notFound();
  return <CityPage place={place} gyms={gyms} style={st} />;
}

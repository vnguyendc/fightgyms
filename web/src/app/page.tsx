import Link from "next/link";
import DirectoryState from "@/components/DirectoryState";
import GymCard from "@/components/GymCard";
import SiteSearch from "@/components/SiteSearch";
import { getAllGyms, getPlaces } from "@/lib/data";
import { listStates } from "@/lib/format";
import { byCompleteness, placeCounts } from "@/lib/geo";
import { SITE, cityPath, distinctStyleListing, gymIndexable, listingIndexable, pageMetadata } from "@/lib/site";
import { LIVE_STYLES, STYLE_LABEL } from "@/lib/types";

export const revalidate = 3600;

export async function generateMetadata() {
  const gyms = await getAllGyms();
  return pageMetadata("/", `${SITE.name} — ${SITE.tagline}`, SITE.description, gyms.length > 0);
}

// Factual about what is listed; nothing here promises data a gym has not published.
const HOW = [
  ["Start as a beginner", "Gyms tagged beginner friendly describe fundamentals or all-levels classes on their own site. Ask about a trial class and what to bring."],
  ["Find a real fight gym", "The fight team tag means the gym describes an active competition team on its site. Fighter records are not listed yet."],
  ["Know the price before you go", "Trial, drop-in and monthly prices appear where a gym publishes them, with the date they were checked. Confirm before you visit."],
] as const;

export default async function Home() {
  const [places, gyms] = await Promise.all([getPlaces(), getAllGyms()]);
  const counts = placeCounts(gyms);
  const cities = places.filter((p) => counts.get(p.slug)).sort((a, b) => (counts.get(b.slug) ?? 0) - (counts.get(a.slug) ?? 0));
  const inCity = (slug: string) => gyms.filter((g) => g.place_slug === slug);
  const strong = cities.filter((p) => listingIndexable(inCity(p.slug)));
  const topCities = (strong.length ? strong : cities).slice(0, 8);
  const featured = [...gyms].sort(byCompleteness).slice(0, 6);
  const states = listStates(cities.map((p) => p.state));

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-16 md:py-24 max-w-3xl">
        <p className="text-accent font-mono text-sm mb-3">muay thai · kickboxing · more soon</p>
        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05]">
          Find your Muay Thai or kickboxing gym.
        </h1>
        <p className="mt-5 text-lg text-muted max-w-xl">{SITE.description}</p>
        {gyms.length > 0 && (
          <p className="mt-3 text-sm text-muted">
            {gyms.length} gym{gyms.length === 1 ? "" : "s"} in {cities.length} {cities.length === 1 ? "city" : "cities"} across {states}.
          </p>
        )}
        <div className="mt-8"><SiteSearch size="large" /></div>
        <div className="mt-4 flex flex-wrap gap-2">
          {topCities.map((p) => (
            <Link key={p.slug} href={cityPath(p)} className="rounded-full border border-line px-4 py-2 text-sm hover:border-accent">
              {p.city}, {p.state} <span className="text-muted">({counts.get(p.slug)})</span>
            </Link>
          ))}
          <Link href="/gyms" className="rounded-full px-4 py-2 text-sm text-muted hover:text-ink">
            all cities →
          </Link>
        </div>
      </section>

      {topCities.length > 0 && (
        <section className="py-8">
          <h2 className="text-xl font-semibold">Cities</h2>
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            {topCities.map((p) => {
              const local = inCity(p.slug);
              const priced = local.filter(gymIndexable).sort(byCompleteness);
              const picks = (priced.length ? priced : [...local].sort(byCompleteness)).slice(0, 4);
              return (
                <div key={p.slug}>
                  <h3 className="font-medium">
                    <Link href={cityPath(p)} className="hover:text-accent">{p.city}, {p.state}</Link>
                    <span className="text-sm text-muted"> ({counts.get(p.slug)})</span>
                  </h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {picks.map((g) => (
                      <li key={g.slug}><Link href={`/gym/${g.slug}`} className="text-muted hover:text-ink">{g.name}</Link></li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="py-8">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-xl font-semibold">Most complete listings</h2>
          <span className="text-sm text-muted">prices, schedule, photos and website where listed</span>
        </div>
        {!gyms.length && <DirectoryState />}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((g) => (
            <GymCard key={g.id} gym={g} />
          ))}
        </div>
        {gyms.length > 0 && (
          <p className="mt-4 text-sm"><Link href="/gyms/all" className="text-muted hover:text-ink">all {gyms.length} gyms →</Link></p>
        )}
      </section>

      <section className="py-8 grid gap-6 md:grid-cols-3">
        {HOW.map(([h, p]) => (
          <div key={h} className="rounded-xl border border-line p-5">
            <h3 className="font-semibold">{h}</h3>
            <p className="mt-2 text-sm text-muted">{p}</p>
          </div>
        ))}
      </section>

      <section className="py-8">
        <h2 className="text-xl font-semibold mb-3">Browse by discipline</h2>
        <div className="flex flex-wrap gap-2">
          {LIVE_STYLES.map((s) =>
            cities.filter((p) => distinctStyleListing(gyms.filter((g) => g.place_slug === p.slug), s)).slice(0, 4).map((p) => (
              <Link key={s + p.slug} href={cityPath(p, s)} className="text-sm text-muted hover:text-ink underline">
                {STYLE_LABEL[s]} in {p.city}
              </Link>
            )),
          )}
        </div>
      </section>
    </div>
  );
}

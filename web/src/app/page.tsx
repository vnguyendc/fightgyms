import Link from "next/link";
import GymCard from "@/components/GymCard";
import { getAllGyms, getPlaces } from "@/lib/data";
import { SITE, pageMetadata, cityPath } from "@/lib/site";
import DirectoryState from "@/components/DirectoryState";
import { LIVE_STYLES, STYLE_LABEL } from "@/lib/types";

export const revalidate = 3600;

export async function generateMetadata() {
  const gyms = await getAllGyms();
  return pageMetadata("/", `${SITE.name} — ${SITE.tagline}`, SITE.description, gyms.length > 0);
}

export default async function Home() {
  const [places, gyms] = await Promise.all([getPlaces(), getAllGyms()]);
  const top = [...gyms].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 6);
  const counts = new Map<string, number>();
  for (const g of gyms) counts.set(g.place_slug ?? "", (counts.get(g.place_slug ?? "") ?? 0) + 1);
  const cities = places.filter((p) => counts.get(p.slug)).sort((a, b) => (counts.get(b.slug) ?? 0) - (counts.get(a.slug) ?? 0));

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-16 md:py-24 max-w-3xl">
        <p className="text-accent font-mono text-sm mb-3">muay thai · kickboxing · more soon</p>
        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05]">
          Find your Muay Thai or kickboxing gym.
        </h1>
        <p className="mt-5 text-lg text-muted max-w-xl">
          {SITE.description}
        </p>
        <div className="mt-8 flex flex-wrap gap-2">
          {cities.slice(0, 8).map((p) => (
            <Link
              key={p.slug}
              href={`/gyms/${p.state.toLowerCase()}/${p.slug.replace(/-[a-z]{2}$/, "")}`}
              className="rounded-full border border-line px-4 py-2 text-sm hover:border-accent"
            >
              {p.city}, {p.state} <span className="text-muted">({counts.get(p.slug)})</span>
            </Link>
          ))}
          <Link href="/gyms" className="rounded-full px-4 py-2 text-sm text-muted hover:text-ink">
            all cities →
          </Link>
        </div>
      </section>

      <section className="py-8">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-xl font-semibold">Explore the directory</h2>
          <span className="text-sm text-muted">listed alphabetically</span>
        </div>
        {!gyms.length && <DirectoryState />}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {top.map((g) => (
            <GymCard key={g.id} gym={g} />
          ))}
        </div>
      </section>

      <section className="py-8 grid gap-6 md:grid-cols-3">
        {[
          ["Find a location", "Browse populated city pages and follow a gym's website or directions link to plan a visit."],
          ["Compare available details", "Profiles show prices, class times and training information where available. Missing information is marked, not estimated."],
          ["Confirm before visiting", "Classes, prices and trial policies can change. Contact the gym directly for current details and advice on your first session."],
        ].map(([h, p]) => (
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
            cities.filter(p => gyms.some(g => g.place_slug === p.slug && g.styles.includes(s))).slice(0, 4).map((p) => (
              <Link
                key={s + p.slug}
                href={cityPath(p, s)}
                className="text-sm text-muted hover:text-ink underline"
              >
                {STYLE_LABEL[s]} in {p.city}
              </Link>
            )),
          )}
        </div>
      </section>
    </div>
  );
}

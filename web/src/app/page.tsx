import Link from "next/link";
import GymCard from "@/components/GymCard";
import { getAllGyms, getPlaces } from "@/lib/data";
import { SITE } from "@/lib/site";
import { LIVE_STYLES, STYLE_LABEL, STYLE_SLUG } from "@/lib/types";

export const revalidate = 3600;

export default async function Home() {
  const [places, gyms] = await Promise.all([getPlaces(), getAllGyms()]);
  const top = [...gyms].sort((a, b) => b.active_fighters - a.active_fighters).slice(0, 6);
  const counts = new Map<string, number>();
  for (const g of gyms) counts.set(g.place_slug ?? "", (counts.get(g.place_slug ?? "") ?? 0) + 1);
  const cities = places.filter((p) => counts.get(p.slug)).sort((a, b) => (counts.get(b.slug) ?? 0) - (counts.get(a.slug) ?? 0));

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-16 md:py-24 max-w-3xl">
        <p className="text-accent font-mono text-sm mb-3">muay thai · kickboxing · more soon</p>
        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05]">
          Find a gym that actually trains fighters.
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
          <h2 className="text-xl font-semibold">Gyms with the most active fighters</h2>
          <span className="text-sm text-muted">bouts in the last 18 months</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {top.map((g, i) => (
            <GymCard key={g.id} gym={g} rank={i + 1} />
          ))}
        </div>
      </section>

      <section className="py-8 grid gap-6 md:grid-cols-3">
        {[
          ["Real prices", "Drop-in and monthly rates pulled from the gym's own site and verified by phone or by the gym. Every number shows when it was last checked."],
          ["Real schedules", "Class times by day and level, so you know if there's a beginner class you can actually make after work."],
          ["Real fight gyms", "Fighter records from Tapology, Smoothcomp and promotion results tell you which gyms have an active fight team, not just a heavy bag."],
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
            cities.slice(0, 4).map((p) => (
              <Link
                key={s + p.slug}
                href={`/gyms/${p.state.toLowerCase()}/${p.slug.replace(/-[a-z]{2}$/, "")}/${STYLE_SLUG[s]}`}
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

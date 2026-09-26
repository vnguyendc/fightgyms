import Link from "next/link";
import DirectoryState from "@/components/DirectoryState";
import GymCard from "@/components/GymCard";
import SiteSearch from "@/components/SiteSearch";
import { getAllGyms, getPlaces } from "@/lib/data";
import { matchIndex } from "@/lib/search";
import { buildSearchIndex } from "@/lib/search-index";
import { pageMetadata } from "@/lib/site";

// Always noindex: a query page is never a landing page and never enters the sitemap.
export const metadata = pageMetadata("/search", "Search gyms and cities", "Search listed Muay Thai and kickboxing gyms and cities by name.", false);

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const q = (raw ?? "").slice(0, 80);
  const [gyms, places] = await Promise.all([getAllGyms(), getPlaces()]);
  const results = matchIndex(q, buildSearchIndex(gyms, places), 20);
  const bySlug = new Map(gyms.map((g) => [g.slug, g]));
  const cards = results.gyms.flatMap((g) => bySlug.get(g.slug) ?? []);
  const none = q.trim() !== "" && results.places.length === 0 && cards.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Search gyms and cities</h1>
      <div className="mt-4"><SiteSearch size="large" initialQuery={q} /></div>
      {!gyms.length ? (
        <DirectoryState />
      ) : (
        <>
          {results.places.length > 0 && (
            <section className="mt-8">
              <h2 className="text-xl font-semibold">Cities</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {results.places.map((p) => (
                  <Link key={p.slug} href={p.path} className="rounded-full border border-line px-4 py-2 text-sm hover:border-accent">
                    {p.city}, {p.state} <span className="text-muted">({p.count})</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          {cards.length > 0 && (
            <section className="mt-8">
              <h2 className="text-xl font-semibold">Gyms</h2>
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {cards.map((g) => <GymCard key={g.id} gym={g} />)}
              </div>
            </section>
          )}
          {none && <p className="mt-8 text-muted">No listed gyms or cities match “{q}”. <Link href="/gyms" className="underline">Browse all cities.</Link></p>}
          {!q.trim() && <p className="mt-8 text-muted">Type a gym or city name, or <Link href="/gyms" className="underline">browse all cities</Link>.</p>}
        </>
      )}
    </div>
  );
}

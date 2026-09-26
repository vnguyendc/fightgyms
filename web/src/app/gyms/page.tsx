import Link from "next/link";
import { pageMetadata } from "@/lib/site";
import DirectoryState from "@/components/DirectoryState";
import { getAllGyms, getPlaces } from "@/lib/data";

export const revalidate = 3600;
export async function generateMetadata() {
  const places = await getPlaces();
  return pageMetadata("/gyms", "Gyms by city", "Browse available Muay Thai and kickboxing gym listings by city and state.", places.length > 0);
}

export default async function GymsIndex() {
  const [places, gyms] = await Promise.all([getPlaces(), getAllGyms()]);
  const counts = new Map<string, number>();
  for (const g of gyms) counts.set(g.place_slug ?? "", (counts.get(g.place_slug ?? "") ?? 0) + 1);
  const byState = new Map<string, typeof places>();
  for (const p of places) {
    if (!counts.get(p.slug)) continue;
    byState.set(p.state, [...(byState.get(p.state) ?? []), p]);
  }
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Gyms by city</h1>
      <p className="text-muted mt-2">
        {gyms.length} gyms across {places.length} cities.
        {gyms.length > 0 && <>{" "}<Link href="/gyms/all" className="underline hover:text-ink">Browse all gyms →</Link></>}
      </p>
      {!places.length && <DirectoryState />}
      <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {[...byState.entries()].sort().map(([state, ps]) => (
          <div key={state}>
            <h2 className="font-mono text-sm text-muted mb-2">{state}</h2>
            <ul className="space-y-1">
              {ps.sort((a, b) => a.city.localeCompare(b.city)).map((p) => (
                <li key={p.slug}>
                  <Link href={`/gyms/${state.toLowerCase()}/${p.slug.replace(/-[a-z]{2}$/, "")}`} className="hover:text-accent">
                    {p.city} <span className="text-muted text-sm">({counts.get(p.slug)})</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

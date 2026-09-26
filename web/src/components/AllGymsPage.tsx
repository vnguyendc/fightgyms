import Link from "next/link";
import DirectoryState from "@/components/DirectoryState";
import GymCard from "@/components/GymCard";
import { ALL_GYMS_TITLE, PAGE_SIZE, allGymsPath, pageWindow } from "@/lib/listing";
import { SITE, jsonLd } from "@/lib/site";
import type { GymCard as GymCardT } from "@/lib/types";

type Props = { gyms: GymCardT[]; total: number; cities: number; page: number; pages: number };

const pill = (active: boolean) =>
  `rounded-full border px-3 py-1 ${active ? "border-accent text-accent" : "border-line text-muted hover:text-ink"}`;

/** One page of the full alphabetical listing. `gyms` is this page's slice; `total` counts every listed gym. */
export default function AllGymsPage({ gyms, total, cities, page, pages }: Props) {
  const offset = (page - 1) * PAGE_SIZE;
  const summary =
    `${total} gym${total === 1 ? "" : "s"} listed${cities ? ` across ${cities} ${cities === 1 ? "city" : "cities"}` : ""}.` +
    (pages > 1 ? ` Page ${page} of ${pages}.` : "");
  const schema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: ALL_GYMS_TITLE,
    numberOfItems: gyms.length,
    itemListElement: gyms.map((g, i) => ({ "@type": "ListItem", position: offset + i + 1, url: `${SITE.url}/gym/${g.slug}`, name: g.name })),
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      {gyms.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(schema) }} />}
      <nav className="text-sm text-muted mb-4">
        <Link href="/gyms" className="hover:text-ink">Gyms</Link> /{" "}
        {page > 1 ? <><Link href="/gyms/all" className="hover:text-ink">All</Link> / Page {page}</> : "All"}
      </nav>
      <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">All Muay Thai &amp; kickboxing gyms</h1>
      <p className="mt-3 text-muted max-w-2xl">
        {summary} Listed alphabetically. Check with the gym for current classes, prices and trial availability.
      </p>

      {gyms.length === 0 ? (
        <DirectoryState />
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {gyms.map((g) => (
            <GymCard key={g.id} gym={g} />
          ))}
        </div>
      )}

      {pages > 1 && (
        <nav aria-label="Pagination" className="mt-10 flex flex-wrap items-center gap-2 text-sm">
          {page > 1 && <Link href={allGymsPath(page - 1)} className={pill(false)}>← Previous</Link>}
          {pageWindow(page, pages).map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} className="px-1 text-muted">…</span>
            ) : p === page ? (
              <span key={p} aria-current="page" className={pill(true)}>{p}</span>
            ) : (
              <Link key={p} href={allGymsPath(p)} className={pill(false)}>{p}</Link>
            ),
          )}
          {page < pages && <Link href={allGymsPath(page + 1)} className={pill(false)}>Next →</Link>}
        </nav>
      )}
    </div>
  );
}

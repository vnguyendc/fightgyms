import Link from "next/link";
import GymCard from "@/components/GymCard";
import { SITE, jsonLd as serializeJsonLd } from "@/lib/site";
import { LIVE_STYLES, STYLE_LABEL, STYLE_SLUG, type GymCard as GymCardT, type Place, type Style } from "@/lib/types";

export default function CityPage({ place, gyms, style }: { place: Place; gyms: GymCardT[]; style?: Style }) {
  const base = `/gyms/${place.state.toLowerCase()}/${place.slug.replace(/-[a-z]{2}$/, "")}`;
  const label = style ? STYLE_LABEL[style] : "Muay Thai & Kickboxing";
  const beginner = gyms.filter((g) => g.tags.includes("beginner_friendly"));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${label} gyms in ${place.city}, ${place.state}`,
    numberOfItems: gyms.length,
    itemListElement: gyms.map((g, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE.url}/gym/${g.slug}`,
      name: g.name,
    })),
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
      <nav className="text-sm text-muted mb-4">
        <Link href="/gyms" className="hover:text-ink">Gyms</Link> / {place.state} /{" "}
        {style ? <Link href={base} className="hover:text-ink">{place.city}</Link> : place.city}
        {style && ` / ${STYLE_LABEL[style]}`}
      </nav>
      <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
        {label} gyms in {place.city}, {place.state}
      </h1>
      <p className="mt-3 text-muted max-w-2xl">
        {gyms.length} gym{gyms.length === 1 ? "" : "s"} listed
        . Listed alphabetically. Check with the gym for current classes, prices and trial availability.
      </p>

      <div className="mt-6 flex flex-wrap gap-2 text-sm">
        <Link href={base} className={`rounded-full border px-3 py-1 ${!style ? "border-accent text-accent" : "border-line text-muted hover:text-ink"}`}>All</Link>
        {LIVE_STYLES.filter((s) => gyms.some((g) => g.styles.includes(s))).map((s) => (
          <Link
            key={s}
            href={`${base}/${STYLE_SLUG[s]}`}
            className={`rounded-full border px-3 py-1 ${style === s ? "border-accent text-accent" : "border-line text-muted hover:text-ink"}`}
          >
            {STYLE_LABEL[s]}
          </Link>
        ))}
      </div>

      {gyms.length === 0 ? (
        <p className="mt-10 text-muted">No gyms listed yet. <Link href="/gyms" className="underline">Browse other cities.</Link></p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {gyms.map((g) => (
            <GymCard key={g.id} gym={g} />
          ))}
        </div>
      )}

      {beginner.length > 0 && (
        <section className="mt-14 max-w-3xl">
          <h2 className="text-xl font-semibold">Starting {label.toLowerCase()} in {place.city} as a beginner</h2>
          <p className="mt-2 text-muted text-sm">
            {beginner.length} of the {gyms.length} listings here are tagged beginner friendly:{" "}
            {beginner.map((g, i) => (
              <span key={g.id}>
                <Link href={`/gym/${g.slug}`} className="text-ink underline">{g.name}</Link>
                {i < beginner.length - 1 ? ", " : "."}
              </span>
            ))}{" "}
            Ask the gym which classes welcome new students and whether equipment or a trial fee is required.
          </p>
        </section>
      )}
    </div>
  );
}

import Link from "next/link";
import GymList from "@/components/GymList";
import { miles } from "@/lib/format";
import { NEARBY_RADIUS_MI, byCompleteness, coverage, coverageLine, listingSummary, type NearbyPlace } from "@/lib/geo";
import { SITE, breadcrumbJsonLd, cityPath, distinctStyles, jsonLd as serializeJsonLd } from "@/lib/site";
import { STYLE_LABEL, type GymCard as GymCardT, type Place, type Style } from "@/lib/types";

function NearbyCities({ city, nearby }: { city: string; nearby: NearbyPlace[] }) {
  const isolated = nearby.some((n) => n.distanceMi > NEARBY_RADIUS_MI);
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold">Nearby cities</h2>
      <p className="mt-1 text-sm text-muted">
        {isolated ? `No other listed cities within ${NEARBY_RADIUS_MI} miles of ${city}. Nearest listed cities:` : `Listed gyms within about ${NEARBY_RADIUS_MI} miles of ${city}.`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {nearby.map(({ place, distanceMi, count }) => (
          <Link key={place.slug} href={cityPath(place)} className="rounded-full border border-line px-4 py-2 text-sm hover:border-accent">
            {place.city}, {place.state} <span className="text-muted">({count} · {miles(distanceMi)})</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** `cityGyms` is the unfiltered city listing; a discipline page passes it so chips are judged against the whole city. */
export default function CityPage({ place, gyms, style, nearby = [], cityGyms = gyms }: { place: Place; gyms: GymCardT[]; style?: Style; nearby?: NearbyPlace[]; cityGyms?: GymCardT[] }) {
  const base = cityPath(place);
  const label = style ? STYLE_LABEL[style] : "Muay Thai & Kickboxing";
  const ordered = [...gyms].sort(byCompleteness);
  const beginner = ordered.filter((g) => g.tags.includes("beginner_friendly"));
  const thin = gyms.length < 4 && nearby.length > 0;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${label} gyms in ${place.city}, ${place.state}`,
    numberOfItems: ordered.length,
    itemListElement: ordered.map((g, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE.url}/gym/${g.slug}`,
      name: g.name,
    })),
  };

  const trail = [{ name: "Gyms", path: "/gyms" }, { name: `${place.city}, ${place.state}`, path: base }];
  if (style) trail.push({ name: STYLE_LABEL[style], path: cityPath(place, style) });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd(trail)) }} />
      <nav className="text-sm text-muted mb-4">
        <Link href="/gyms" className="hover:text-ink">Gyms</Link> / {place.state} /{" "}
        {style ? <Link href={base} className="hover:text-ink">{place.city}</Link> : place.city}
        {style && ` / ${STYLE_LABEL[style]}`}
      </nav>
      <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
        {label} gyms in {place.city}, {place.state}
      </h1>
      {gyms.length > 0 && <p className="mt-3 max-w-2xl">{listingSummary(label, place, gyms)}</p>}
      <p className="mt-2 text-muted max-w-2xl text-sm">
        {coverageLine(coverage(gyms))} · most complete listings first. Check with the gym for current classes, prices and trial availability.
      </p>

      <div className="mt-6 flex flex-wrap gap-2 text-sm">
        <Link href={base} className={`rounded-full border px-3 py-1 ${!style ? "border-accent text-accent" : "border-line text-muted hover:text-ink"}`}>All</Link>
        {distinctStyles(cityGyms).map((s) => (
          <Link
            key={s}
            href={cityPath(place, s)}
            className={`rounded-full border px-3 py-1 ${style === s ? "border-accent text-accent" : "border-line text-muted hover:text-ink"}`}
          >
            {STYLE_LABEL[s]}
          </Link>
        ))}
      </div>

      {thin && <NearbyCities city={place.city} nearby={nearby} />}

      {gyms.length === 0 ? (
        <p className="mt-10 text-muted">No gyms listed yet. <Link href="/gyms" className="underline">Browse other cities.</Link></p>
      ) : (
        <GymList gyms={ordered} />
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

      {nearby.length > 0 && <NearbyCities city={place.city} nearby={nearby} />}
      <p className="mt-10 text-sm text-muted">Gym missing? <Link href="/claim#submit" className="underline">Submit it.</Link></p>
    </div>
  );
}

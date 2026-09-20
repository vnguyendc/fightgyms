import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, FighterBadge } from "@/components/GymCard";
import { DOW, fmtTime, getAllGyms, getGym, money } from "@/lib/data";
import { SITE } from "@/lib/site";
import { STYLE_LABEL, TAG_LABEL, type Price } from "@/lib/types";

export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  const gyms = await getAllGyms();
  return gyms.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: PageProps<"/gym/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const g = await getGym(slug);
  if (!g) return {};
  const bits = [
    g.drop_in_cents != null ? `${money(g.drop_in_cents)} drop-in` : null,
    g.monthly_cents != null ? `${money(g.monthly_cents)}/mo` : null,
    g.active_fighters ? `${g.active_fighters} active fighters` : null,
  ].filter(Boolean);
  return {
    title: `${g.name} — ${g.city}, ${g.state}`,
    description: `${g.name} in ${g.city}, ${g.state}: ${bits.join(", ") || g.styles.map((s) => STYLE_LABEL[s]).join(", ")}. Prices, class schedule, coaches and fighter records.`,
    alternates: { canonical: `${SITE.url}/gym/${g.slug}` },
  };
}

const PRICE_LABEL: Record<Price["kind"], string> = {
  drop_in: "Drop-in class",
  monthly: "Monthly unlimited",
  fighter: "Fight team rate",
  trial: "Intro / trial",
  private: "Private session",
  class_pack: "Class pack",
};

const VERIFIED_LABEL: Record<string, string> = {
  manual: "verified by phone",
  phone: "verified by phone",
  gym_claim: "confirmed by gym",
  website: "from gym website",
  user_report: "reported by a member",
};

export default async function GymPage({ params }: PageProps<"/gym/[slug]">) {
  const { slug } = await params;
  const g = await getGym(slug);
  if (!g) notFound();

  const cityHref = g.place_slug ? `/gyms/${g.state?.toLowerCase()}/${g.place_slug.replace(/-[a-z]{2}$/, "")}` : "/gyms";
  const byDay = new Map<number, typeof g.classes>();
  for (const c of g.classes) byDay.set(c.dow, [...(byDay.get(c.dow) ?? []), c]);
  const lastVerified = g.prices.map((p) => p.verified_at).filter(Boolean).sort().at(-1);
  const order: Price["kind"][] = ["drop_in", "trial", "class_pack", "monthly", "fighter", "private"];
  const prices = [...g.prices].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": ["SportsActivityLocation", "LocalBusiness"],
    name: g.name,
    url: g.website ?? undefined,
    telephone: g.phone ?? undefined,
    address: g.address ? { "@type": "PostalAddress", streetAddress: g.address, addressLocality: g.city, addressRegion: g.state } : undefined,
    geo: g.lat && g.lng ? { "@type": "GeoCoordinates", latitude: g.lat, longitude: g.lng } : undefined,
    aggregateRating: g.google_rating
      ? { "@type": "AggregateRating", ratingValue: g.google_rating, reviewCount: g.google_reviews }
      : undefined,
    priceRange: g.drop_in_cents != null ? `${money(g.drop_in_cents)} drop-in` : undefined,
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <nav className="text-sm text-muted mb-4">
        <Link href="/gyms" className="hover:text-ink">Gyms</Link> /{" "}
        <Link href={cityHref} className="hover:text-ink">{g.city}, {g.state}</Link> / {g.name}
      </nav>

      {g.is_sample && (
        <div className="mb-4 rounded-md border border-gold/50 bg-gold/10 px-3 py-2 text-sm text-gold">
          Sample listing — fictional gym used for development.
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
            {g.name}
            {g.claimed && <span className="ml-3 text-accent text-base align-middle">✓ claimed</span>}
          </h1>
          <p className="mt-2 text-muted">{g.address}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {g.styles.map((s) => <Badge key={s} tone="accent">{STYLE_LABEL[s] ?? s}</Badge>)}
            <FighterBadge active={g.active_fighters} pro={g.pro_fighters} />
            {g.tags.map((t) => <Badge key={t}>{TAG_LABEL[t] ?? t}</Badge>)}
            {g.affiliation && <Badge tone="gold">{g.affiliation} affiliate</Badge>}
          </div>
          {g.description && <p className="mt-5 max-w-2xl text-ink/90">{g.description}</p>}

          {/* prices */}
          <section className="mt-10">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-semibold">Prices</h2>
              {lastVerified && <span className="text-xs text-muted">last verified {lastVerified}</span>}
            </div>
            {g.prices.length === 0 ? (
              <p className="mt-2 text-muted text-sm">No verified prices yet. <Link href={`/claim?gym=${g.slug}`} className="underline">Know them?</Link></p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {prices.map((p) => (
                    <tr key={p.kind} className="border-t border-line">
                      <td className="py-2.5 pr-3">{PRICE_LABEL[p.kind]}</td>
                      <td className="py-2.5 pr-3 font-mono text-base">{money(p.amount_cents)}</td>
                      <td className="py-2.5 pr-3 text-muted">
                        {p.contract_months ? `${p.contract_months}-mo contract` : p.contract_months === 0 ? "month to month" : ""}
                        {p.free_trial ? " · free trial" : ""}
                        {p.notes ? ` · ${p.notes}` : ""}
                      </td>
                      <td className="py-2.5 text-right text-xs text-muted whitespace-nowrap">{VERIFIED_LABEL[p.verified_by ?? ""] ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* schedule */}
          <section className="mt-10">
            <h2 className="text-xl font-semibold">Class schedule</h2>
            {g.classes.length === 0 ? (
              <p className="mt-2 text-muted text-sm">No schedule yet. {g.website && <a href={g.website} className="underline" rel="nofollow">Check the gym's site.</a>}</p>
            ) : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3, 4, 5, 6, 0].filter((d) => byDay.has(d)).map((d) => (
                  <div key={d} className="rounded-lg border border-line p-3">
                    <div className="font-mono text-xs text-muted mb-2">{DOW[d]}</div>
                    <ul className="space-y-1.5 text-sm">
                      {byDay.get(d)!.map((c, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="font-mono text-muted w-16 shrink-0">{fmtTime(c.start_time)}</span>
                          <span>
                            {c.name}
                            {c.level && c.level !== "all" && <span className="ml-1.5 text-xs text-accent">{c.level}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* coaches */}
          {g.coaches.length > 0 && (
            <section className="mt-10">
              <h2 className="text-xl font-semibold">Coaches</h2>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {g.coaches.map((c) => (
                  <li key={c.slug} className="rounded-lg border border-line p-3 text-sm">
                    <div className="font-medium">
                      {c.name}
                      {c.is_thai && <span className="ml-2 text-xs text-gold">🇹🇭 Thai</span>}
                    </div>
                    {c.pro_record && <div className="font-mono text-xs text-muted mt-0.5">{c.pro_record}</div>}
                    {c.lineage && <div className="text-muted mt-1">{c.lineage}</div>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* fighters */}
          {g.fighters.length > 0 && (
            <section className="mt-10">
              <div className="flex items-baseline justify-between">
                <h2 className="text-xl font-semibold">Fight team</h2>
                <span className="text-xs text-muted">records from Tapology / Smoothcomp / promotions</span>
              </div>
              <table className="mt-3 w-full text-sm">
                <thead className="text-xs text-muted">
                  <tr><th className="text-left font-normal py-1">Fighter</th><th className="text-left font-normal">Discipline</th><th className="text-left font-normal">Level</th><th className="text-left font-normal">Weight</th><th className="text-left font-normal">Record</th><th className="text-left font-normal">Last bout</th></tr>
                </thead>
                <tbody>
                  {g.fighters.map((f) => (
                    <tr key={f.slug} className="border-t border-line">
                      <td className="py-2">{f.name}</td>
                      <td className="py-2 text-muted">{f.discipline ? STYLE_LABEL[f.discipline as keyof typeof STYLE_LABEL] ?? f.discipline : ""}</td>
                      <td className="py-2 text-muted">{f.level}</td>
                      <td className="py-2 text-muted">{f.weight_class}</td>
                      <td className="py-2 font-mono">{f.record_w}-{f.record_l}{f.record_d ? `-${f.record_d}` : ""}</td>
                      <td className="py-2 text-muted">{f.last_bout}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>

        {/* sidebar */}
        <aside className="space-y-4">
          <div className="rounded-xl border border-line bg-panel p-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><div className="text-xs text-muted">Drop-in</div><div className="font-mono text-xl">{money(g.drop_in_cents)}</div></div>
              <div><div className="text-xs text-muted">Monthly</div><div className="font-mono text-xl">{money(g.monthly_cents)}</div></div>
            </div>
            {g.google_rating != null && (
              <div className="mt-4 text-muted">★ {g.google_rating.toFixed(1)} · {g.google_reviews} Google reviews</div>
            )}
            <div className="mt-4 space-y-1.5">
              {g.website && <a href={g.website} rel="nofollow noopener" target="_blank" className="block underline hover:text-accent">Website ↗</a>}
              {g.instagram && <a href={`https://instagram.com/${g.instagram.replace(/^@/, "")}`} rel="nofollow noopener" target="_blank" className="block underline hover:text-accent">@{g.instagram.replace(/^@/, "")}</a>}
              {g.phone && <a href={`tel:${g.phone}`} className="block underline hover:text-accent">{g.phone}</a>}
              {g.address && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(g.address)}`} rel="nofollow noopener" target="_blank" className="block underline hover:text-accent">Directions ↗</a>}
            </div>
            {g.founded_year && <div className="mt-4 text-xs text-muted">Est. {g.founded_year}</div>}
          </div>
          <div className="rounded-xl border border-line p-4 text-sm">
            <div className="font-medium">{g.claimed ? "Own this gym?" : "Is this your gym?"}</div>
            <p className="text-muted mt-1">Claim the listing to fix prices, update the schedule and add your fight team.</p>
            <Link href={`/claim?gym=${g.slug}`} className="mt-3 inline-block rounded-md bg-accent px-3 py-1.5 text-white font-medium">Claim free →</Link>
          </div>
          <div className="rounded-xl border border-line p-4 text-sm">
            <div className="font-medium">Something wrong?</div>
            <p className="text-muted mt-1">Train here? Tell us what changed and we'll verify it.</p>
            <Link href={`/claim?gym=${g.slug}&fix=1`} className="mt-3 inline-block underline">Suggest a fix</Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

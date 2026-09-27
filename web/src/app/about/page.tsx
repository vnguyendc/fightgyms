import Link from "next/link";
import { SITE, pageMetadata } from "@/lib/site";

export async function generateMetadata() {
  return pageMetadata("/about", `About ${SITE.name}`,
    `How ${SITE.name} lists Muay Thai and kickboxing gyms: where the data comes from, how prices are verified and dated, what is never shown, and how to correct a listing.`);
}

// Every claim here must match how the directory actually works. Do not describe features that are not shipped.
const TIERS = [
  ["manually checked", "someone on the directory checked the fact against the gym directly"],
  ["verified by phone", "the gym confirmed it by phone"],
  ["confirmed by gym", "the gym confirmed it through a verified claim"],
  ["from gym website", "read from a page on the gym’s own website, with the date it was read"],
  ["reported by a member", "sent in through the correction box and reviewed before it appears"],
] as const;

export default async function About() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">About {SITE.name}</h1>
      <p className="mt-4 text-muted">
        {SITE.name} is a directory of Muay Thai and kickboxing gyms in Washington, DC, Maryland and Virginia. Each listing carries the gym’s
        location and website, and, where the gym publishes them, its prices and class schedule with the date they were checked.
      </p>

      <h2 className="mt-10 text-xl font-semibold">Where the data comes from</h2>
      <p className="mt-2 text-muted">
        Gyms are found through public sources and each candidate is reviewed before it is listed. Prices, schedules and photos come from the
        gym’s own website or from the gym itself. We never invent or estimate a price, a schedule or an address: when a gym does not publish
        a fact, the listing says so instead of filling the gap.
      </p>

      <h2 className="mt-10 text-xl font-semibold">How facts are verified</h2>
      <p className="mt-2 text-muted">Each price shows how it was verified and when. The tiers, from strongest to weakest, are:</p>
      <ul className="mt-3 space-y-1 text-muted list-disc pl-5">
        {TIERS.map(([label, meaning]) => (
          <li key={label}><span className="text-ink">{label}</span>: {meaning}.</li>
        ))}
      </ul>
      <p className="mt-3 text-muted">
        Prices are kept as a history rather than overwritten, so a listing always shows the most recent verified amount and its date. Directory
        pages refresh about once an hour after data changes.
      </p>

      <h2 className="mt-10 text-xl font-semibold">What is never shown</h2>
      <ul className="mt-2 space-y-1 text-muted list-disc pl-5">
        <li>Star ratings or review counts copied from other platforms. Listings are ordered by how complete they are, not by ratings.</li>
        <li>Photos taken from map or social platforms. Photos come only from the gym’s own website or from a verified claimant.</li>
        <li>Guessed prices, schedules or hours.</li>
      </ul>

      <h2 className="mt-10 text-xl font-semibold">Corrections</h2>
      <p className="mt-2 text-muted">
        Every gym page has a correction box. Submissions are reviewed by a person before anything changes; nothing is published automatically.
        There is no public inbox yet, so the correction box is the way to reach us about a listing. Gym owners will be able to claim and update
        their own listing when claims launch.
      </p>

      <h2 className="mt-10 text-xl font-semibold">Coverage</h2>
      <p className="mt-2 text-muted">
        Muay Thai and kickboxing are live today. Other disciplines are tracked but not yet published. See the{" "}
        <Link href="/privacy" className="underline">privacy notice</Link> for what this site records about visitors.
      </p>
    </div>
  );
}

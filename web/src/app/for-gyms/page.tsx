import Link from "next/link";
import { money } from "@/lib/format";
import { FOUNDING_PRICE_CENTS, salesEmail, salesPaymentLink } from "@/lib/sales";
import { SITE, pageMetadata } from "@/lib/site";

const PRICE = money(FOUNDING_PRICE_CENTS);

export async function generateMetadata() {
  return pageMetadata("/for-gyms", `For gym owners · ${SITE.name}`,
    `A founding featured listing on ${SITE.name} is ${PRICE} for one year: top placement on your city pages, a Featured badge, and a monthly count of clicks to your site, phone and social links.`);
}

export default async function ForGyms() {
  const email = salesEmail();
  const paymentLink = salesPaymentLink();
  const mailto = email ? `mailto:${email}?subject=${encodeURIComponent("Featured listing")}` : null;
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">For gym owners</h1>
      <p className="mt-4 text-muted">
        {SITE.name} lists Muay Thai and kickboxing gyms so people can find a place to train. A founding featured listing is a paid placement for one gym, for one year.
      </p>
      <p className="mt-3 text-lg">Founding price: {PRICE} for one year.</p>

      <h2 className="mt-10 text-xl font-semibold">What you get</h2>
      <ul className="mt-3 space-y-2 text-muted list-disc pl-5">
        <li>Your gym is pinned at the top of its city page and its Muay Thai or kickboxing page. The order of every other gym on those pages stays the same.</li>
        <li>A Featured badge on that listing and on your gym’s page, while the placement is active. When the end date passes, the badge and the pin stop on their own.</li>
        <li>Verified owners can publish the gym’s name, address, website, phone, description, and trial, drop-in and monthly prices. Those prices are labeled owner-supplied and are not independently checked.</li>
        <li>Photos and the class schedule are shown when they come from the gym. This listing does not add a separate photo or schedule editor.</li>
        <li>A monthly count of clicks on the gym’s website, phone and social links. The count is how many clicks, not who clicked. We can send that total to you; the site does not email it by itself.</li>
      </ul>

      <h2 className="mt-10 text-xl font-semibold">What it is not</h2>
      <ul className="mt-3 space-y-2 text-muted list-disc pl-5">
        <li>It does not change search rankings on Google, and it does not promise visitors or new members.</li>
        <li>Claiming a gym is still free. A featured listing is separate, and paying does not verify ownership.</li>
        <li>The badge does not turn on by itself. After payment we mark the gym featured by hand and set the last day of the year.</li>
      </ul>

      <h2 className="mt-10 text-xl font-semibold">Ask for a founding listing</h2>
      {mailto || paymentLink ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {mailto && <a href={mailto} className="rounded-md bg-accent px-4 py-2 font-medium text-white">Email us</a>}
          {paymentLink && <a href={paymentLink} className="rounded-md border border-line px-4 py-2 hover:border-accent" rel="noopener noreferrer">Pay {PRICE}</a>}
        </div>
      ) : (
        <p className="mt-3 text-muted">The contact address for founding listings is not set in this environment.</p>
      )}
      {paymentLink && <p className="mt-3 text-sm text-muted">The payment button opens Stripe. We confirm the payment before the listing is marked featured.</p>}
      <p className="mt-6 text-sm text-muted">
        Already listed? <Link href="/claim" className="underline">Sign in to claim the gym</Link> or open your gym’s page and follow the owner link.
      </p>
    </div>
  );
}

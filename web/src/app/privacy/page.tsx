import Link from "next/link";
import { SITE, pageMetadata } from "@/lib/site";

export async function generateMetadata() {
  return pageMetadata("/privacy", "Privacy",
    `What ${SITE.name} records about visitors and about the people who send listing corrections, and how it is used.`);
}

// Keep this in step with the correction form, the analytics mounted in the root layout, and the server error logging.
export default async function Privacy() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Privacy</h1>
      <p className="mt-4 text-muted">{SITE.name} has no accounts, no advertising and no third-party ad trackers. This page lists everything the site records.</p>

      <h2 className="mt-10 text-xl font-semibold">Listing corrections</h2>
      <p className="mt-2 text-muted">
        When you send a correction from a gym page, we store the gym, the field you are reporting, the value you entered, your note, and your
        contact email if you chose to give one. The email is optional and is used only to follow up on that correction. Submissions are
        held for review and are not published; the note and email never appear on the site.
      </p>

      <h2 className="mt-10 text-xl font-semibold">Site analytics</h2>
      <p className="mt-2 text-muted">
        The site uses Vercel Web Analytics and Vercel Speed Insights, which record page views, the referring page, country, device and browser
        type, and page performance measurements. They do not set cookies and do not build a profile of you across other sites.
      </p>

      <h2 className="mt-10 text-xl font-semibold">Server logs</h2>
      <p className="mt-2 text-muted">
        When a page fails, the server writes one log line with the route, the request method, the path without any query string, and an error
        reference. Request headers, form contents and email addresses are not logged. The same reference is shown on the error page so a
        report can be matched to that line.
      </p>

      <h2 className="mt-10 text-xl font-semibold">Gym information</h2>
      <p className="mt-2 text-muted">
        Listings contain business information about gyms taken from public sources and the gym’s own website. If you represent a gym and want
        a listing corrected or removed, use the correction box on the gym’s page. Read <Link href="/about" className="underline">how listings are built</Link> for the sourcing rules.
      </p>

      <h2 className="mt-10 text-xl font-semibold">Hosting</h2>
      <p className="mt-2 text-muted">The site is hosted on Vercel and its data is stored with Supabase. Both process requests on our behalf and do not receive the correction contents for any other purpose.</p>
    </div>
  );
}

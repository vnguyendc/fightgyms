import Link from "next/link";
import { SITE, pageMetadata } from "@/lib/site";

export async function generateMetadata() {
  return pageMetadata("/privacy", "Privacy",
    `What ${SITE.name} records about visitors, accounts, gym claims and submissions, and how it is used.`);
}

// Keep this in step with the correction form, the analytics mounted in the root layout, and the server error logging.
export default async function Privacy() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Privacy</h1>
      <p className="mt-4 text-muted">{SITE.name} has no advertising or third-party ad trackers. This page explains what we record when you browse, sign in, claim a gym or send a submission.</p>

      <h2 className="mt-10 text-xl font-semibold">Accounts and sign-in cookies</h2>
      <p className="mt-2 text-muted">
        We use Supabase to create email accounts and send sign-in links. Supabase stores your email and account ID. Sign-in uses a link
        sent to your email, without a password. Cookies in your browser keep you signed in and connect your claims and submissions to your account.
      </p>

      <h2 className="mt-10 text-xl font-semibold">Listing corrections</h2>
      <p className="mt-2 text-muted">
        When you send a correction from a gym page, we store the gym, the field you are reporting, the value you entered, your note, and your
        submission time and review status. If you are signed out, a contact email is optional. If you are signed in, we store your account ID
        and verified account email, even if you leave the email field blank or enter a different address. We use the email to follow up on
        the correction and the account to show your submission status and identify corrections from verified gym representatives.
        Corrections are reviewed by hand before listing details change. Your note, email and account ID are not published.
      </p>

      <h2 className="mt-10 text-xl font-semibold">Gym claims and new gym submissions</h2>
      <p className="mt-2 text-muted">
        Claims store the gym, your role and note, your account ID and verified email, submission and review times, and review status.
        We also record the gym website domain and whether your email domain matches it to help review the claim. New gym submissions store
        the gym name, address, city, state, website, Instagram handle, disciplines, your role and note, your account ID and verified email,
        submission time and review status.
      </p>
      <p className="mt-2 text-muted">
        Every claim and submission is reviewed by hand, and we may email you with a question. Approved gym details and a verified claim badge
        may appear in the directory. Your email, account ID and notes are not published. You can see your own claims, submissions and their status when signed in.
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
      <p className="mt-2 text-muted">The site is hosted on Vercel and its data and accounts are stored with Supabase. Both process requests on our behalf and do not receive the correction contents for any other purpose.</p>
    </div>
  );
}

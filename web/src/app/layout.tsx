import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import SiteHeader from "@/components/SiteHeader";
import SiteJsonLd from "@/components/SiteJsonLd";
import { hasUpcomingEvents } from "@/lib/events-nav";
import { SITE, layoutRobots, runtimePolicy } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name} — ${SITE.tagline}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
  openGraph: { siteName: SITE.name, type: "website" },
  twitter: { card: "summary" },
  robots: layoutRobots(runtimePolicy()),
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const showEvents = await hasUpcomingEvents();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <SiteJsonLd />
        <SiteHeader showEvents={showEvents} />
        {runtimePolicy().mode === "demo" && <div className="border-b border-gold/50 bg-gold/10 px-4 py-3 text-center text-sm text-gold">Demo directory — all listings are fictional samples, not real gyms.</div>}
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line mt-16">
          <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted flex flex-wrap gap-x-6 gap-y-2 justify-between">
            <span>© {new Date().getFullYear()} {SITE.name}. Confirm current prices and schedules with the gym before visiting.</span>
            <span className="flex gap-4">
              <Link href="/gyms" className="hover:text-ink">All cities</Link>
              <Link href="/gyms/all" className="hover:text-ink">All gyms</Link>
              <Link href="/about" className="hover:text-ink">About</Link>
              <Link href="/for-gyms" className="hover:text-ink">For gym owners</Link>
              <Link href="/privacy" className="hover:text-ink">Privacy</Link>
              <Link href="/claim" className="hover:text-ink">Claim or submit a gym</Link>
            </span>
          </div>
        </footer>
        {/* Vercel Web Analytics + Speed Insights: no-ops off Vercel; enable both in the project dashboard. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}

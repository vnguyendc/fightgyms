import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import SiteSearch from "@/components/SiteSearch";
import { SITE, runtimePolicy } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name} — ${SITE.tagline}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
  openGraph: { siteName: SITE.name, type: "website" },
  twitter: { card: "summary" },
  robots: { index: runtimePolicy().indexable, follow: runtimePolicy().indexable },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-line">
          <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between gap-4">
            <Link href="/" className="font-semibold tracking-tight text-lg">
              <span className="text-accent">▲</span> {SITE.name}
            </Link>
            <nav className="flex items-center gap-4 text-sm text-muted">
              <div className="hidden sm:block"><SiteSearch /></div>
              <Link href="/search" className="sm:hidden hover:text-ink">Search</Link>
              <Link href="/gyms" className="hover:text-ink">Gyms</Link>
              <Link href="/events" className="hover:text-ink">Events</Link>
              <Link href="/claim" className="hidden sm:inline-block rounded-md border border-line px-3 py-1.5 hover:border-accent hover:text-ink">
                Gym updates
              </Link>
            </nav>
          </div>
        </header>
        {runtimePolicy().mode === "demo" && <div className="border-b border-gold/50 bg-gold/10 px-4 py-3 text-center text-sm text-gold">Demo directory — all listings are fictional samples, not real gyms.</div>}
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line mt-16">
          <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted flex flex-wrap gap-x-6 gap-y-2 justify-between">
            <span>© {new Date().getFullYear()} {SITE.name}. Confirm current prices and schedules with the gym before visiting.</span>
            <span className="flex gap-4">
              <Link href="/gyms" className="hover:text-ink">All cities</Link>
              <Link href="/claim" className="hover:text-ink">Updates (not available yet)</Link>
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

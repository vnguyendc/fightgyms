import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { SITE } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name} — ${SITE.tagline}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
  openGraph: { siteName: SITE.name, type: "website" },
  twitter: { card: "summary_large_image", site: SITE.twitter },
  robots: { index: true, follow: true },
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
            <nav className="flex items-center gap-5 text-sm text-muted">
              <Link href="/gyms" className="hover:text-ink">Gyms</Link>
              <Link href="/events" className="hover:text-ink">Events</Link>
              <Link href="/claim" className="rounded-md border border-line px-3 py-1.5 hover:border-accent hover:text-ink">
                Claim your gym
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line mt-16">
          <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted flex flex-wrap gap-x-6 gap-y-2 justify-between">
            <span>© {new Date().getFullYear()} {SITE.name}. Prices and schedules are verified by hand where marked; corrections welcome.</span>
            <span className="flex gap-4">
              <Link href="/gyms" className="hover:text-ink">All cities</Link>
              <Link href="/claim" className="hover:text-ink">Add or fix a gym</Link>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}

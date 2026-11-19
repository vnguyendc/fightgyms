import Link from "next/link";
import SiteSearch from "@/components/SiteSearch";
import { SITE } from "@/lib/site";

export default function SiteHeader({ showEvents }: { showEvents: boolean }) {
  return (
    <header className="border-b border-line">
      <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between gap-4">
        <Link href="/" className="font-semibold tracking-tight text-lg">
          <span className="text-accent">▲</span> {SITE.name}
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted">
          <div className="hidden sm:block"><SiteSearch /></div>
          <Link href="/search" className="sm:hidden hover:text-ink">Search</Link>
          <Link href="/gyms" className="hover:text-ink">Gyms</Link>
          {showEvents && <Link href="/events" className="hover:text-ink">Events</Link>}
          <Link href="/claim" className="hidden sm:inline-block rounded-md border border-line px-3 py-1.5 hover:border-accent hover:text-ink">
            Gym updates
          </Link>
        </nav>
      </div>
    </header>
  );
}

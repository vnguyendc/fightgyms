"use client";

import Link from "next/link";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { nearestPlace } from "@/lib/geo";
import { EMPTY_INDEX, matchIndex, type SearchIndex } from "@/lib/search";

type Item = { key: string; label: string; detail: string; href: string };

/**
 * One box for gym and city names. Plain GET form to /search without JavaScript; with it, suggestions
 * come from /api/search-index (fetched once, on first focus) and "Use my location" jumps to the nearest listed city.
 * No router hooks: suggestions are <Link>s, Enter clicks the active one.
 */
export default function SiteSearch({ size = "compact", initialQuery = "" }: { size?: "compact" | "large"; initialQuery?: string }) {
  const id = useId();
  const listId = `${id}-listbox`;
  const [query, setQuery] = useState(initialQuery);
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [locating, setLocating] = useState(false);
  const pending = useRef<Promise<SearchIndex> | null>(null);
  const links = useRef<(HTMLAnchorElement | null)[]>([]);

  function loadIndex(): Promise<SearchIndex> {
    if (!pending.current) {
      pending.current = fetch("/api/search-index")
        .then((r) => (r.ok ? (r.json() as Promise<SearchIndex>) : EMPTY_INDEX))
        .catch(() => EMPTY_INDEX)
        .then((idx) => { setIndex(idx); return idx; });
    }
    return pending.current;
  }

  const q = query.trim();
  const matches = q && index ? matchIndex(q, index, 6) : EMPTY_INDEX;
  const items: Item[] = [
    ...matches.places.map((p) => ({ key: `p-${p.slug}`, label: `${p.city}, ${p.state}`, detail: `${p.count} gym${p.count === 1 ? "" : "s"}`, href: p.path })),
    ...matches.gyms.map((g) => ({ key: `g-${g.slug}`, label: g.name, detail: [g.city, g.state].filter(Boolean).join(", "), href: g.path })),
  ];
  // Only evaluated once the list is open (a client event), so server and first client render agree.
  const canLocate = !q && typeof navigator !== "undefined" && !!navigator.geolocation;
  const offset = canLocate ? 1 : 0;
  const count = items.length + offset;

  function locate() {
    if (locating || typeof navigator === "undefined" || !navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const idx = await loadIndex();
        const place = nearestPlace({ lat: pos.coords.latitude, lng: pos.coords.longitude }, idx.places);
        setLocating(false);
        if (place) window.location.assign(place.path);
      },
      () => setLocating(false),
      { maximumAge: 300000, timeout: 10000 },
    );
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || count === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % count); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a <= 0 ? count - 1 : a - 1)); }
    else if (e.key === "Escape") { setOpen(false); setActive(-1); }
    else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      if (canLocate && active === 0) locate();
      else links.current[active - offset]?.click();
    }
  }

  const large = size === "large";
  return (
    <form action="/search" method="get" role="search" className={`relative ${large ? "max-w-xl" : "w-48 md:w-64"}`}>
      <label htmlFor={`${id}-input`} className="sr-only">Search gyms and cities</label>
      <input
        id={`${id}-input`}
        name="q"
        type="search"
        value={query}
        placeholder={large ? "Search a gym or city" : "Gym or city"}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && count > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        onFocus={() => { setOpen(true); void loadIndex(); }}
        onBlur={() => setOpen(false)}
        onChange={(e) => { setQuery(e.target.value); setActive(-1); setOpen(true); }}
        onKeyDown={onKeyDown}
        className={`w-full rounded-md border border-line bg-panel px-3 focus:border-accent focus:outline-none ${large ? "py-3 text-base" : "py-1.5 text-sm"}`}
      />
      {open && count > 0 && (
        <ul
          id={listId}
          role="listbox"
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-md border border-line bg-panel text-sm shadow-lg"
        >
          {canLocate && (
            <li id={`${listId}-0`} role="option" aria-selected={active === 0}>
              <button type="button" onClick={locate} className={`block w-full px-3 py-2 text-left ${active === 0 ? "bg-bg" : ""}`}>
                {locating ? "Locating…" : "Use my location"} <span className="text-muted">nearest listed city</span>
              </button>
            </li>
          )}
          {items.map((item, i) => {
            const at = i + offset;
            return (
              <li key={item.key} id={`${listId}-${at}`} role="option" aria-selected={active === at}>
                <Link href={item.href} ref={(el) => { links.current[i] = el; }} className={`flex justify-between gap-3 px-3 py-2 ${active === at ? "bg-bg" : ""}`}>
                  <span>{item.label}</span>
                  <span className="text-muted">{item.detail}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </form>
  );
}

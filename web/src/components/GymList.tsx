"use client";

import { useState } from "react";
import GymCard from "@/components/GymCard";
import SortControl, { type SortMode } from "@/components/SortControl";
import { byName, isFeatured, pinFeatured, withDistances } from "@/lib/geo";
import type { GymCard as GymCardT } from "@/lib/types";

/**
 * `gyms` arrive in the server's default order (most complete first) and are rendered untouched
 * in that mode, so the hydrated tree matches the static HTML exactly.
 */
export default function GymList({ gyms, today }: { gyms: GymCardT[]; today?: string }) {
  const [mode, setMode] = useState<SortMode>("complete");
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

  function change(next: SortMode) {
    if (next !== "near" || origin) return setMode(next);
    if (typeof navigator === "undefined" || !navigator.geolocation || locating) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setMode("near");
        setLocating(false);
      },
      () => setLocating(false), // denied or unavailable: keep the current sort, no error ui
      { maximumAge: 300000, timeout: 10000 },
    );
  }

  const rows = pinFeatured(
    mode === "near" && origin ? withDistances(gyms, origin)
    : mode === "az" ? [...gyms].sort(byName).map((gym) => ({ gym, distanceMi: null as number | null }))
    : gyms.map((gym) => ({ gym, distanceMi: null as number | null })),
    (row) => isFeatured(row.gym, today),
  );

  return (
    <>
      <div className="mt-6"><SortControl mode={mode} onChange={change} locating={locating} /></div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(({ gym, distanceMi }) => (
          <GymCard key={gym.id} gym={gym} distanceMi={distanceMi} today={today} />
        ))}
      </div>
    </>
  );
}

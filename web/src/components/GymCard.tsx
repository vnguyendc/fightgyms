import Link from "next/link";
import { GymPhoto, PhotoFallback } from "@/components/GymPhoto";
import { miles, money } from "@/lib/format";
import { hasSchedule } from "@/lib/geo";
import { STYLE_LABEL, TAG_LABEL, type GymCard as GymCardT, type Tag } from "@/lib/types";

export function Badge({ children, tone = "line" }: { children: React.ReactNode; tone?: "line" | "accent" | "gold" }) {
  const cls =
    tone === "accent"
      ? "border-accent/60 text-accent"
      : tone === "gold"
        ? "border-gold/60 text-gold"
        : "border-line text-muted";
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${cls}`}>{children}</span>;
}

export function FighterBadge({ active, pro }: { active: number; pro: number }) {
  if (!active) return null;
  return (
    <Badge tone="gold">
      {active} active fighter{active === 1 ? "" : "s"}
      {pro ? ` · ${pro} pro` : ""}
    </Badge>
  );
}

/** The first price a first-time visitor cares about: to try, then to drop in, then to join. Null when none is listed. */
export function costLine(gym: Pick<GymCardT, "trial_cents" | "drop_in_cents" | "monthly_cents">): string | null {
  if (gym.trial_cents != null) return `Trial ${money(gym.trial_cents)}`;
  if (gym.drop_in_cents != null) return `Drop-in ${money(gym.drop_in_cents)}`;
  if (gym.monthly_cents != null) return `Monthly ${money(gym.monthly_cents)}/mo`;
  return null;
}

/** Beginner friendly leads; other tags keep their stored order. */
export function orderedTags(tags: Tag[]): Tag[] {
  return [...tags].sort((a, b) => Number(b === "beginner_friendly") - Number(a === "beginner_friendly"));
}

export default function GymCard({ gym, rank, distanceMi }: { gym: GymCardT; rank?: number; distanceMi?: number | null }) {
  const cost = costLine(gym);
  return (
    <Link
      href={`/gym/${gym.slug}`}
      className="block overflow-hidden rounded-xl border border-line bg-panel hover:border-accent/70 transition-colors"
    >
      <div className="relative aspect-video border-b border-line bg-bg">
        {gym.photo_path ? (
          <GymPhoto path={gym.photo_path} alt={gym.name} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" />
        ) : (
          <PhotoFallback styles={gym.styles} />
        )}
        {distanceMi != null && (
          <span className="absolute right-2 top-2 rounded-full border border-line bg-bg/90 px-2 py-0.5 font-mono text-xs">{miles(distanceMi)}</span>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-base leading-tight">
          {rank != null && <span className="text-muted mr-2 font-mono text-sm">#{rank}</span>}
          {gym.name}
        </h3>
        {gym.claimed && <span className="text-accent text-xs">✓ claimed</span>}
        <p className="text-sm text-muted mt-0.5 truncate">{gym.address ?? `${gym.city}, ${gym.state}`}</p>

        {cost ? (
          <p className="mt-3 font-mono text-sm">{cost}</p>
        ) : (
          <p className="mt-3 text-sm text-muted">Prices not listed</p>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {gym.styles.map((s) => (
            <Badge key={s} tone="accent">{STYLE_LABEL[s] ?? s}</Badge>
          ))}
          {orderedTags(gym.tags).slice(0, 3).map((t) => (
            <Badge key={t}>{TAG_LABEL[t] ?? t}</Badge>
          ))}
          {hasSchedule(gym) && <Badge tone="gold">Schedule listed</Badge>}
          <FighterBadge active={gym.active_fighters} pro={gym.pro_fighters} />
        </div>
      </div>
    </Link>
  );
}

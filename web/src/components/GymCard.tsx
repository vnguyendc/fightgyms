import Link from "next/link";
import { money } from "@/lib/data";
import { STYLE_LABEL, TAG_LABEL, type GymCard as GymCardT } from "@/lib/types";

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

export default function GymCard({ gym, rank }: { gym: GymCardT; rank?: number }) {
  return (
    <Link
      href={`/gym/${gym.slug}`}
      className="block rounded-xl border border-line bg-panel p-4 hover:border-accent/70 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-base leading-tight">
            {rank != null && <span className="text-muted mr-2 font-mono text-sm">#{rank}</span>}
            {gym.name}
          </h3>
          {gym.claimed && <span className="text-accent text-xs">✓ claimed</span>}
          <p className="text-sm text-muted mt-0.5 truncate">{gym.address ?? `${gym.city}, ${gym.state}`}</p>
        </div>
        {gym.google_rating != null && (
          <div className="text-right shrink-0">
            <div className="font-mono text-sm">★ {gym.google_rating.toFixed(1)}</div>
            <div className="text-xs text-muted">{gym.google_reviews} reviews</div>
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-md bg-bg/60 px-2.5 py-1.5">
          <div className="text-xs text-muted">Drop-in</div>
          <div className="font-mono">{money(gym.drop_in_cents)}</div>
        </div>
        <div className="rounded-md bg-bg/60 px-2.5 py-1.5">
          <div className="text-xs text-muted">Monthly</div>
          <div className="font-mono">{money(gym.monthly_cents)}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {gym.styles.map((s) => (
          <Badge key={s} tone="accent">{STYLE_LABEL[s] ?? s}</Badge>
        ))}
        <FighterBadge active={gym.active_fighters} pro={gym.pro_fighters} />
        {gym.tags.slice(0, 3).map((t) => (
          <Badge key={t}>{TAG_LABEL[t] ?? t}</Badge>
        ))}
      </div>
    </Link>
  );
}

export type SortMode = "complete" | "az" | "near";

const LABEL: Record<SortMode, string> = { complete: "Most complete", az: "A to Z", near: "Nearest to me" };

export default function SortControl({ mode, onChange, locating }: { mode: SortMode; onChange: (mode: SortMode) => void; locating: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Sort gyms">
      <span className="text-muted">Sort</span>
      {(Object.keys(LABEL) as SortMode[]).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          aria-pressed={mode === m}
          className={`rounded-full border px-3 py-1 ${mode === m ? "border-accent text-accent" : "border-line text-muted hover:text-ink"}`}
        >
          {m === "near" && locating ? "Locating…" : LABEL[m]}
        </button>
      ))}
    </div>
  );
}

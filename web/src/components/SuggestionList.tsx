import Link from "next/link";

export type Suggestion = { key: string; label: string; detail: string; href: string };

/**
 * The open half of the search combobox, kept presentational so tests can render it with a populated list.
 * When `locate` is true the first option (index 0) is "Use my location" and items start at index 1.
 */
export default function SuggestionList({
  listId,
  items,
  active,
  locate,
  locating,
  onLocate,
  linkRef,
}: {
  listId: string;
  items: Suggestion[];
  active: number;
  locate: boolean;
  locating: boolean;
  onLocate: () => void;
  linkRef: (index: number, el: HTMLAnchorElement | null) => void;
}) {
  const offset = locate ? 1 : 0;
  return (
    <ul
      id={listId}
      role="listbox"
      onMouseDown={(e) => e.preventDefault()}
      className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-md border border-line bg-panel text-sm shadow-lg"
    >
      {locate && (
        <li id={`${listId}-0`} role="option" aria-selected={active === 0}>
          <button type="button" onClick={onLocate} className={`block w-full px-3 py-2 text-left ${active === 0 ? "bg-bg" : ""}`}>
            {locating ? "Locating…" : "Use my location"} <span className="text-muted">nearest listed city</span>
          </button>
        </li>
      )}
      {items.map((item, i) => {
        const at = i + offset;
        return (
          <li key={item.key} id={`${listId}-${at}`} role="option" aria-selected={active === at}>
            <Link href={item.href} ref={(el) => linkRef(i, el)} className={`flex justify-between gap-3 px-3 py-2 ${active === at ? "bg-bg" : ""}`}>
              <span>{item.label}</span>
              <span className="text-muted">{item.detail}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

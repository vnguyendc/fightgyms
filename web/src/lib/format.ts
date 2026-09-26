/** Display helpers that are safe in client bundles: no Supabase client, no sample data, no env-dependent site config. */

export function money(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(cents / 100);
}

export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function fmtTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hh}:${String(m).padStart(2, "0")}${ampm}` : `${hh}${ampm}`;
}

/** Public URL for a photo. Sample data uses site-relative paths under /public. */
export function photoUrl(path: string): string {
  return path.startsWith("/") ? path : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/gym-photos/${path}`;
}

/** "0.8 mi" under ten miles, whole miles from ten up. */
export function miles(distance: number): string {
  return `${distance < 10 ? distance.toFixed(1) : Math.round(distance)} mi`;
}

/** "DC, MD and VA" from any list of state codes. */
export function listStates(states: string[]): string {
  const s = [...new Set(states)].sort();
  return s.length > 1 ? `${s.slice(0, -1).join(", ")} and ${s[s.length - 1]}` : s[0] ?? "";
}

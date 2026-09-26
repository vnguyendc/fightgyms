/** Read-only public directory access. Samples require explicit non-production demo mode. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sample from "@/data/sample.json";
import { byName } from "./geo";
import { pageCount } from "./listing";
import { runtimePolicy } from "./site";
import { LIVE_STYLES, type Event, type GymCard, type GymDetail, type Photo, type Place, type Style } from "./types";

// Display helpers live in ./format so client components never import this module (it bundles supabase-js and sample.json).
export { DOW, fmtTime, money, photoUrl } from "./format";

function sb(): SupabaseClient | null {
  if (runtimePolicy().mode !== "live") return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Do not turn permission, network, or schema failures into a successful empty listing. */
async function checked<T>(query: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> {
  const result = await query;
  if (result.error) throw new Error("Directory data is temporarily unavailable. Please try again later.");
  return result.data;
}

type SampleData = {
  places: Place[];
  gyms: GymCard[];
  gym_details: Record<string, Omit<GymDetail, keyof GymCard> & { website: string | null }>;
  events: (Event & { place_id: string })[];
};
const S = sample as unknown as SampleData;
const demo = () => runtimePolicy().mode === "demo";
const visible = (g: { is_sample: boolean; slug: string }) => demo() || (g.is_sample === false && !g.slug.startsWith("sample-"));
// Only gyms with a public discipline are listed; other rows remain in the database.
const live = (g: { styles: Style[] }) => g.styles.some((s) => LIVE_STYLES.includes(s));

/** Populated cities only. A place record alone is not a directory landing page. */
export async function getPlaces(): Promise<Place[]> {
  const gyms = await getAllGyms();
  const withGyms = [...new Set(gyms.map((g) => g.place_slug).filter((s): s is string => !!s))];
  if (!withGyms.length) return [];
  const c = sb();
  if (!c) return S.places.filter((p) => withGyms.includes(p.slug));
  return await checked(c.from("places").select("*").in("slug", withGyms).order("state").order("city")) ?? [];
}

export async function getPlace(slug: string): Promise<Place | null> {
  const c = sb();
  if (!c) return demo() ? S.places.find((p) => p.slug === slug) ?? null : null;
  return checked(c.from("places").select("*").eq("slug", slug).maybeSingle());
}

export async function getGymsByPlace(placeSlug: string, style?: Style): Promise<GymCard[]> {
  const c = sb();
  let rows: GymCard[];
  if (!c) {
    rows = demo() ? S.gyms.filter((g) => g.place_slug === placeSlug) : [];
  } else {
    let q = c.from("gym_cards").select("*").eq("place_slug", placeSlug).overlaps("styles", LIVE_STYLES).eq("is_sample", false);
    if (style) q = q.contains("styles", [style]);
    rows = await checked(q) ?? [];
  }
  return rows.filter(visible).filter(live).filter((g) => !style || g.styles.includes(style))
    .sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
}

export async function getAllGyms(): Promise<GymCard[]> {
  const c = sb();
  if (!c) return demo() ? S.gyms.filter(live) : [];
  const rows: GymCard[] = await checked(c.from("gym_cards").select("*").overlaps("styles", LIVE_STYLES).eq("is_sample", false)) ?? [];
  return rows.filter(visible).filter(live);
}

/** One public card row by slug, or null. Used by the profile and by the submissions route to resolve a gym id. */
export async function getGymCard(slug: string): Promise<GymCard | null> {
  const c = sb();
  if (!c) {
    if (!demo()) return null;
    const card = S.gyms.find((g) => g.slug === slug);
    return card && live(card) ? card : null;
  }
  const card: GymCard | null = await checked(c.from("gym_cards").select("*").eq("slug", slug).eq("is_sample", false).maybeSingle());
  return card && visible(card) && live(card) ? card : null;
}

export async function getGym(slug: string): Promise<GymDetail | null> {
  const c = sb();
  if (!c) {
    if (!demo()) return null;
    const card = S.gyms.find((g) => g.slug === slug);
    const d = S.gym_details[slug];
    if (!card || !d || !live(card)) return null;
    return { ...card, ...d };
  }
  const card = await getGymCard(slug);
  if (!card) return null;
  const [gym, prices, classes, coaches, fighters, photos] = await Promise.all([
    checked(c.from("gyms").select("description, phone, affiliation, founded_year").eq("id", card.id).single()),
    checked(c.from("gym_current_prices").select("*").eq("gym_id", card.id)),
    checked(c.from("classes").select("*").eq("gym_id", card.id).order("dow").order("start_time")),
    checked(c.from("coaches").select("*").eq("gym_id", card.id)),
    checked(c.from("fighters").select("*").eq("gym_id", card.id).order("last_bout", { ascending: false })),
    checked(c.from("gym_photos").select("storage_path, width, height, alt, credit").eq("gym_id", card.id)
      .eq("is_active", true).order("is_primary", { ascending: false }).order("sort_order")),
  ]);
  return {
    ...card,
    ...(gym ?? { description: null, phone: null, affiliation: null, founded_year: null }),
    prices: prices ?? [], classes: classes ?? [], coaches: coaches ?? [], fighters: fighters ?? [],
    photos: (photos as Photo[] | null) ?? [],
  };
}

export async function getUpcomingEvents(state?: string): Promise<Event[]> {
  const c = sb();
  const today = new Date().toISOString().slice(0, 10);
  if (!c) return demo() ? S.events.filter((e) => e.date && e.date >= today &&
    (!state || S.places.some((p) => p.id === e.place_id && p.state === state))) : [];
  // Events have no is_sample column in the current schema; seed slugs are sample-*.
  let q = c.from("events").select(state ? "*, places!inner(state)" : "*")
    .not("slug", "like", "sample-%").gte("date", today).order("date");
  if (state) q = q.eq("places.state", state);
  const rows = await checked(q) as (Event & { places?: { state: string } })[] | null;
  return (rows ?? []).filter((e) => !e.slug.startsWith("sample-") && e.date && e.date >= today &&
    (!state || e.places?.state === state));
}

/** The full public listing, A–Z by name then slug (never by Google rating), plus the page count for /gyms/all. */
export async function getAllGymsListing(): Promise<{ gyms: GymCard[]; cities: number; pages: number }> {
  const gyms = [...await getAllGyms()].sort(byName);
  const cities = new Set(gyms.map((g) => g.place_slug).filter(Boolean)).size;
  return { gyms, cities, pages: pageCount(gyms.length) };
}

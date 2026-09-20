/**
 * Data access. Reads from Supabase when NEXT_PUBLIC_SUPABASE_URL is set,
 * otherwise from the bundled sample dataset so the app runs with zero config.
 * Sample rows (is_sample) are hidden in production unless SHOW_SAMPLE=1.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sample from "@/data/sample.json";
import type { Event, GymCard, GymDetail, Place, Style } from "./types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const showSample = process.env.SHOW_SAMPLE === "1" || process.env.NODE_ENV !== "production" || !url;

let client: SupabaseClient | null = null;
function sb(): SupabaseClient | null {
  if (!url || !key) return null;
  if (!client) client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

type SampleData = {
  places: Place[];
  gyms: GymCard[];
  gym_details: Record<string, Omit<GymDetail, keyof GymCard> & { website: string | null }>;
  events: (Event & { place_id: string })[];
};
const S = sample as unknown as SampleData;

const visible = (g: { is_sample: boolean }) => showSample || !g.is_sample;

// ---------------------------------------------------------------------------

export async function getPlaces(): Promise<Place[]> {
  const c = sb();
  if (!c) return S.places;
  const { data } = await c.from("places").select("*").order("state").order("city");
  return data ?? [];
}

export async function getPlace(slug: string): Promise<Place | null> {
  const c = sb();
  if (!c) return S.places.find((p) => p.slug === slug) ?? null;
  const { data } = await c.from("places").select("*").eq("slug", slug).maybeSingle();
  return data;
}

export async function getGymsByPlace(placeSlug: string, style?: Style): Promise<GymCard[]> {
  const c = sb();
  let rows: GymCard[];
  if (!c) {
    rows = S.gyms.filter((g) => g.place_slug === placeSlug);
  } else {
    let q = c.from("gym_cards").select("*").eq("place_slug", placeSlug);
    if (!showSample) q = q.eq("is_sample", false);
    if (style) q = q.contains("styles", [style]);
    rows = (await q).data ?? [];
  }
  return rows
    .filter(visible)
    .filter((g) => !style || g.styles.includes(style))
    .sort((a, b) => b.active_fighters - a.active_fighters || (b.google_reviews ?? 0) - (a.google_reviews ?? 0));
}

export async function getAllGyms(): Promise<GymCard[]> {
  const c = sb();
  if (!c) return S.gyms.filter(visible);
  let q = c.from("gym_cards").select("*");
  if (!showSample) q = q.eq("is_sample", false);
  return (await q).data ?? [];
}

export async function getGym(slug: string): Promise<GymDetail | null> {
  const c = sb();
  if (!c) {
    const card = S.gyms.find((g) => g.slug === slug);
    const d = S.gym_details[slug];
    if (!card || !d || !visible(card)) return null;
    return { ...card, ...d };
  }
  const { data: card } = await c.from("gym_cards").select("*").eq("slug", slug).maybeSingle();
  if (!card || !visible(card)) return null;
  const [gym, prices, classes, coaches, fighters] = await Promise.all([
    c.from("gyms").select("description, phone, affiliation, founded_year").eq("id", card.id).single(),
    c.from("gym_current_prices").select("*").eq("gym_id", card.id),
    c.from("classes").select("*").eq("gym_id", card.id).order("dow").order("start_time"),
    c.from("coaches").select("*").eq("gym_id", card.id),
    c.from("fighters").select("*").eq("gym_id", card.id).order("last_bout", { ascending: false }),
  ]);
  return {
    ...card,
    ...(gym.data ?? { description: null, phone: null, affiliation: null, founded_year: null }),
    prices: prices.data ?? [],
    classes: classes.data ?? [],
    coaches: coaches.data ?? [],
    fighters: fighters.data ?? [],
  };
}

export async function getUpcomingEvents(state?: string): Promise<Event[]> {
  const c = sb();
  if (!c) return S.events;
  let q = c.from("events").select("*").gte("date", new Date().toISOString().slice(0, 10)).order("date");
  if (state) q = q.eq("places.state", state);
  return (await q).data ?? [];
}

// ---------------------------------------------------------------------------

export function money(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${Math.round(cents / 100)}`;
}

export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function fmtTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hh}:${String(m).padStart(2, "0")}${ampm}` : `${hh}${ampm}`;
}

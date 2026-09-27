import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SessionUser } from "./auth";
import { str } from "./forms";
import { safeExternalUrl } from "./site";
import { STYLE_LABEL, type Style } from "./types";

export const SUBMISSION_FIELDS = ["trial_price", "drop_in_price", "monthly_price", "website", "other"] as const;
export type SubmissionField = (typeof SUBMISSION_FIELDS)[number];
const PRICE_FIELDS: readonly SubmissionField[] = ["trial_price", "drop_in_price", "monthly_price"];

export const FIELD_LABEL: Record<SubmissionField, string> = {
  trial_price: "Trial or intro price",
  drop_in_price: "Drop-in price",
  monthly_price: "Monthly price",
  website: "Website",
  other: "Something else",
};

export interface SubmissionInput {
  gym: string;
  field: SubmissionField;
  value: string;
  cents: number | null;
  note: string | null;
  email: string | null;
}

export type ParsedSubmission =
  | { ok: true; honeypot: false; input: SubmissionInput }
  | { ok: true; honeypot: true; gym: string | null }
  | { ok: false; error: "gym" | "field" | "value" };

const SLUG = /^[a-z0-9-]{1,120}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;


/** "$25", "25", "25.00", "25.5", "1,000" → cents; anything else, or outside $1–$1,000, → null. */
export function parseCents(value: string): number | null {
  const m = /^\$?\s*(\d{1,4})(?:\.(\d{1,2}))?$/.exec(value.replace(/,/g, "").trim());
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return cents >= 100 && cents <= 100000 ? cents : null;
}

/** Pure validation of a form or JSON body. Non-string values count as empty. */
export function parseSubmission(body: Record<string, unknown>): ParsedSubmission {
  const gym = str(body.gym);
  const slug = SLUG.test(gym) ? gym : null;
  if (str(body.website_url)) return { ok: true, honeypot: true, gym: slug };
  if (!slug) return { ok: false, error: "gym" };
  const field = str(body.field) as SubmissionField;
  if (!SUBMISSION_FIELDS.includes(field)) return { ok: false, error: "field" };
  const value = str(body.value);
  const note = str(body.note);
  const email = str(body.email);
  if (note.length > 1000) return { ok: false, error: "value" };
  if (email && (email.length > 254 || !EMAIL.test(email))) return { ok: false, error: "value" };
  let cents: number | null = null;
  if (PRICE_FIELDS.includes(field)) {
    cents = parseCents(value);
    if (cents == null) return { ok: false, error: "value" };
  } else if (field === "website") {
    if (value.length > 500 || !safeExternalUrl(value)) return { ok: false, error: "value" };
  } else if (value.length < 1 || value.length > 200) {
    return { ok: false, error: "value" };
  }
  return { ok: true, honeypot: false, input: { gym: slug, field, value, cents, note: note || null, email: email || null } };
}

/**
 * One pending row. Anonymous: the anon key, body unchanged (rls allows insert only). Signed in: the user's own
 * client, so 0004's `submitted_by = auth.uid()` check passes; the session email fills contact_email when the form
 * left it empty (the database stamps the verified email regardless).
 */
export async function insertSubmission(entityId: string, input: SubmissionInput, session?: { client: SupabaseClient; user: SessionUser }): Promise<void> {
  const client = session?.client ?? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.from("submissions").insert({
    entity_type: "gym",
    entity_id: entityId,
    field: input.field,
    proposed_value: { value: input.value, cents: input.cents },
    note: input.note,
    contact_email: input.email ?? session?.user.email ?? null,
    ...(session ? { submitted_by: session.user.id } : {}),
    status: "pending",
  });
  if (error) throw new Error("Submission could not be saved.");
}

export const NEW_GYM_ROLES = ["owner", "manager", "coach", "member", "other"] as const;
export type NewGymRole = (typeof NEW_GYM_ROLES)[number];
export const NEW_GYM_ROLE_LABEL: Record<NewGymRole, string> = { owner: "I own it", manager: "I manage it", coach: "I coach there", member: "I train there", other: "Other" };

export interface NewGymInput {
  name: string; address: string; city: string; state: string;
  website: string | null; instagram: string | null; styles: Style[]; role: NewGymRole; note: string | null;
}
export type ParsedNewGym = { ok: true; honeypot: true } | { ok: true; honeypot: false; input: NewGymInput } | { ok: false; field: string };

// same shape the public_candidates importer requires: street number, then at least two words; no PO boxes
const ADDRESS = /^\d+[A-Za-z-]*\s+\S+\s+\S+/;
const HANDLE = /^[a-z0-9._]{1,30}$/;
const STYLES = new Set<string>(Object.keys(STYLE_LABEL));

/** Pure validation for the submit-a-gym form. Unknown styles are rejected, not guessed; duplicates are dropped. */
export function parseNewGym(body: Record<string, unknown>): ParsedNewGym {
  if (str(body.website_url)) return { ok: true, honeypot: true };
  const name = str(body.name), address = str(body.address), city = str(body.city), state = str(body.state).toUpperCase();
  const website = str(body.website), instagram = str(body.instagram).replace(/^@/, "").toLowerCase(), note = str(body.note);
  const role = str(body.role) as NewGymRole;
  const raw = Array.isArray(body.styles) ? body.styles.map(str) : str(body.styles) ? [str(body.styles)] : [];
  const styles = [...new Set(raw)] as Style[];
  if (name.length < 1 || name.length > 160) return { ok: false, field: "name" };
  if (address.length > 240 || !ADDRESS.test(address)) return { ok: false, field: "address" };
  if (city.length < 1 || city.length > 80) return { ok: false, field: "city" };
  if (!/^[A-Z]{2}$/.test(state)) return { ok: false, field: "state" };
  const site = website ? safeExternalUrl(website) : undefined;
  if (website && (website.length > 500 || !site)) return { ok: false, field: "website" };
  if (instagram && !HANDLE.test(instagram)) return { ok: false, field: "instagram" };
  if (styles.length < 1 || styles.length > 3 || styles.some((s) => !STYLES.has(s))) return { ok: false, field: "styles" };
  if (!NEW_GYM_ROLES.includes(role)) return { ok: false, field: "role" };
  if (note.length > 1000) return { ok: false, field: "note" };
  return { ok: true, honeypot: false, input: { name, address, city, state, website: site ?? null, instagram: instagram || null, styles, role, note: note || null } };
}

/** One pending new_gym row as the signed-in user: rls requires submitted_by = auth.uid() and a null entity. */
export async function insertNewGym(client: SupabaseClient, user: SessionUser, input: NewGymInput): Promise<void> {
  const { note, ...proposed } = input;
  const { error } = await client.from("submissions").insert({
    entity_type: "gym", entity_id: null, field: "new_gym", proposed_value: proposed, note,
    submitted_by: user.id, contact_email: user.email, status: "pending",
  });
  if (error) throw new Error("Submission could not be saved.");
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionUser } from "./auth";
import { str } from "./forms";
import { safeExternalUrl } from "./site";
import { STYLE_LABEL, type Style } from "./types";

/** Labels retained for historical submissions in the signed-in account view. */
export const FIELD_LABEL: Record<string, string> = {
  trial_price: "Trial or intro price", drop_in_price: "Drop-in price", monthly_price: "Monthly price",
  website: "Website", other: "Something else",
};

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

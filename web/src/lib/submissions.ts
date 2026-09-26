import { createClient } from "@supabase/supabase-js";
import { safeExternalUrl } from "./site";

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

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** "$25", "25", "25.00", "25.5" → cents; anything else, or outside $1–$1,000, → null. */
export function parseCents(value: string): number | null {
  const m = /^\$?\s*(\d{1,4})(?:\.(\d{1,2}))?$/.exec(value.trim());
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

/** One pending row through the public anon key (RLS allows insert only). Nothing is published or updated. */
export async function insertSubmission(entityId: string, input: SubmissionInput): Promise<void> {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.from("submissions").insert({
    entity_type: "gym",
    entity_id: entityId,
    field: input.field,
    proposed_value: { value: input.value, cents: input.cents },
    note: input.note,
    contact_email: input.email,
    status: "pending",
  });
  if (error) throw new Error("Submission could not be saved.");
}

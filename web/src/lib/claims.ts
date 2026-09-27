import type { SupabaseClient } from "@supabase/supabase-js";
import { SLUG } from "./auth";
import { str } from "./forms";

export const CLAIM_ROLES = ["owner", "manager", "coach", "other"] as const;
export type ClaimRole = (typeof CLAIM_ROLES)[number];
export const ROLE_LABEL: Record<ClaimRole, string> = { owner: "Owner", manager: "Manager", coach: "Coach", other: "Other staff" };

export interface ClaimInput { gym: string; role: ClaimRole; note: string | null }
export type ParsedClaim =
  | { ok: true; honeypot: boolean; input: ClaimInput }
  | { ok: false; error: "gym" | "claim"; gym: string | null };

/** Pure validation. The honeypot case parses as valid so bots see the normal thank-you and nothing is written. */
export function parseClaim(body: Record<string, unknown>): ParsedClaim {
  const gym = str(body.gym);
  if (!SLUG.test(gym)) return { ok: false, error: "gym", gym: null };
  if (str(body.website_url)) return { ok: true, honeypot: true, input: { gym, role: "other", note: null } };
  const role = str(body.role) as ClaimRole;
  const note = str(body.note);
  if (!CLAIM_ROLES.includes(role) || note.length > 1000) return { ok: false, error: "claim", gym };
  return { ok: true, honeypot: false, input: { gym, role, note: note || null } };
}

/** Inserted as the signed-in user: rls requires user_id = auth.uid(), status pending, a live non-sample gym. */
export async function insertClaim(client: SupabaseClient, entityId: string, userId: string, input: ClaimInput): Promise<"ok" | "duplicate"> {
  const { error } = await client.from("claims").insert({ entity_type: "gym", entity_id: entityId, user_id: userId, role: input.role, note: input.note, status: "pending", plan: "free" });
  if (!error) return "ok";
  if (error.code === "23505") return "duplicate";
  throw new Error("Claim could not be saved.");
}

export interface ClaimRow { id: string; entity_id: string; status: string; role: string | null; created_at: string }
export interface SubmissionRow { id: string; entity_id: string | null; field: string; proposed_value: Record<string, unknown> | null; status: string; created_at: string }

/** Own rows only: rls filters by auth.uid(), so an empty list is the honest answer for a stranger. */
export async function listOwnClaims(client: SupabaseClient): Promise<ClaimRow[]> {
  const { data, error } = await client.from("claims").select("id, entity_id, status, role, created_at").order("created_at", { ascending: false });
  if (error) throw new Error("Your claims are temporarily unavailable. Please try again later.");
  return (data ?? []) as ClaimRow[];
}

export async function listOwnSubmissions(client: SupabaseClient): Promise<SubmissionRow[]> {
  const { data, error } = await client.from("submissions").select("id, entity_id, field, proposed_value, status, created_at").order("created_at", { ascending: false });
  if (error) throw new Error("Your submissions are temporarily unavailable. Please try again later.");
  return (data ?? []) as SubmissionRow[];
}

import ClaimView, { type ClaimState } from "@/components/ClaimView";
import { SLUG, currentUser } from "@/lib/auth";
import { listOwnClaims, listOwnSubmissions } from "@/lib/claims";
import { getGym, getGymCard, getGymCardsByIds } from "@/lib/data";
import { pageMetadata, runtimePolicy } from "@/lib/site";

export const metadata = pageMetadata("/claim", "Claim or submit a gym",
  "Claim your gym listing or submit a gym that is not listed yet. Claims and new gyms are reviewed by hand. Verified claimants can publish listing edits immediately.", false);

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const SIGNED_OUT_NOTICES = new Set(["signin", "auth", "link", "email"]);

/** Everything /claim can show, resolved from the query and the session. Exported for tests; the page is the wrapper. */
export async function resolveClaimState(sp: Params): Promise<ClaimState> {
  const gymSlug = SLUG.test(one(sp.gym)) ? one(sp.gym) : null;
  if (runtimePolicy().mode !== "live") return { kind: "unavailable", gym: gymSlug };
  if (one(sp.sent) === "1") return { kind: "sent", gym: gymSlug };
  if (one(sp.claimed) === "1") return { kind: "claimed", gym: gymSlug };
  if (one(sp.submitted) === "gym") return { kind: "submitted-gym" };
  const error = one(sp.error);
  if (error && !SIGNED_OUT_NOTICES.has(error)) return { kind: "error", code: error, field: one(sp.field) || null, gym: gymSlug };
  const [session, gym] = await Promise.all([currentUser(), gymSlug ? getGymCard(gymSlug) : Promise.resolve(null)]);
  if (!session) return { kind: "signed-out", gym, gymSlug, notice: error || null };
  const [claims, submissions] = await Promise.all([listOwnClaims(session.client), listOwnSubmissions(session.client)]);
  const ids = [...new Set([...claims.map((c) => c.entity_id), ...submissions.map((s) => s.entity_id)].filter((id): id is string => !!id))];
  const gyms = await getGymCardsByIds(ids);
  const editableGym = gym && claims.some(c => c.entity_id === gym.id && c.status === "verified") ? await getGym(gym.slug) : null;
  return { kind: "signed-in", user: session.user, gym, gymSlug, claims, submissions, gyms, editableGym, saved: one(sp.saved) === "1", refreshDelayed: one(sp.refresh) === "delayed" };
}

export default async function Claim({ searchParams }: PageProps<"/claim">) {
  return <ClaimView state={await resolveClaimState(await searchParams)} />;
}

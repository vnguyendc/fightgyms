import { revalidatePath } from "next/cache";
import { recordEvent } from "@/lib/analytics";
import { redirectWith, requestClient, userOf } from "@/lib/auth";
import { readBody } from "@/lib/forms";
import { parseOwnerEdit } from "@/lib/owner-edits";
import { runtimePolicy } from "@/lib/site";

/** The user's token reaches a database RPC that locks and rechecks their exact verified claim. */
export async function POST(request: Request) {
  if (runtimePolicy().mode !== "live") return Response.json({ error: "Owner editing is unavailable in this environment." }, { status: 503 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Cross-site request refused." }, { status: 403 });
  const type = request.headers.get("content-type")?.split(";", 1)[0].trim();
  if (type !== "application/json" && type !== "application/x-www-form-urlencoded") return Response.json({ error: "Use a form or JSON body." }, { status: 415 });
  const body = await readBody(request);
  if (body === null) return Response.json({ error: "Edit too large." }, { status: 413 });
  const bound = requestClient(request)!;
  const failure = (error: string, status: number) => {
    const headers = redirectWith(request.url, bound.pending).headers;
    headers.delete("location");
    return Response.json({ error }, { status, headers });
  };
  const user = await userOf(bound.client);
  if (!user) return failure("Sign in again before editing.", 401);
  const parsed = parseOwnerEdit(body);
  if (!parsed.ok) return failure("Check the fields and price actions. No changes were saved.", 400);
  const { error } = await bound.client.rpc("edit_owned_gym", { p_slug: parsed.gym, p_changes: parsed.changes });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "22023" ? 400 : 500;
    return failure(status === 403 ? "A verified claim for this gym is required. It may have been revoked." : status === 400 ? "Check the fields and try again. No changes were saved." : "We could not confirm the edit. Reload your listing before trying again.", status);
  }
  // Names/prices also appear on the home page, nearby lists, city pages, search and metadata.
  let refreshDelayed = false;
  try {
    revalidatePath("/", "layout");
    revalidatePath("/api/search-index");
  } catch {
    // The transaction already committed. Do not misreport it as an unsaved edit.
    refreshDelayed = true;
    await recordEvent("owner_edit_cache_failed", {}, request);
  }
  await recordEvent("owner_edit_published", { price_fields: Object.keys(parsed.changes.prices).length }, request);
  return redirectWith(new URL(`/claim?gym=${parsed.gym}&saved=1${refreshDelayed ? "&refresh=delayed" : ""}`, request.url), bound.pending);
}

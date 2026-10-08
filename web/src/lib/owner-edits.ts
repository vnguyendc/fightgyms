import { SLUG } from "./auth";

export const OWNER_PRICE_KINDS = ["trial", "drop_in", "monthly"] as const;
export type OwnerPriceKind = (typeof OWNER_PRICE_KINDS)[number];
export interface OwnerChanges {
  name: string;
  address: string | null;
  website: string | null;
  phone: string | null;
  description: string | null;
  prices: Partial<Record<OwnerPriceKind, number | null>>;
}
export type ParsedOwnerEdit = { ok: true; gym: string; changes: OwnerChanges } | { ok: false };
const fields = ["gym", "name", "address", "website", "phone", "description", ...OWNER_PRICE_KINDS.flatMap(k => [`${k}_action`, `${k}_price`])];
const WEBSITE = /^https:\/\/([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,63}([/?#][^\s\\]*)?$/;
const control = (s: string) => [...s].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

/** Exact form schema. Protected properties, duplicate form values and non-strings are refused. */
export function parseOwnerEdit(body: Record<string, unknown>): ParsedOwnerEdit {
  if (Object.keys(body).length !== fields.length || fields.some(k => typeof body[k] !== "string")) return { ok: false };
  const values = Object.fromEntries(fields.map(k => [k, (body[k] as string).trim()]));
  const { gym, name, address, website, phone, description } = values;
  if (!SLUG.test(gym) || !name || name.length > 160 || address.length > 240 || website.length > 500 || phone.length > 40 || description.length > 2000) return { ok: false };
  if ([name, address, website, phone].some(control) || control(description.replace(/[\t\n\r]/g, ""))) return { ok: false };
  if (website && !WEBSITE.test(website)) return { ok: false };
  if (phone && (!/^[+0-9(). #x-]+$/.test(phone) || !/[0-9]/.test(phone))) return { ok: false };
  const prices: OwnerChanges["prices"] = {};
  for (const kind of OWNER_PRICE_KINDS) {
    const action = values[`${kind}_action`], price = values[`${kind}_price`];
    if (action === "keep" || action === "clear") {
      if (price) return { ok: false };
      if (action === "clear") prices[kind] = null;
    } else if (action === "set") {
      const match = /^(\d{1,4})(?:\.(\d{1,2}))?$/.exec(price);
      if (!match) return { ok: false };
      const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
      if (cents > 100000 || cents < (kind === "trial" ? 0 : 1)) return { ok: false };
      prices[kind] = cents;
    } else return { ok: false };
  }
  return { ok: true, gym, changes: { name, address: address || null, website: website || null, phone: phone || null, description: description || null, prices } };
}

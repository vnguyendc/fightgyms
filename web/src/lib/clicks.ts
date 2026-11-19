import { str } from "./forms";

/** Values stored for a gym's monthly click count. No page URL, so query strings never land in the table. */
export const CLICK_LINKS = ["website", "phone", "instagram", "facebook", "tiktok", "youtube", "x"] as const;
export type ClickLink = (typeof CLICK_LINKS)[number];

const SLUG = /^[a-z0-9-]{1,120}$/;

export function parseClick(body: Record<string, unknown>): { slug: string; link: ClickLink } | null {
  const slug = str(body.slug);
  const link = str(body.type);
  if (!SLUG.test(slug) || !CLICK_LINKS.includes(link as ClickLink)) return null;
  return { slug, link: link as ClickLink };
}

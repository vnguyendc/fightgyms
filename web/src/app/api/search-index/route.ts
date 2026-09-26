import { loadSearchIndex } from "@/lib/search-index";

// Static with hourly revalidation, like the directory pages (route.md: "Revalidating Cached Data").
export const revalidate = 3600;

export async function GET() {
  return Response.json(await loadSearchIndex());
}

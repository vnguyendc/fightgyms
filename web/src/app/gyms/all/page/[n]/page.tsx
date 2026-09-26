import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AllGymsPage from "@/components/AllGymsPage";
import { getAllGymsListing } from "@/lib/data";
import { allGymsDescription, allGymsPath, allGymsTitle, pageSlice } from "@/lib/listing";
import { pageMetadata } from "@/lib/site";

export const revalidate = 3600;
export const dynamicParams = true;

/** Page 1 lives at /gyms/all; only canonical integers 2..pages resolve here. */
async function resolve(n: string) {
  const page = /^[1-9]\d*$/.test(n) ? Number(n) : NaN;
  const listing = await getAllGymsListing();
  if (!(page >= 2 && page <= listing.pages)) notFound();
  return { page, ...listing };
}

export async function generateStaticParams() {
  const { pages } = await getAllGymsListing();
  return Array.from({ length: Math.max(0, pages - 1) }, (_, i) => ({ n: String(i + 2) }));
}

export async function generateMetadata({ params }: PageProps<"/gyms/all/page/[n]">): Promise<Metadata> {
  const { n } = await params;
  const { page, pages } = await resolve(n);
  return pageMetadata(allGymsPath(page), allGymsTitle(page), allGymsDescription(page, pages));
}

export default async function Page({ params }: PageProps<"/gyms/all/page/[n]">) {
  const { n } = await params;
  const { page, pages, gyms, cities } = await resolve(n);
  return <AllGymsPage gyms={pageSlice(gyms, page)} total={gyms.length} cities={cities} page={page} pages={pages} />;
}

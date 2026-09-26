import AllGymsPage from "@/components/AllGymsPage";
import { getAllGymsListing } from "@/lib/data";
import { allGymsDescription, allGymsTitle, pageSlice } from "@/lib/listing";
import { pageMetadata } from "@/lib/site";

export const revalidate = 3600;

export async function generateMetadata() {
  const { gyms, pages } = await getAllGymsListing();
  return pageMetadata("/gyms/all", allGymsTitle(1), allGymsDescription(1, pages), gyms.length > 0);
}

export default async function AllGyms() {
  const { gyms, cities, pages } = await getAllGymsListing();
  return <AllGymsPage gyms={pageSlice(gyms, 1)} total={gyms.length} cities={cities} page={1} pages={pages} />;
}

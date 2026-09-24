import Link from "next/link";
import { pageMetadata } from "@/lib/site";

export const metadata = pageMetadata("/claim", "Gym claims — coming soon", "Gym claims and submissions are not available yet.", false);

export default async function Claim({ searchParams }: PageProps<"/claim">) {
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{sp.fix === "1" ? "Listing corrections" : "Gym claims"}</h1>
      <p className="text-muted mt-2">Gym claims and submissions are not available yet. No information is collected on this page.</p>
      <Link href="/gyms" className="mt-6 inline-block underline">Browse the gym directory →</Link>
    </div>
  );
}

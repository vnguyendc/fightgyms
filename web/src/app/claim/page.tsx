import Link from "next/link";
import { pageMetadata } from "@/lib/site";

export const metadata = pageMetadata("/claim", "Gym claims — coming soon", "Gym claims are not available yet. Listing corrections are reviewed before anything is published.", false);

const ERRORS: Record<string, string> = {
  notfound: "That gym is not listed, so the correction could not be filed.",
  field: "Pick what you are reporting and try again.",
  value: "Check the value: prices are dollar amounts between $1 and $1,000, websites need a full https address, and notes are limited to 1,000 characters.",
};
const SLUG = /^[a-z0-9-]{1,120}$/;

export default async function Claim({ searchParams }: PageProps<"/claim">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const gym = SLUG.test(one(sp.gym)) ? one(sp.gym) : null;
  const back = gym ? `/gym/${gym}` : "/gyms";
  const backLabel = gym ? "Back to the gym" : "Browse the gym directory";
  const submitted = one(sp.submitted) === "1";
  const error = one(sp.error);

  if (submitted) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">Thanks for the correction</h1>
        <p className="text-muted mt-2">We review every submission before anything is published. The listing does not change until it has been checked.</p>
        <Link href={back} className="mt-6 inline-block underline">{backLabel} →</Link>
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">That correction did not go through</h1>
        <p className="text-muted mt-2">{ERRORS[error] ?? "Something went wrong saving it. Please try again in a moment."}</p>
        <Link href={back} className="mt-6 inline-block underline">{backLabel} →</Link>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{one(sp.fix) === "1" ? "Listing corrections" : "Gym claims"}</h1>
      <p className="text-muted mt-2">Gym claims are not available yet. To correct a listing, use the correction box on the gym&apos;s page. No information is collected on this page.</p>
      <Link href={back} className="mt-6 inline-block underline">{backLabel} →</Link>
    </div>
  );
}

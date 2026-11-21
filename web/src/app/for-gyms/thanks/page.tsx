import Link from "next/link";
import { SITE, pageMetadata } from "@/lib/site";

export async function generateMetadata() {
  return pageMetadata("/for-gyms/thanks", `Thanks · ${SITE.name}`, "Your featured listing payment went through.", true, false);
}

export default function Thanks() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Thanks, you’re featured</h1>
      <p className="mt-4 text-muted">
        Stripe confirmed the payment. The Featured badge and the top spot on your city pages turn on within a few minutes. Stripe emails your receipt, and you can cancel from the link in that email.
      </p>
      <p className="mt-6"><Link href="/gyms" className="underline">Back to the directory</Link></p>
    </div>
  );
}

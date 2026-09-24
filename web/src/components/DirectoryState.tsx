import { runtimePolicy } from "@/lib/site";

export default function DirectoryState({ subject = "gyms" }: { subject?: string }) {
  const unavailable = runtimePolicy().mode === "unavailable";
  return <section className="my-8 rounded-xl border border-line bg-panel p-5" role="status">
    <h2 className="font-semibold">{unavailable ? "Directory temporarily unavailable" : `No ${subject} listed yet`}</h2>
    <p className="mt-2 text-sm text-muted">{unavailable
      ? "Live listings are not connected. Please check back later; no sample listings are shown here."
      : "There are no published listings to show here yet. Please check back as the directory grows."}</p>
  </section>;
}

import type { Metadata } from "next";

export const metadata: Metadata = { title: "Claim or fix a gym", robots: { index: false } };

// TODO: wire to supabase `submissions` (insert) + magic-link auth for `claims`.
export default async function Claim({ searchParams }: PageProps<"/claim">) {
  const sp = await searchParams;
  const gym = typeof sp.gym === "string" ? sp.gym : "";
  const fix = sp.fix === "1";
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{fix ? "Suggest a fix" : "Claim your gym"}</h1>
      <p className="text-muted mt-2">
        {fix
          ? "Tell us what's wrong and we'll verify it before it goes live."
          : "Free. You'll be able to edit prices, schedule, coaches and your fight team, and get a verified badge."}
      </p>
      <form className="mt-8 space-y-4" action="/api/submissions" method="post">
        <input type="hidden" name="gym" value={gym} />
        <input type="hidden" name="kind" value={fix ? "fix" : "claim"} />
        <label className="block text-sm">
          <span className="text-muted">Gym</span>
          <input name="gym_name" defaultValue={gym} className="mt-1 w-full rounded-md border border-line bg-panel px-3 py-2" placeholder="Gym name or URL" />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Your email</span>
          <input name="email" type="email" required className="mt-1 w-full rounded-md border border-line bg-panel px-3 py-2" />
        </label>
        <label className="block text-sm">
          <span className="text-muted">{fix ? "What's wrong?" : "Your role at the gym"}</span>
          <textarea name="note" rows={4} className="mt-1 w-full rounded-md border border-line bg-panel px-3 py-2" />
        </label>
        <button className="rounded-md bg-accent px-4 py-2 font-medium text-white">Send</button>
        <p className="text-xs text-muted">Form is a placeholder until the submissions API is wired up.</p>
      </form>
    </div>
  );
}

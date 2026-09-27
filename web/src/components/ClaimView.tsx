import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { CLAIM_ROLES, ROLE_LABEL, type ClaimRow, type SubmissionRow } from "@/lib/claims";
import { FIELD_LABEL, NEW_GYM_ROLES, NEW_GYM_ROLE_LABEL, type SubmissionField } from "@/lib/submissions";
import { STYLE_LABEL, type GymCard, type Style } from "@/lib/types";

export type ClaimState =
  | { kind: "unavailable"; gym: string | null }
  | { kind: "sent"; gym: string | null }
  | { kind: "claimed"; gym: string | null }
  | { kind: "submitted-gym" }
  | { kind: "submitted"; gym: string | null }
  | { kind: "error"; code: string; field: string | null; gym: string | null }
  | { kind: "signed-out"; gym: GymCard | null; gymSlug: string | null; notice: string | null }
  | { kind: "signed-in"; user: SessionUser; gym: GymCard | null; gymSlug: string | null; claims: ClaimRow[]; submissions: SubmissionRow[]; gyms: GymCard[] };

const NOTICE: Record<string, string> = {
  signin: "Sign in first to claim this gym. Enter your email and we will send a link.",
  auth: "That sign-in link is invalid or has expired. Request a new one.",
  link: "We could not send a sign-in link just now. Wait a minute and try again.",
  email: "Enter a valid email address.",
};
const ERRORS: Record<string, string> = {
  notfound: "That gym is not listed, so nothing could be filed.",
  field: "Pick what you are reporting and try again.",
  value: "Check the value: prices are dollar amounts between $1 and $1,000, websites need a full https address, and notes are limited to 1,000 characters.",
  claim: "The claim could not be saved. Please try again.",
};
const FIELD_ERRORS: Record<string, string> = {
  name: "Enter the gym's name, up to 160 characters.",
  address: "Enter a street address that starts with the building number.",
  city: "Enter the city.",
  state: "Enter the two-letter state code.",
  website: "The website needs to be a full https:// address.",
  instagram: "Instagram handles use letters, numbers, dots and underscores only.",
  styles: "Pick one to three disciplines.",
  role: "Tell us your role at the gym.",
  note: "Notes are limited to 1,000 characters.",
};
const STATUS: Record<string, string> = { pending: "under review", verified: "verified", rejected: "not approved", approved: "approved" };
const field = "mt-1 block w-full rounded-md border border-line bg-bg px-3 py-2 text-sm focus:border-accent focus:outline-none";
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function Panel({ title, children, gym }: { title: string; children: React.ReactNode; gym: string | null }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted mt-2">{children}</p>
      <Link href={gym ? `/gym/${gym}` : "/gyms"} className="mt-6 inline-block underline">{gym ? "Back to the gym" : "Browse the gym directory"} →</Link>
    </div>
  );
}

function Honeypot() {
  return (
    <div className="hidden" aria-hidden="true">
      <label>Leave this field empty<input type="text" name="website_url" tabIndex={-1} autoComplete="off" /></label>
    </div>
  );
}

function SignedOut({ gym, gymSlug, notice }: Extract<ClaimState, { kind: "signed-out" }>) {
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{gym ? `Claim ${gym.name}` : "Gym updates"}</h1>
      {notice && <p className="mt-3 rounded-md border border-accent/60 px-3 py-2 text-sm text-accent">{NOTICE[notice]}</p>}
      <p className="text-muted mt-3">Claiming is free. Once we verify you, the listing shows a &quot;✓ claimed&quot; badge and your corrections are marked as confirmed by the gym.</p>
      <form action="/api/auth/link" method="post" className="mt-6 space-y-3">
        {gymSlug && <input type="hidden" name="gym" value={gymSlug} />}
        <Honeypot />
        <label className="block text-sm">
          Your email
          <input name="email" type="email" required maxLength={254} autoComplete="email" className={field} />
        </label>
        <button type="submit" className="rounded-md bg-accent px-4 py-2 font-medium text-white">Email me a sign-in link</button>
        <p className="text-xs text-muted">No password. The link works for an hour; one link per minute.</p>
      </form>
      <p className="mt-8 text-sm text-muted">Gym not listed? Sign in with your email above, then submit it.</p>
    </div>
  );
}

function SignedIn({ user, gym, claims, submissions, gyms }: Extract<ClaimState, { kind: "signed-in" }>) {
  const card = (id: string | null) => gyms.find((g) => g.id === id);
  const name = (id: string | null) => card(id)?.name ?? "Unlisted gym";
  const mine = gym ? claims.find((c) => c.entity_id === gym.id) : undefined;
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Gym updates</h1>
        <form action="/api/auth/signout" method="post" className="text-sm text-muted">
          Signed in as {user.email ?? "you"} · <button type="submit" className="underline hover:text-ink">Sign out</button>
        </form>
      </div>

      {gym && mine && (
        <div className="mt-6 rounded-xl border border-line p-4 text-sm">
          You already claimed {gym.name}: <span className="text-accent">{STATUS[mine.status] ?? mine.status}</span>.
        </div>
      )}
      {gym && !mine && (
        <form action="/api/claims" method="post" className="mt-6 rounded-xl border border-line p-4 text-sm space-y-3">
          <div className="font-medium">Claim {gym.name}</div>
          <p className="text-muted">{gym.address ?? [gym.city, gym.state].filter(Boolean).join(", ")}</p>
          <input type="hidden" name="gym" value={gym.slug} />
          <Honeypot />
          <label className="block">
            Your role at the gym
            <select name="role" required className={field}>
              {CLAIM_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </label>
          <label className="block">
            Anything we should know <span className="text-muted">(optional)</span>
            <textarea name="note" maxLength={1000} rows={2} className={field} />
          </label>
          <button type="submit" className="rounded-md bg-accent px-4 py-2 font-medium text-white">Claim this gym</button>
        </form>
      )}

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Your claims</h2>
        {claims.length === 0 ? <p className="mt-2 text-sm text-muted">No claims yet. Open a gym page and choose &quot;Claim this gym&quot;.</p> : (
          <ul className="mt-2 space-y-1.5 text-sm">
            {claims.map((c) => {
              const g = card(c.entity_id);
              return (
                <li key={c.id} className="flex justify-between gap-3">
                  <span>{g ? <Link href={`/gym/${g.slug}`} className="underline">{g.name}</Link> : name(c.entity_id)}</span>
                  <span className="text-muted whitespace-nowrap">{STATUS[c.status] ?? c.status} · {when(c.created_at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Your submissions</h2>
        {submissions.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing submitted yet.</p> : (
          <ul className="mt-2 space-y-1.5 text-sm">
            {submissions.map((s) => (
              <li key={s.id} className="flex justify-between gap-3">
                <span>{s.field === "new_gym" ? `New gym: ${String(s.proposed_value?.name ?? "")}` : `${FIELD_LABEL[s.field as SubmissionField] ?? s.field} · ${name(s.entity_id)}`}</span>
                <span className="text-muted whitespace-nowrap">{STATUS[s.status] ?? s.status} · {when(s.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="submit" className="mt-10">
        <h2 className="text-xl font-semibold">Submit a gym that isn&apos;t listed</h2>
        <p className="mt-1 text-sm text-muted">Muay Thai, kickboxing and related gyms in the US. Every submission is reviewed before it is listed.</p>
        <form action="/api/submissions/gym" method="post" className="mt-4 space-y-3 text-sm">
          <Honeypot />
          <label className="block">Gym name<input name="name" required maxLength={160} className={field} /></label>
          <label className="block">Street address<input name="address" required maxLength={240} placeholder="1800 Sunrise Valley Dr" className={field} /></label>
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <label className="block">City<input name="city" required maxLength={80} className={field} /></label>
            <label className="block">State<input name="state" required maxLength={2} placeholder="VA" className={field} /></label>
          </div>
          <label className="block">Website <span className="text-muted">(optional)</span><input name="website" type="url" maxLength={500} placeholder="https://" className={field} /></label>
          <label className="block">Instagram <span className="text-muted">(optional)</span><input name="instagram" maxLength={31} placeholder="@handle" className={field} /></label>
          <fieldset>
            <legend>Disciplines <span className="text-muted">(one to three; only Muay Thai and kickboxing pages are live today)</span></legend>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              {(Object.keys(STYLE_LABEL) as Style[]).map((s) => (
                <label key={s} className="flex items-center gap-2"><input type="checkbox" name="styles" value={s} /> {STYLE_LABEL[s]}</label>
              ))}
            </div>
          </fieldset>
          <label className="block">
            Your role
            <select name="role" required className={field}>
              {NEW_GYM_ROLES.map((r) => <option key={r} value={r}>{NEW_GYM_ROLE_LABEL[r]}</option>)}
            </select>
          </label>
          <label className="block">Note <span className="text-muted">(optional)</span><textarea name="note" maxLength={1000} rows={2} className={field} /></label>
          <button type="submit" className="rounded-md border border-accent px-4 py-2 text-accent hover:bg-accent hover:text-bg">Submit gym</button>
        </form>
      </section>

      <p className="mt-10 text-xs text-muted">Every claim and submission is checked by hand before anything changes on the site.</p>
    </div>
  );
}

export default function ClaimView({ state }: { state: ClaimState }) {
  switch (state.kind) {
    case "unavailable":
      return <Panel title="Gym claims" gym={state.gym}>Gym claims are not available yet. To correct a listing, use the correction box on the gym&apos;s page. No information is collected on this page.</Panel>;
    case "sent":
      return <Panel title="Check your email" gym={state.gym}>We sent a sign-in link. It expires in an hour, and you can request one per minute. Opening it on your phone works too.</Panel>;
    case "claimed":
      return <Panel title="Claim received" gym={state.gym}>We check every claim by hand. Once verified, the listing shows the &quot;✓ claimed&quot; badge and your corrections are marked as confirmed by the gym.</Panel>;
    case "submitted-gym":
      return <Panel title="Gym received" gym={null}>Thanks. We review every submission before a gym is listed, and we may email you with a question.</Panel>;
    case "submitted":
      return <Panel title="Thanks for the correction" gym={state.gym}>We review every submission before anything is published. The listing does not change until it has been checked.</Panel>;
    case "error":
      if (state.code === "gym") {
        return (
          <div className="mx-auto max-w-xl px-4 py-10">
            <h1 className="text-3xl font-semibold tracking-tight">That did not go through</h1>
            <p className="text-muted mt-2">{FIELD_ERRORS[state.field ?? ""] ?? "Check the form and try again."}</p>
            <Link href="/claim#submit" className="mt-6 inline-block underline">Back to the form →</Link>
          </div>
        );
      }
      return <Panel title="That did not go through" gym={state.gym}>{ERRORS[state.code] ?? "Something went wrong saving it. Please try again in a moment."}</Panel>;
    case "signed-out":
      return <SignedOut {...state} />;
    case "signed-in":
      return <SignedIn {...state} />;
  }
}

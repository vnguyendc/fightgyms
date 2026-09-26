import { FIELD_LABEL, SUBMISSION_FIELDS } from "@/lib/submissions";

const field = "mt-1 block w-full rounded-md border border-line bg-bg px-3 py-2 text-sm focus:border-accent focus:outline-none";

/** Plain HTML form: works without JavaScript, posts to /api/submissions, lands on /claim with a state. */
export default function CorrectionForm({ slug }: { slug: string }) {
  return (
    <form id="correct" action="/api/submissions" method="post" className="rounded-xl border border-line p-4 text-sm">
      <div className="font-medium">Correct this listing</div>
      <p className="text-muted mt-1">Know a price we are missing, or see something wrong? Every submission is reviewed before it is published.</p>
      <input type="hidden" name="gym" value={slug} />
      <div className="hidden" aria-hidden="true">
        <label>Leave this field empty<input type="text" name="website_url" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <label className="mt-3 block">
        What are you reporting?
        <select name="field" required className={field}>
          {SUBMISSION_FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
        </select>
      </label>
      <label className="mt-3 block">
        Value
        <input name="value" required maxLength={500} placeholder="$25, or a full https:// address" className={field} />
      </label>
      <label className="mt-3 block">
        Note <span className="text-muted">(optional)</span>
        <textarea name="note" maxLength={1000} rows={2} className={field} />
      </label>
      <label className="mt-3 block">
        Email <span className="text-muted">(optional, only if we have a question)</span>
        <input name="email" type="email" maxLength={254} className={field} />
      </label>
      <button type="submit" className="mt-4 rounded-md border border-accent px-4 py-2 text-accent hover:bg-accent hover:text-bg">Send correction</button>
    </form>
  );
}

import { money } from "@/lib/format";
import { OWNER_PRICE_KINDS } from "@/lib/owner-edits";
import { SITE } from "@/lib/site";
import type { GymDetail } from "@/lib/types";

const field = "mt-1 block w-full rounded-md border border-line bg-bg px-3 py-2 text-sm focus:border-accent focus:outline-none";
const labels = { trial: "Trial / intro", drop_in: "Drop-in", monthly: "Monthly membership" };

export default function OwnerEditForm({ gym, saved, refreshDelayed }: { gym: GymDetail; saved?: boolean; refreshDelayed?: boolean }) {
  return (
    <section id="edit" className="mt-8 rounded-xl border border-line p-4">
      <h2 className="text-xl font-semibold">Edit {gym.name}</h2>
      {saved && <p role="status" className="mt-3 text-accent">{refreshDelayed ? "Changes saved. Public pages may take up to an hour to refresh." : "Changes published."} <a href={`/gym/${gym.slug}`} className="underline">View listing →</a></p>}
      <p className="mt-2 text-sm text-muted">Changes publish immediately. These are owner-supplied facts, not independently checked by {SITE.name}. Your claim is verified by hand before you can edit.</p>
      <form action="/api/owner-edit" method="post" className="mt-4 space-y-3 text-sm">
        <input type="hidden" name="gym" value={gym.slug} />
        <label className="block">Gym name<input name="name" required maxLength={160} defaultValue={gym.name} className={field} /></label>
        <label className="block">Street address<input name="address" maxLength={240} defaultValue={gym.address ?? ""} className={field} /></label>
        <p className="text-xs text-muted">City and state stay {gym.city}, {gym.state}. Location changes outside this city need review.</p>
        <label className="block">Website<input name="website" type="url" maxLength={500} placeholder="https://" defaultValue={gym.website ?? ""} className={field} /></label>
        <label className="block">Phone<input name="phone" type="tel" maxLength={40} defaultValue={gym.phone ?? ""} className={field} /></label>
        <label className="block">Description<textarea name="description" maxLength={2000} rows={4} defaultValue={gym.description ?? ""} className={field} /></label>
        <p className="text-xs text-muted">Clear an optional detail to remove it. Prices are in USD, up to $1,000; only trials can be free. Leave the amount empty when keeping or withdrawing a price. Replacing a price also replaces its previous contract notes; visitors are asked to confirm terms with the gym.</p>
        {OWNER_PRICE_KINDS.map(kind => {
          const current = gym.prices.find(p => p.kind === kind)?.amount_cents;
          return (
            <fieldset key={kind} className="rounded-md border border-line p-3">
              <legend className="px-1 font-medium">{labels[kind]} · {current == null ? "not listed" : money(current)}</legend>
              <label className="block">Price action<select name={`${kind}_action`} defaultValue="keep" className={field}>
                <option value="keep">Keep current price</option>
                <option value="set">Replace price</option>
                <option value="clear">Withdraw price</option>
              </select></label>
              <label className="mt-2 block">New amount (USD)<input name={`${kind}_price`} type="number" min={kind === "trial" ? "0" : "0.01"} max="1000" step="0.01" className={field} /></label>
            </fieldset>
          );
        })}
        <button type="submit" className="rounded-md bg-accent px-4 py-2 font-medium text-white">Publish changes</button>
      </form>
    </section>
  );
}

import { pageMetadata } from "@/lib/site";
import DirectoryState from "@/components/DirectoryState";
import { getUpcomingEvents } from "@/lib/data";

export const revalidate = 3600;
export async function generateMetadata() {
  const events = await getUpcomingEvents();
  return pageMetadata("/events", "Upcoming fights", "Listed upcoming combat sports events. Check event organizers for current dates, eligibility and registration details.", events.length > 0);
}

export default async function Events() {
  const events = await getUpcomingEvents();
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Upcoming fights</h1>
      <p className="text-muted mt-2">Upcoming event listings. Confirm dates and entry requirements with the organizer.</p>
      {events.length === 0 ? (
        <DirectoryState subject="upcoming events" />
      ) : (
        <table className="mt-8 w-full text-sm">
          <thead className="text-xs text-muted"><tr><th className="text-left font-normal py-1">Date</th><th className="text-left font-normal">Event</th><th className="text-left font-normal">Promotion</th><th className="text-left font-normal">Venue</th><th className="text-left font-normal">Amateurs</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.slug} className="border-t border-line">
                <td className="py-2.5 font-mono">{e.date}</td>
                <td className="py-2.5">{e.url ? <a href={e.url} className="underline" rel="nofollow">{e.name}</a> : e.name}</td>
                <td className="py-2.5 text-muted">{e.promotion}{e.sanctioning_body ? ` · ${e.sanctioning_body.toUpperCase()}` : ""}</td>
                <td className="py-2.5 text-muted">{e.venue}</td>
                <td className="py-2.5">{e.accepting_amateurs ? <span className="text-accent">yes</span> : <span className="text-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

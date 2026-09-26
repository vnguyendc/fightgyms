# First-Visit Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three first-visit entrances (Google → city page, Google → gym profile, direct → homepage) answer "can I start here as a beginner, is this a real fight gym, what does it cost, which is closest" with today's sparse data, plus site-wide search and a pending-only correction form.

**Architecture:** Pure helper modules (`format`, `geo`, `search`, `submissions`) carry all logic and are unit-tested in isolation. Server components keep every directory page static under the existing 1h ISR; three small client components (`GymList`+`SortControl`, `SiteSearch`) only re-sort or match data already in the HTML or fetched from a cached JSON route. Migration 0003 rebuilds the `gym_cards` view with `trial_cents` and `class_count`; `POST /api/submissions` is the only write path and inserts `status='pending'` rows through the anon key.

**Tech Stack:** Next.js 16.3.5 app router (params/searchParams are Promises; `PageProps<'/route'>` and `RouteContext` are global after `next typegen`), React 19, Tailwind v4, `@supabase/supabase-js` 2.x, Postgres (Supabase), `node:test` via `npm test` (each test file runs in its own process; Supabase is stubbed by mocking `globalThis.fetch`), Python 3.12 `scrapers/run_sql.py` for migrations.

**Spec:** `docs/superpowers/specs/2026-09-26-first-visit-experience-design.md`

## Global Constraints

- Never invent or estimate data for real gyms. Missing data is shown as missing. Google rating fields are never displayed or ranked on.
- Every directory page and the search-index route keep `export const revalidate = 3600`. No page becomes dynamic except `/claim` and `/search`, which read `searchParams` and are noindex.
- No new runtime dependencies. No map library.
- Files imported by client components (`GymCard`, `GymPhoto`, `GymList`, `SortControl`, `SiteSearch`) must import only `@/lib/format`, `@/lib/geo`, `@/lib/search`, `@/lib/types`, `next/link`, `next/image`, `react`. Never `@/lib/data` or `@/lib/site`.
- Never delete rows. The submissions route inserts `status='pending'` only and never touches directory tables.
- `LIVE_STYLES` stays `["muay_thai", "kickboxing"]`.
- Next 16: a POST that redirects must use `Response.redirect(url, 303)`; `redirect()` from `next/navigation` gives 307 and would re-POST.
- Tests use `node:test` + `renderToStaticMarkup`, fixtures from `web/tests/fixtures.ts`, and `t.mock.method(globalThis, "fetch", …)` for Supabase. Client components must not call `useRouter`/`useSearchParams` (no router context in tests); use `<Link>` and native form submission.
- Full check must stay green before every commit that touches `web/`: `cd web && npm test && npm run typecheck && npm run lint`. Before the final PR also `npm run build && npm run test:smoke` with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` unset.
- Commit messages: lowercase, terse, one line, ending with a blank line and `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Work on branch `first-visit-experience`.
- Read `web/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` and `page.md` before touching a route or page file.
- All work happens in the worktree `/Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience` on branch `first-visit-experience`. Ignored local files (`scrapers/.env`, `scrapers/.venv`, `web/.env.local`) live only in the main checkout `/Users/vinhnguyen/projects/fightgyms`; the commands below reference them there explicitly.

## Review Focus

1. **Card rows served before migration 0003 is applied** have no `trial_cents`/`class_count` keys at all. Cards, completeness and coverage must treat them as missing, never crash or show "—". Pinned in Task 2 (`geo.test.ts` legacy row) and Task 3 (`components.test.tsx` legacy card).
2. **Gyms or places with null coordinates**: distance sort keeps them at the end without a chip; nearby cities and nearest gyms skip them; "use my location" returns nothing rather than throwing. Pinned in Task 2 (`geo.test.ts`).
3. **Search input with regex metacharacters, 500-character strings, or repeated `q` params**: matching is plain string comparison, queries are sliced to 80 characters, the first `q` wins. Pinned in Task 5 (`search.test.ts`) and Task 6 (`routes-live.test.tsx`, `routes-missing.test.tsx`).
4. **Hostile submission bodies**: JSON arrays, non-JSON with a JSON content type, array-valued form fields, `javascript:` websites, 9 KB notes. All redirect to an error state or 413 without inserting. Pinned in Task 8 (`submissions.test.ts`).
5. **Environment leaks**: the header search form appears on every page (the smoke "no form" invariant must be re-targeted), and the correction form must never render in demo or unavailable mode. Pinned in Task 6 (`smoke.mjs`) and Task 9 (`routes-live.test.tsx` sample-listing case).
6. **Hydration**: `GymList` must render the server's order untouched on first render. Pinned in Task 4 (`components.test.tsx` asserts card order equals the completeness order computed by `CityPage`).

---

### Task 1: Schema — migration 0003, `GymCard` type, sample data

**Files:**
- Create: `supabase/migrations/0003_gym_cards_v3.sql`
- Modify: `web/src/lib/types.ts` (GymCard interface, after `monthly_cents`)
- Modify: `web/src/data/sample.json` (every entry in `gyms`)
- Test: scratchpad PGlite check (not committed) + `npm run typecheck`

**Interfaces:**
- Produces: `GymCard.trial_cents: number | null` and `GymCard.class_count: number` on every card row, from the view and from sample data. Later tasks read both with `!= null` / `?? 0` so rows from before the migration still work.

- [ ] **Step 1: Write the migration**

```sql
-- fightgyms: gym_cards v3
-- appends trial_cents (latest verified trial/intro price) and class_count (schedule rows).
-- rebuilt with drop, not replace, so the column set matches this file exactly (same as 0002).
-- run with: cd scrapers && .venv/bin/python run_sql.py ../supabase/migrations/0003_gym_cards_v3.sql
drop view if exists gym_cards;
create view gym_cards as
select
  g.id, g.slug, g.name, g.styles, g.tags, g.address, g.lat, g.lng,
  g.website, g.instagram, g.google_rating, g.google_reviews, g.claimed, g.is_sample,
  p.slug as place_slug, p.city, p.state,
  di.amount_cents as drop_in_cents,
  mo.amount_cents as monthly_cents,
  coalesce(fs.active_fighters, 0) as active_fighters,
  coalesce(fs.pro_fighters, 0)    as pro_fighters,
  ph.storage_path as photo_path,
  tr.amount_cents as trial_cents,
  coalesce(cc.n, 0)::int as class_count
from gyms g
left join places p on p.id = g.place_id
left join gym_current_prices di on di.gym_id = g.id and di.kind = 'drop_in'
left join gym_current_prices mo on mo.gym_id = g.id and mo.kind = 'monthly'
left join gym_current_prices tr on tr.gym_id = g.id and tr.kind = 'trial'
left join gym_fighter_stats fs on fs.gym_id = g.id
left join lateral (
  select storage_path from gym_photos x
  where x.gym_id = g.id and x.is_active
  order by x.is_primary desc, x.sort_order, x.created_at
  limit 1
) ph on true
left join lateral (
  select count(*) as n from classes c where c.gym_id = g.id
) cc on true
where g.is_active;
```

- [ ] **Step 2: Verify the migration chain on PGlite (scratchpad, not committed)**

```bash
S=/private/tmp/claude-501/-Users-vinhnguyen-projects-fightgyms/bab416cf-3478-4e0c-a8ad-f341c00b85b1/scratchpad/pglite
mkdir -p "$S" && cd "$S" && npm init -y >/dev/null && npm i --silent @electric-sql/pglite@^0.3
cat > check.mjs <<'JS'
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const root = "/Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience";
const db = new PGlite({ extensions: { pg_trgm, pgcrypto } });
// supabase-managed schemas the migrations reference
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public bool, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
`);
for (const f of ["0001_init.sql", "0002_photos.sql", "0003_gym_cards_v3.sql"]) await db.exec(readFileSync(`${root}/supabase/migrations/${f}`, "utf8"));
await db.exec(readFileSync(`${root}/supabase/seed.sql`, "utf8"));
await db.exec(`insert into gym_prices (gym_id, kind, amount_cents, verified_at, verified_by)
  select id, 'trial', 2000, '2026-09-01', 'website' from gyms where slug = 'sample-siam-strike-arlington-va'`);
const { rows } = await db.query("select slug, trial_cents, class_count from gym_cards order by slug");
console.table(rows);
const siam = rows.find(r => r.slug === "sample-siam-strike-arlington-va");
assert.equal(siam.trial_cents, 2000);
assert.ok(siam.class_count > 0, "seeded classes must count");
assert.ok(rows.every(r => typeof r.class_count === "number"), "class_count is an int, not a bigint string");
console.log("PASS gym_cards v3 on pglite");
JS
node check.mjs
```

Expected: a table of six sample gyms, Siam Strike with `trial_cents 2000` and `class_count > 0`, then `PASS gym_cards v3 on pglite`. If `create extension` fails, check the contrib import paths against `node_modules/@electric-sql/pglite/package.json` exports; if the seed fails on `current_date`, that is a PGlite quirk — replace with `'2026-09-20'` only in the scratchpad copy, never in `seed.sql`.

- [ ] **Step 3: Add the fields to the card type**

In `web/src/lib/types.ts`, inside `export interface GymCard`, directly after `monthly_cents: number | null;` add:

```ts
  /** latest verified trial / intro price; null when the gym has none listed */
  trial_cents: number | null;
  /** rows in `classes`; 0 means no schedule listed */
  class_count: number;
```

- [ ] **Step 4: Add the fields to sample data by script (4-space indent, keep trailing newline)**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/web && python3 - <<'PY'
import json
p = "src/data/sample.json"
raw = open(p).read()
d = json.loads(raw)
for g in d["gyms"]:
    det = d["gym_details"].get(g["slug"], {})
    trial = [x for x in det.get("prices", []) if x["kind"] == "trial"]
    g["trial_cents"] = trial[0]["amount_cents"] if trial else None
    g["class_count"] = len(det.get("classes", []))
out = json.dumps(d, indent=4, ensure_ascii=False)
open(p, "w").write(out + ("\n" if raw.endswith("\n") else ""))
PY
git diff --stat src/data/sample.json
```

Expected: about 18 insertions and 6 deletions (two new keys per gym, and the previous last key `photo_path` gains a trailing comma). If the diff is hundreds of lines, the indent or `ensure_ascii` differs from the file; fix the script parameters until the diff is that small.

- [ ] **Step 5: Typecheck and run the existing suite**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/web && npm run typecheck && npm test
```

Expected: both pass (the fixture `gym` spreads `sample.gyms[0]`, so it now carries both fields).

- [ ] **Step 6: Commit**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience && git add supabase/migrations/0003_gym_cards_v3.sql web/src/lib/types.ts web/src/data/sample.json && git commit -q -m "gym_cards v3: trial_cents, class_count

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `lib/format.ts` and `lib/geo.ts`

**Files:**
- Create: `web/src/lib/format.ts`, `web/src/lib/geo.ts`
- Modify: `web/src/lib/data.ts` (remove `photoUrl`, `money`, `DOW`, `fmtTime`; re-export them), `web/src/components/GymCard.tsx:3`, `web/src/components/GymPhoto.tsx:2`, `web/src/app/gym/[slug]/page.tsx:6`, `web/src/app/page.tsx`, `web/src/app/gyms/page.tsx` (use `placeCounts`)
- Test: `web/tests/geo.test.ts` (new), `web/tests/components.test.tsx` (money test stays; it imports from data, which re-exports)

**Interfaces:**
- Produces (`@/lib/format`): `money(cents)`, `DOW`, `fmtTime(t)`, `photoUrl(path)`, `miles(distance: number): string`, `listStates(states: string[]): string`.
- Produces (`@/lib/geo`): `haversineMiles(a, b)`, `distanceMi(from, to): number | null`, `hasPrice(g)`, `hasSchedule(g)`, `completeness(g): 0..4`, `byName(a, b)`, `byCompleteness(a, b)`, `withDistances(gyms, origin): { gym, distanceMi: number | null }[]`, `nearbyPlaces(origin, places, counts, { radiusMi = 25, limit = 6 }): NearbyPlace[]`, `nearestGyms(origin, gyms, limit = 3): { gym, distanceMi }[]`, `nearestPlace(origin, places): T | null`, `placeCounts(gyms): Map<string, number>`, `coverage(gyms): Coverage`, `coverageLine(c): string`, type `NearbyPlace = { place: Place; distanceMi: number; count: number }`.

- [ ] **Step 1: Write the failing tests**

`web/tests/geo.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import * as geo from "../src/lib/geo";
import { listStates, miles } from "../src/lib/format";
import { gym, place } from "./fixtures";

const arlington = { lat: 38.8816, lng: -77.091 }, dc = { lat: 38.9072, lng: -77.0369 };
const bare = { ...gym, trial_cents: null, drop_in_cents: null, monthly_cents: null, class_count: 0, photo_path: null, website: null, tags: [] as typeof gym.tags };

test("haversine matches known distances and is null without coordinates", () => {
  const d = geo.haversineMiles(arlington, dc);
  assert.ok(d > 3.2 && d < 3.6, String(d)); // Arlington VA to Washington DC centre
  const nyla = geo.haversineMiles({ lat: 40.7128, lng: -74.006 }, { lat: 34.0522, lng: -118.2437 });
  assert.ok(nyla > 2430 && nyla < 2460, String(nyla));
  assert.equal(geo.haversineMiles(arlington, arlington), 0);
  assert.equal(geo.distanceMi({ lat: null, lng: null }, dc), null);
  assert.equal(geo.distanceMi(arlington, { lat: 38.9, lng: null }), null);
});

test("completeness counts price, schedule, photo, website; legacy rows score zero; ordering is stable", () => {
  assert.equal(geo.completeness(bare), 0);
  assert.equal(geo.completeness({ ...bare, trial_cents: 2000 }), 1);
  assert.equal(geo.completeness({ ...bare, drop_in_cents: 2500, monthly_cents: 15000 }), 1);
  assert.equal(geo.completeness({ ...bare, class_count: 3, photo_path: "x.webp", website: "https://example.com" }), 3);
  const legacy = { ...bare } as Record<string, unknown>;
  delete legacy.trial_cents; delete legacy.class_count; // rows served before migration 0003
  assert.equal(geo.completeness(legacy as typeof bare), 0);
  const a = { ...bare, slug: "a", name: "Alpha" }, b = { ...bare, slug: "b", name: "Bravo", website: "https://example.com" }, c = { ...bare, slug: "c", name: "Alpha" };
  assert.deepEqual([c, b, a].sort(geo.byCompleteness).map((g) => g.slug), ["b", "a", "c"]);
});

test("distance sort keeps unlocated gyms at the end without a distance", () => {
  const far = { ...gym, slug: "far", lat: dc.lat, lng: dc.lng };
  const near = { ...gym, slug: "near", lat: 38.8827, lng: -77.0831 };
  const unknown = { ...gym, slug: "unknown", lat: null, lng: null };
  const out = geo.withDistances([unknown, far, near], arlington);
  assert.deepEqual(out.map((x) => x.gym.slug), ["near", "far", "unknown"]);
  assert.equal(out[2].distanceMi, null);
  assert.ok(out[0].distanceMi! < out[1].distanceMi!);
});

test("nearby places respect radius, limit, counts and skip the origin; nearest gyms skip self", () => {
  const dcPlace = { ...place, slug: "washington-dc", city: "Washington", state: "DC", lat: dc.lat, lng: dc.lng };
  const baltimore = { ...place, slug: "baltimore-md", city: "Baltimore", state: "MD", lat: 39.2904, lng: -76.6122 };
  const empty = { ...place, slug: "empty-va", city: "Empty", lat: 38.89, lng: -77.09 };
  const nowhere = { ...place, slug: "nowhere-va", city: "Nowhere", lat: null, lng: null };
  const counts = new Map([["arlington-va", 11], ["washington-dc", 16], ["baltimore-md", 9], ["nowhere-va", 2]]);
  assert.deepEqual(geo.nearbyPlaces(place, [place, dcPlace, baltimore, empty, nowhere], counts).map((x) => [x.place.slug, x.count]), [["washington-dc", 16]]);
  assert.deepEqual(geo.nearbyPlaces(place, [place, dcPlace, baltimore], counts, { radiusMi: 100, limit: 1 }).map((x) => x.place.slug), ["washington-dc"]);
  const self = { ...gym, slug: "self", lat: arlington.lat, lng: arlington.lng };
  const others = [{ ...gym, slug: "b", lat: 38.9, lng: -77.1 }, { ...gym, slug: "a", lat: 38.882, lng: -77.091 }, { ...gym, slug: "c", lat: 39.5, lng: -77 }, { ...gym, slug: "n", lat: null, lng: null }];
  assert.deepEqual(geo.nearestGyms(self, [self, ...others], 2).map((x) => x.gym.slug), ["a", "b"]);
  assert.equal(geo.nearestPlace({ lat: 39.3, lng: -76.6 }, [place, dcPlace, baltimore])?.slug, "baltimore-md");
  assert.equal(geo.nearestPlace({ lat: 39.3, lng: -76.6 }, [nowhere]), null);
  assert.deepEqual([...geo.placeCounts([gym, gym, { ...gym, place_slug: null }]).entries()], [["arlington-va", 2]]);
});

test("coverage line omits zero parts; formatting helpers", () => {
  assert.equal(geo.coverageLine(geo.coverage([bare])), "1 gym");
  const rows = [bare, { ...bare, tags: ["beginner_friendly" as const], trial_cents: 2000 }, { ...bare, class_count: 2, monthly_cents: 10000 }];
  assert.equal(geo.coverageLine(geo.coverage(rows)), "3 gyms · 1 beginner friendly · 2 with a listed price · 1 with a schedule");
  assert.equal(miles(0.84), "0.8 mi");
  assert.equal(miles(12.4), "12 mi");
  assert.equal(listStates(["VA", "DC", "VA", "MD"]), "DC, MD and VA");
  assert.equal(listStates(["VA"]), "VA");
  assert.equal(listStates([]), "");
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/web && node --import tsx --test tests/geo.test.ts
```

Expected: FAIL, cannot find module `../src/lib/geo` / `../src/lib/format`.

- [ ] **Step 3: Create `web/src/lib/format.ts`**

```ts
/** Display helpers that are safe in client bundles: no Supabase client, no sample data, no env-dependent site config. */

export function money(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(cents / 100);
}

export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function fmtTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hh}:${String(m).padStart(2, "0")}${ampm}` : `${hh}${ampm}`;
}

/** Public URL for a photo. Sample data uses site-relative paths under /public. */
export function photoUrl(path: string): string {
  return path.startsWith("/") ? path : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/gym-photos/${path}`;
}

/** "0.8 mi" under ten miles, whole miles from ten up. */
export function miles(distance: number): string {
  return `${distance < 10 ? distance.toFixed(1) : Math.round(distance)} mi`;
}

/** "DC, MD and VA" from any list of state codes. */
export function listStates(states: string[]): string {
  const s = [...new Set(states)].sort();
  return s.length > 1 ? `${s.slice(0, -1).join(", ")} and ${s[s.length - 1]}` : s[0] ?? "";
}
```

- [ ] **Step 4: Create `web/src/lib/geo.ts`**

```ts
import type { GymCard, Place } from "./types";

type LatLng = { lat: number | null; lng: number | null };
const EARTH_MI = 3958.8;

/** Great-circle distance in miles. */
export function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MI * Math.asin(Math.sqrt(h));
}

function located(p: LatLng): p is { lat: number; lng: number } {
  return p.lat != null && p.lng != null && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

export function distanceMi(from: LatLng, to: LatLng): number | null {
  return located(from) && located(to) ? haversineMiles(from, to) : null;
}

type Completable = Pick<GymCard, "trial_cents" | "drop_in_cents" | "monthly_cents" | "class_count" | "photo_path" | "website">;

export function hasPrice(g: Pick<Completable, "trial_cents" | "drop_in_cents" | "monthly_cents">): boolean {
  return g.trial_cents != null || g.drop_in_cents != null || g.monthly_cents != null;
}

export function hasSchedule(g: Pick<Completable, "class_count">): boolean {
  return (g.class_count ?? 0) > 0;
}

/** 0–4: any price, a schedule, a photo, a website. Rows from before migration 0003 lack the price/schedule fields and score them as missing. */
export function completeness(g: Completable): number {
  return Number(hasPrice(g)) + Number(hasSchedule(g)) + Number(!!g.photo_path) + Number(!!g.website);
}

export function byName(a: Pick<GymCard, "name" | "slug">, b: Pick<GymCard, "name" | "slug">): number {
  return a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug);
}

/** Most complete first; name then slug break ties so the order is identical on every render. */
export function byCompleteness(a: GymCard, b: GymCard): number {
  return completeness(b) - completeness(a) || byName(a, b);
}

type Located<T> = { item: T; distanceMi: number };

/** Nearest first. Items without coordinates are dropped. */
function nearest<T extends LatLng>(origin: LatLng, items: T[], limit = Infinity): Located<T>[] {
  return items.map((item) => ({ item, distanceMi: distanceMi(origin, item) }))
    .filter((x): x is Located<T> => x.distanceMi != null)
    .sort((a, b) => a.distanceMi - b.distanceMi)
    .slice(0, limit);
}

/** Gyms nearest first; unlocated gyms keep their relative order at the end with no distance. */
export function withDistances(gyms: GymCard[], origin: { lat: number; lng: number }): { gym: GymCard; distanceMi: number | null }[] {
  const near = nearest(origin, gyms).map(({ item, distanceMi }) => ({ gym: item, distanceMi }));
  const seen = new Set(near.map((x) => x.gym.slug));
  return [...near, ...gyms.filter((g) => !seen.has(g.slug)).map((gym) => ({ gym, distanceMi: null }))];
}

export type NearbyPlace = { place: Place; distanceMi: number; count: number };

/** Other populated places within radiusMi, nearest first. */
export function nearbyPlaces(origin: Place, places: Place[], counts: Map<string, number>, opts: { radiusMi?: number; limit?: number } = {}): NearbyPlace[] {
  const { radiusMi = 25, limit = 6 } = opts;
  const others = places.filter((p) => p.slug !== origin.slug && (counts.get(p.slug) ?? 0) > 0);
  return nearest(origin, others).filter((x) => x.distanceMi <= radiusMi).slice(0, limit)
    .map(({ item, distanceMi }) => ({ place: item, distanceMi, count: counts.get(item.slug) ?? 0 }));
}

/** Closest other gyms, any city. */
export function nearestGyms(origin: GymCard, gyms: GymCard[], limit = 3): { gym: GymCard; distanceMi: number }[] {
  return nearest(origin, gyms.filter((g) => g.slug !== origin.slug), limit).map(({ item, distanceMi }) => ({ gym: item, distanceMi }));
}

export function nearestPlace<T extends LatLng>(origin: { lat: number; lng: number }, places: T[]): T | null {
  return nearest(origin, places, 1)[0]?.item ?? null;
}

export function placeCounts(gyms: Pick<GymCard, "place_slug">[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const g of gyms) if (g.place_slug) counts.set(g.place_slug, (counts.get(g.place_slug) ?? 0) + 1);
  return counts;
}

export type Coverage = { total: number; beginner: number; priced: number; scheduled: number };

export function coverage(gyms: GymCard[]): Coverage {
  return {
    total: gyms.length,
    beginner: gyms.filter((g) => g.tags.includes("beginner_friendly")).length,
    priced: gyms.filter(hasPrice).length,
    scheduled: gyms.filter(hasSchedule).length,
  };
}

/** "11 gyms · 8 beginner friendly · 3 with a listed price · 4 with a schedule"; zero parts are left out. */
export function coverageLine(c: Coverage): string {
  const parts = [`${c.total} gym${c.total === 1 ? "" : "s"}`];
  if (c.beginner) parts.push(`${c.beginner} beginner friendly`);
  if (c.priced) parts.push(`${c.priced} with a listed price`);
  if (c.scheduled) parts.push(`${c.scheduled} with a schedule`);
  return parts.join(" · ");
}
```

- [ ] **Step 5: Move the helpers out of `data.ts` and repoint importers**

In `web/src/lib/data.ts` delete the `photoUrl`, `money`, `DOW` and `fmtTime` definitions (the last ~15 lines) and add, right after the imports:

```ts
// Display helpers live in ./format so client components never import this module (it bundles supabase-js and sample.json).
export { DOW, fmtTime, money, photoUrl } from "./format";
```

Then:
- `web/src/components/GymCard.tsx`: `import { money } from "@/lib/data";` → `import { money } from "@/lib/format";`
- `web/src/components/GymPhoto.tsx`: `import { photoUrl } from "@/lib/data";` → `import { photoUrl } from "@/lib/format";`
- `web/src/app/gym/[slug]/page.tsx`: replace the data import line with two lines: `import { getAllGyms, getGym, getPlace } from "@/lib/data";` and `import { DOW, fmtTime, money, photoUrl } from "@/lib/format";`
- `web/src/app/page.tsx` and `web/src/app/gyms/page.tsx`: replace the three-line `counts` construction with `const counts = placeCounts(gyms);` and add `import { placeCounts } from "@/lib/geo";`.

- [ ] **Step 6: Run the tests, typecheck, lint**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/web && node --import tsx --test tests/geo.test.ts && npm test && npm run typecheck && npm run lint
```

Expected: all PASS. If lint complains about unused `getAllGyms` in the profile page, keep it: Task 9 uses it; otherwise remove it from that import for now and re-add in Task 9.

- [ ] **Step 7: Commit**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience && git add web/src/lib web/src/components web/src/app web/tests/geo.test.ts && git commit -q -m "lib: format and geo helpers, client-safe

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `GymCard` rework — cost line, badges, distance chip

**Files:**
- Modify: `web/src/components/GymCard.tsx` (full rewrite below)
- Test: `web/tests/components.test.tsx`

**Interfaces:**
- Consumes: `money`, `miles` from `@/lib/format`; `hasSchedule` from `@/lib/geo`.
- Produces: `GymCard` default export with props `{ gym: GymCard; rank?: number; distanceMi?: number | null }`; named exports `Badge`, `FighterBadge` (unchanged), `costLine(gym): string | null`, `orderedTags(tags): Tag[]`.

- [ ] **Step 1: Write the failing tests** (append to `web/tests/components.test.tsx`)

```tsx
test("cards lead with the first listed price and never render empty price boxes", () => {
  const priced = { ...gym, trial_cents: 2000, drop_in_cents: 2500, monthly_cents: 15000, class_count: 2 };
  let html = renderToStaticMarkup(<GymCard gym={priced} />);
  assert.match(html, /Trial \$20/);
  assert.doesNotMatch(html, /Drop-in|Monthly|—/);
  assert.match(html, /Schedule listed/);
  html = renderToStaticMarkup(<GymCard gym={{ ...priced, trial_cents: null }} />);
  assert.match(html, /Drop-in \$25/);
  html = renderToStaticMarkup(<GymCard gym={{ ...priced, trial_cents: null, drop_in_cents: null }} />);
  assert.match(html, /Monthly \$150\/mo/);
  const bare = { ...gym, trial_cents: null, drop_in_cents: null, monthly_cents: null, class_count: 0 };
  html = renderToStaticMarkup(<GymCard gym={bare} />);
  assert.match(html, /Prices not listed/);
  assert.doesNotMatch(html, /Schedule listed|—/);
  const legacy = { ...bare } as Record<string, unknown>;
  delete legacy.trial_cents; delete legacy.class_count; // rows served before migration 0003
  assert.match(renderToStaticMarkup(<GymCard gym={legacy as typeof bare} />), /Prices not listed/);
});

test("cards show a distance chip only when given one and put beginner friendly first", () => {
  const tagged = { ...gym, tags: ["kids" as const, "beginner_friendly" as const] };
  const html = renderToStaticMarkup(<GymCard gym={tagged} distanceMi={0.84} />);
  assert.match(html, /0\.8 mi/);
  assert.ok(html.indexOf("Beginner friendly") < html.indexOf("Kids classes"));
  assert.doesNotMatch(renderToStaticMarkup(<GymCard gym={tagged} />), / mi</);
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/web && node --import tsx --test tests/components.test.tsx
```

Expected: the two new tests FAIL (`Trial $20` not found; `—` present).

- [ ] **Step 3: Rewrite `web/src/components/GymCard.tsx`**

```tsx
import Link from "next/link";
import { GymPhoto, PhotoFallback } from "@/components/GymPhoto";
import { miles, money } from "@/lib/format";
import { hasSchedule } from "@/lib/geo";
import { STYLE_LABEL, TAG_LABEL, type GymCard as GymCardT, type Tag } from "@/lib/types";

export function Badge({ children, tone = "line" }: { children: React.ReactNode; tone?: "line" | "accent" | "gold" }) {
  const cls =
    tone === "accent"
      ? "border-accent/60 text-accent"
      : tone === "gold"
        ? "border-gold/60 text-gold"
        : "border-line text-muted";
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${cls}`}>{children}</span>;
}

export function FighterBadge({ active, pro }: { active: number; pro: number }) {
  if (!active) return null;
  return (
    <Badge tone="gold">
      {active} active fighter{active === 1 ? "" : "s"}
      {pro ? ` · ${pro} pro` : ""}
    </Badge>
  );
}

/** The first price a first-time visitor cares about: to try, then to drop in, then to join. Null when none is listed. */
export function costLine(gym: Pick<GymCardT, "trial_cents" | "drop_in_cents" | "monthly_cents">): string | null {
  if (gym.trial_cents != null) return `Trial ${money(gym.trial_cents)}`;
  if (gym.drop_in_cents != null) return `Drop-in ${money(gym.drop_in_cents)}`;
  if (gym.monthly_cents != null) return `Monthly ${money(gym.monthly_cents)}/mo`;
  return null;
}

/** Beginner friendly leads; other tags keep their stored order. */
export function orderedTags(tags: Tag[]): Tag[] {
  return [...tags].sort((a, b) => Number(b === "beginner_friendly") - Number(a === "beginner_friendly"));
}

export default function GymCard({ gym, rank, distanceMi }: { gym: GymCardT; rank?: number; distanceMi?: number | null }) {
  const cost = costLine(gym);
  return (
    <Link
      href={`/gym/${gym.slug}`}
      className="block overflow-hidden rounded-xl border border-line bg-panel hover:border-accent/70 transition-colors"
    >
      <div className="relative aspect-video border-b border-line bg-bg">
        {gym.photo_path ? (
          <GymPhoto path={gym.photo_path} alt={gym.name} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" />
        ) : (
          <PhotoFallback styles={gym.styles} />
        )}
        {distanceMi != null && (
          <span className="absolute right-2 top-2 rounded-full border border-line bg-bg/90 px-2 py-0.5 font-mono text-xs">{miles(distanceMi)}</span>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-base leading-tight">
          {rank != null && <span className="text-muted mr-2 font-mono text-sm">#{rank}</span>}
          {gym.name}
        </h3>
        {gym.claimed && <span className="text-accent text-xs">✓ claimed</span>}
        <p className="text-sm text-muted mt-0.5 truncate">{gym.address ?? `${gym.city}, ${gym.state}`}</p>

        {cost ? (
          <p className="mt-3 font-mono text-sm">{cost}</p>
        ) : (
          <p className="mt-3 text-sm text-muted">Prices not listed</p>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {gym.styles.map((s) => (
            <Badge key={s} tone="accent">{STYLE_LABEL[s] ?? s}</Badge>
          ))}
          {orderedTags(gym.tags).slice(0, 3).map((t) => (
            <Badge key={t}>{TAG_LABEL[t] ?? t}</Badge>
          ))}
          {hasSchedule(gym) && <Badge tone="gold">Schedule listed</Badge>}
          <FighterBadge active={gym.active_fighters} pro={gym.pro_fighters} />
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 4: Run tests, typecheck, lint**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/web && npm test && npm run typecheck && npm run lint
```

Expected: PASS. (The existing card test still asserts no `★|reviews`.)

- [ ] **Step 5: Commit**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience && git add web/src/components/GymCard.tsx web/tests/components.test.tsx && git commit -q -m "gym card: first listed price, schedule chip, distance chip

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `GymList` + `SortControl` + `CityPage` (coverage, completeness order, nearby cities)

**Files:**
- Create: `web/src/components/SortControl.tsx`, `web/src/components/GymList.tsx`
- Modify: `web/src/components/CityPage.tsx` (full rewrite below), `web/src/app/gyms/[state]/[city]/page.tsx` (default export), `web/src/app/gyms/[state]/[city]/[style]/page.tsx` (default export)
- Test: `web/tests/components.test.tsx`

**Interfaces:**
- Consumes: `byCompleteness`, `byName`, `withDistances`, `coverage`, `coverageLine`, `nearbyPlaces`, `placeCounts`, type `NearbyPlace` from `@/lib/geo`; `miles` from `@/lib/format`; `GymCard` with `distanceMi` prop from Task 3.
- Produces: `GymList({ gyms })` client component (renders `gyms` in the given order by default); `SortControl({ mode, onChange, locating })` with `type SortMode = "complete" | "az" | "near"`; `CityPage({ place, gyms, style?, nearby? })`.

- [ ] **Step 1: Write the failing test** (append to `web/tests/components.test.tsx`)

```tsx
test("city pages order by completeness, state coverage honestly, and offer nearby cities", () => {
  const bare = { ...gym, trial_cents: null, drop_in_cents: null, monthly_cents: null, class_count: 0, photo_path: null, website: null, tags: [] as typeof gym.tags };
  const rows = [{ ...bare, slug: "zed", name: "Zed", id: "1" }, { ...bare, slug: "able", name: "Able", id: "2", trial_cents: 2000, tags: ["beginner_friendly" as const] }];
  const dc = { ...place, slug: "washington-dc", city: "Washington", state: "DC", lat: 38.9072, lng: -77.0369 };
  const nearby = [{ place: dc, distanceMi: 3.4, count: 16 }];
  const html = renderToStaticMarkup(<CityPage place={place} gyms={rows} nearby={nearby} />);
  assert.match(html, /2 gyms · 1 beginner friendly · 1 with a listed price · most complete listings first/);
  assert.ok(html.indexOf('href="/gym/able"') < html.indexOf('href="/gym/zed"'), "server order is the completeness order");
  const json = JSON.parse(html.match(/type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
  assert.deepEqual(json.itemListElement.map((e: { name: string }) => e.name), ["Able", "Zed"]);
  assert.match(html, /aria-pressed="true"[^>]*>Most complete/);
  assert.match(html, /Nearest to me/);
  assert.equal((html.match(/Nearby cities/g) ?? []).length, 2, "thin cities show nearby above and below the list");
  assert.match(html, /href="\/gyms\/dc\/washington"[^>]*>Washington, DC/);
  assert.match(html, /3\.4 mi/);
  const many = Array.from({ length: 4 }, (_, i) => ({ ...bare, slug: `g${i}`, id: `g${i}`, name: `Gym ${i}` }));
  assert.equal((renderToStaticMarkup(<CityPage place={place} gyms={many} nearby={nearby} />).match(/Nearby cities/g) ?? []).length, 1);
  assert.doesNotMatch(renderToStaticMarkup(<CityPage place={place} gyms={many} />), /Nearby cities/);
  assert.doesNotMatch(html, /Listed alphabetically/);
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/web && node --import tsx --test tests/components.test.tsx
```

Expected: FAIL on the coverage-line regex.

- [ ] **Step 3: Create `web/src/components/SortControl.tsx`**

```tsx
export type SortMode = "complete" | "az" | "near";

const LABEL: Record<SortMode, string> = { complete: "Most complete", az: "A to Z", near: "Nearest to me" };

export default function SortControl({ mode, onChange, locating }: { mode: SortMode; onChange: (mode: SortMode) => void; locating: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Sort gyms">
      <span className="text-muted">Sort</span>
      {(Object.keys(LABEL) as SortMode[]).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          aria-pressed={mode === m}
          className={`rounded-full border px-3 py-1 ${mode === m ? "border-accent text-accent" : "border-line text-muted hover:text-ink"}`}
        >
          {m === "near" && locating ? "Locating…" : LABEL[m]}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Create `web/src/components/GymList.tsx`**

```tsx
"use client";

import { useState } from "react";
import GymCard from "@/components/GymCard";
import SortControl, { type SortMode } from "@/components/SortControl";
import { byName, withDistances } from "@/lib/geo";
import type { GymCard as GymCardT } from "@/lib/types";

/**
 * `gyms` arrive in the server's default order (most complete first) and are rendered untouched
 * in that mode, so the hydrated tree matches the static HTML exactly.
 */
export default function GymList({ gyms }: { gyms: GymCardT[] }) {
  const [mode, setMode] = useState<SortMode>("complete");
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

  function change(next: SortMode) {
    if (next !== "near" || origin) return setMode(next);
    if (typeof navigator === "undefined" || !navigator.geolocation || locating) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setMode("near");
        setLocating(false);
      },
      () => setLocating(false), // denied or unavailable: keep the current sort, no error ui
      { maximumAge: 300000, timeout: 10000 },
    );
  }

  const rows =
    mode === "near" && origin ? withDistances(gyms, origin)
    : mode === "az" ? [...gyms].sort(byName).map((gym) => ({ gym, distanceMi: null }))
    : gyms.map((gym) => ({ gym, distanceMi: null }));

  return (
    <>
      <div className="mt-6"><SortControl mode={mode} onChange={change} locating={locating} /></div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(({ gym, distanceMi }) => (
          <GymCard key={gym.id} gym={gym} distanceMi={distanceMi} />
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 5: Rewrite `web/src/components/CityPage.tsx`**

```tsx
import Link from "next/link";
import GymList from "@/components/GymList";
import { miles } from "@/lib/format";
import { byCompleteness, coverage, coverageLine, type NearbyPlace } from "@/lib/geo";
import { SITE, cityPath, jsonLd as serializeJsonLd } from "@/lib/site";
import { LIVE_STYLES, STYLE_LABEL, type GymCard as GymCardT, type Place, type Style } from "@/lib/types";

function NearbyCities({ city, nearby }: { city: string; nearby: NearbyPlace[] }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold">Nearby cities</h2>
      <p className="mt-1 text-sm text-muted">Listed gyms within about 25 miles of {city}.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {nearby.map(({ place, distanceMi, count }) => (
          <Link key={place.slug} href={cityPath(place)} className="rounded-full border border-line px-4 py-2 text-sm hover:border-accent">
            {place.city}, {place.state} <span className="text-muted">({count} · {miles(distanceMi)})</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function CityPage({ place, gyms, style, nearby = [] }: { place: Place; gyms: GymCardT[]; style?: Style; nearby?: NearbyPlace[] }) {
  const base = cityPath(place);
  const label = style ? STYLE_LABEL[style] : "Muay Thai & Kickboxing";
  const ordered = [...gyms].sort(byCompleteness);
  const beginner = ordered.filter((g) => g.tags.includes("beginner_friendly"));
  const thin = gyms.length < 4 && nearby.length > 0;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${label} gyms in ${place.city}, ${place.state}`,
    numberOfItems: ordered.length,
    itemListElement: ordered.map((g, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE.url}/gym/${g.slug}`,
      name: g.name,
    })),
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
      <nav className="text-sm text-muted mb-4">
        <Link href="/gyms" className="hover:text-ink">Gyms</Link> / {place.state} /{" "}
        {style ? <Link href={base} className="hover:text-ink">{place.city}</Link> : place.city}
        {style && ` / ${STYLE_LABEL[style]}`}
      </nav>
      <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
        {label} gyms in {place.city}, {place.state}
      </h1>
      <p className="mt-3 text-muted max-w-2xl">
        {coverageLine(coverage(gyms))} · most complete listings first. Check with the gym for current classes, prices and trial availability.
      </p>

      <div className="mt-6 flex flex-wrap gap-2 text-sm">
        <Link href={base} className={`rounded-full border px-3 py-1 ${!style ? "border-accent text-accent" : "border-line text-muted hover:text-ink"}`}>All</Link>
        {LIVE_STYLES.filter((s) => gyms.some((g) => g.styles.includes(s))).map((s) => (
          <Link
            key={s}
            href={cityPath(place, s)}
            className={`rounded-full border px-3 py-1 ${style === s ? "border-accent text-accent" : "border-line text-muted hover:text-ink"}`}
          >
            {STYLE_LABEL[s]}
          </Link>
        ))}
      </div>

      {thin && <NearbyCities city={place.city} nearby={nearby} />}

      {gyms.length === 0 ? (
        <p className="mt-10 text-muted">No gyms listed yet. <Link href="/gyms" className="underline">Browse other cities.</Link></p>
      ) : (
        <GymList gyms={ordered} />
      )}

      {beginner.length > 0 && (
        <section className="mt-14 max-w-3xl">
          <h2 className="text-xl font-semibold">Starting {label.toLowerCase()} in {place.city} as a beginner</h2>
          <p className="mt-2 text-muted text-sm">
            {beginner.length} of the {gyms.length} listings here are tagged beginner friendly:{" "}
            {beginner.map((g, i) => (
              <span key={g.id}>
                <Link href={`/gym/${g.slug}`} className="text-ink underline">{g.name}</Link>
                {i < beginner.length - 1 ? ", " : "."}
              </span>
            ))}{" "}
            Ask the gym which classes welcome new students and whether equipment or a trial fee is required.
          </p>
        </section>
      )}

      {nearby.length > 0 && <NearbyCities city={place.city} nearby={nearby} />}
    </div>
  );
}
```

- [ ] **Step 6: Pass `nearby` from both city routes**

`web/src/app/gyms/[state]/[city]/page.tsx` — change the imports and the default export:

```tsx
import { getAllGyms, getGymsByPlace, getPlace, getPlaces } from "@/lib/data";
import { nearbyPlaces, placeCounts } from "@/lib/geo";
// ... generateStaticParams and generateMetadata unchanged ...
export default async function Page({ params }: PageProps<"/gyms/[state]/[city]">) {
  const { state, city } = await params;
  const place = await getPlace(`${city}-${state}`);
  if (!place) notFound();
  const [gyms, places, all] = await Promise.all([getGymsByPlace(place.slug), getPlaces(), getAllGyms()]);
  if (!gyms.length) notFound();
  return <CityPage place={place} gyms={gyms} nearby={nearbyPlaces(place, places, placeCounts(all))} />;
}
```

`web/src/app/gyms/[state]/[city]/[style]/page.tsx` — same shape (it already imports `getAllGyms` and `getPlaces`); add `import { nearbyPlaces, placeCounts } from "@/lib/geo";` and make the default export:

```tsx
export default async function Page({ params }: PageProps<"/gyms/[state]/[city]/[style]">) {
  const { state, city, style } = await params;
  const st = fromSlug(style);
  if (!st) notFound();
  const place = await getPlace(`${city}-${state}`);
  if (!place) notFound();
  const [gyms, places, all] = await Promise.all([getGymsByPlace(place.slug, st), getPlaces(), getAllGyms()]);
  if (!gyms.length) notFound();
  return <CityPage place={place} gyms={gyms} style={st} nearby={nearbyPlaces(place, places, placeCounts(all))} />;
}
```

- [ ] **Step 7: Run tests, typecheck, lint**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/web && npm test && npm run typecheck && npm run lint
```

Expected: PASS, including `routes-live` (its fixture answers both `gym_cards` list and `places` list) and `routes-missing` (404s unchanged).

- [ ] **Step 8: Commit**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience && git add web/src/components web/src/app/gyms web/tests/components.test.tsx && git commit -q -m "city page: completeness order, sort control, nearby cities

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Search matcher, index builder, `/api/search-index`

**Files:**
- Create: `web/src/lib/search.ts`, `web/src/lib/search-index.ts`, `web/src/app/api/search-index/route.ts`
- Test: `web/tests/search.test.ts` (new)

**Interfaces:**
- Produces (`@/lib/search`, client-safe): `interface SearchGym { name; slug; city; state; path }`, `interface SearchPlace { city; state; slug; lat; lng; count; path }`, `interface SearchIndex { gyms: SearchGym[]; places: SearchPlace[] }`, `EMPTY_INDEX`, `matchIndex(query, index, limit = 8): SearchIndex`.
- Produces (`@/lib/search-index`, server): `buildSearchIndex(gyms, places): SearchIndex`, `loadSearchIndex(): Promise<SearchIndex>`.
- Produces: `GET /api/search-index` → JSON `SearchIndex`, `revalidate = 3600`.

- [ ] **Step 1: Write the failing tests** — `web/tests/search.test.ts`

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_INDEX, matchIndex } from "../src/lib/search";
import { buildSearchIndex } from "../src/lib/search-index";
import { gym, place } from "./fixtures";

const index = buildSearchIndex(
  [
    { ...gym, slug: "b", name: "Bangkok Boxing" },
    { ...gym, slug: "a", name: "Arlington Muay Thai" },
    { ...gym, slug: "c", name: "Capital Kickboxing", place_slug: "washington-dc", city: "Washington", state: "DC" },
  ],
  [place, { ...place, slug: "washington-dc", city: "Washington", state: "DC" }, { ...place, slug: "empty-va", city: "Empty" }],
);

test("index carries names, paths and counts only, sorted for display", () => {
  assert.deepEqual(index.gyms.map((g) => g.slug), ["a", "b", "c"]);
  assert.deepEqual(index.places.map((p) => [p.slug, p.count, p.path]), [["arlington-va", 2, "/gyms/va/arlington"], ["washington-dc", 1, "/gyms/dc/washington"]]);
  assert.equal(index.gyms[0].path, "/gym/a");
  assert.deepEqual(Object.keys(index.gyms[0]).sort(), ["city", "name", "path", "slug", "state"]);
});

test("matching is case-insensitive, prefix before substring, bounded, and safe for odd input", () => {
  assert.deepEqual(matchIndex("ARL", index).places.map((p) => p.slug), ["arlington-va"]);
  assert.deepEqual(matchIndex("a", index).gyms.map((g) => g.slug), ["a", "b", "c"]); // prefix first, then substring in index order
  assert.deepEqual(matchIndex("bang", index).gyms.map((g) => g.slug), ["b"]);
  assert.deepEqual(matchIndex("ki", index).gyms.map((g) => g.slug), ["c"]);
  assert.deepEqual(matchIndex("wash", index).places.map((p) => p.slug), ["washington-dc"]);
  assert.deepEqual(matchIndex("  ", index), EMPTY_INDEX);
  assert.deepEqual(matchIndex("(", index), EMPTY_INDEX);
  assert.deepEqual(matchIndex("a".repeat(500), index), EMPTY_INDEX);
  assert.equal(matchIndex("a", index, 1).gyms.length, 1);
});

test("search index route returns the public index, and an empty index without a backend", async (t) => {
  Object.assign(process.env, { NODE_ENV: "production", VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-only-not-real" });
  delete process.env.SHOW_SAMPLE;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    return Response.json(url.includes("/places") ? [place] : [gym]);
  });
  const route = await import("../src/app/api/search-index/route");
  assert.equal(route.revalidate, 3600);
  const body = await (await route.GET()).json();
  assert.deepEqual(body.gyms.map((g: { slug: string }) => g.slug), ["test-gym"]);
  assert.equal(body.places[0].slug, "arlington-va");
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  assert.deepEqual(await (await route.GET()).json(), { gyms: [], places: [] });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/web && node --import tsx --test tests/search.test.ts
```

Expected: FAIL, cannot find module `../src/lib/search`.

- [ ] **Step 3: Create `web/src/lib/search.ts`**

```ts
/** Client-safe search index shape and matcher. Imports nothing from data or site. */

export interface SearchGym { name: string; slug: string; city: string | null; state: string | null; path: string }
export interface SearchPlace { city: string; state: string; slug: string; lat: number | null; lng: number | null; count: number; path: string }
export interface SearchIndex { gyms: SearchGym[]; places: SearchPlace[] }

export const EMPTY_INDEX: SearchIndex = { gyms: [], places: [] };

export function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function rank<T>(items: T[], text: (item: T) => string, q: string, limit: number): T[] {
  const prefix: T[] = [], inner: T[] = [];
  for (const item of items) {
    const hay = normalize(text(item));
    if (hay.startsWith(q)) prefix.push(item);
    else if (hay.includes(q)) inner.push(item);
  }
  return [...prefix, ...inner].slice(0, limit);
}

/** Case-insensitive prefix matches first, then substring matches. Plain string comparison, no regex; queries are cut at 80 characters. */
export function matchIndex(query: string, index: SearchIndex, limit = 8): SearchIndex {
  const q = normalize(query).slice(0, 80);
  if (!q) return EMPTY_INDEX;
  return {
    places: rank(index.places, (p) => `${p.city}, ${p.state}`, q, limit),
    gyms: rank(index.gyms, (g) => g.name, q, limit),
  };
}
```

- [ ] **Step 4: Create `web/src/lib/search-index.ts`**

```ts
import { getAllGyms, getPlaces } from "./data";
import { byName, placeCounts } from "./geo";
import type { SearchIndex } from "./search";
import { cityPath } from "./site";
import type { GymCard, Place } from "./types";

/** Names and paths only: the same public fields the directory pages already render. */
export function buildSearchIndex(gyms: GymCard[], places: Place[]): SearchIndex {
  const counts = placeCounts(gyms);
  return {
    gyms: [...gyms].sort(byName).map((g) => ({ name: g.name, slug: g.slug, city: g.city, state: g.state, path: `/gym/${g.slug}` })),
    places: places
      .filter((p) => (counts.get(p.slug) ?? 0) > 0)
      .sort((a, b) => (counts.get(b.slug) ?? 0) - (counts.get(a.slug) ?? 0) || a.city.localeCompare(b.city))
      .map((p) => ({ city: p.city, state: p.state, slug: p.slug, lat: p.lat, lng: p.lng, count: counts.get(p.slug) ?? 0, path: cityPath(p) })),
  };
}

export async function loadSearchIndex(): Promise<SearchIndex> {
  const [gyms, places] = await Promise.all([getAllGyms(), getPlaces()]);
  return buildSearchIndex(gyms, places);
}
```

- [ ] **Step 5: Create `web/src/app/api/search-index/route.ts`**

```ts
import { loadSearchIndex } from "@/lib/search-index";

// Static with hourly revalidation, like the directory pages (route.md: "Revalidating Cached Data").
export const revalidate = 3600;

export async function GET() {
  return Response.json(await loadSearchIndex());
}
```

- [ ] **Step 6: Run tests, typecheck, lint**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/web && node --import tsx --test tests/search.test.ts && npm test && npm run typecheck && npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience && git add web/src/lib/search.ts web/src/lib/search-index.ts web/src/app/api/search-index web/tests/search.test.ts && git commit -q -m "search: matcher, index builder, cached index route

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `SiteSearch` component, `/search` page, header search, smoke update

**Files:**
- Create: `web/src/components/SiteSearch.tsx`, `web/src/app/search/page.tsx`
- Modify: `web/src/app/layout.tsx` (header nav), `web/tests/smoke.mjs` (form check + `/search` path + index route)
- Test: `web/tests/components.test.tsx`, `web/tests/routes-missing.test.tsx`, `web/tests/routes-live.test.tsx`

**Interfaces:**
- Consumes: `matchIndex`, `EMPTY_INDEX`, `SearchIndex` from `@/lib/search`; `nearestPlace` from `@/lib/geo`; `buildSearchIndex` from `@/lib/search-index`; `GymCard`, `DirectoryState`.
- Produces: `SiteSearch({ size?: "compact" | "large"; initialQuery?: string })` client component; `/search?q=` page (noindex, dynamic).

- [ ] **Step 1: Write the failing tests**

Append to `web/tests/components.test.tsx` (add `import SiteSearch from "../src/components/SiteSearch";` at the top):

```tsx
test("site search is a plain GET form to /search with no suggestions until focused", () => {
  const html = renderToStaticMarkup(<SiteSearch size="large" initialQuery="arl" />);
  assert.match(html, /<form[^>]*action="\/search"[^>]*method="get"/);
  assert.match(html, /name="q"[^>]*value="arl"/);
  assert.doesNotMatch(html, /role="listbox"|Use my location/);
});
```

Append to `web/tests/routes-missing.test.tsx` (add `import * as search from "../src/app/search/page";`):

```tsx
test("search page is noindex, escapes the query, and shows the unavailable state without a backend", async () => {
  assert.deepEqual(search.metadata.robots, { index: false, follow: false });
  assert.equal(search.metadata.alternates?.canonical, "https://findfightgyms.com/search");
  const html = renderToStaticMarkup(await search.default({ params: Promise.resolve({}), searchParams: Promise.resolve({ q: "<script>alert(1)</script>" }) }));
  assert.match(html, /Directory temporarily unavailable/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /name="q"/);
});
```

Also in that file's `claim` test, after the layout `Updates \(not available yet\)` assertion, add: `assert.match(layout, /<SiteSearch/);`

Append to `web/tests/routes-live.test.tsx` (add `import * as search from "../src/app/search/page";`):

```tsx
test("search page lists matching cities and gyms, and says so when nothing matches", async t => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => fixtureResponse(input));
  const page = (q: string | string[]) => search.default({ params: Promise.resolve({}), searchParams: Promise.resolve({ q }) });
  let html = renderToStaticMarkup(await page("test"));
  assert.match(html, /href="\/gym\/test-gym"/);
  html = renderToStaticMarkup(await page("arl"));
  assert.match(html, /href="\/gyms\/va\/arlington"/);
  html = renderToStaticMarkup(await page(["zzz", "test"]));
  assert.match(html, /No listed gyms or cities match/);
  assert.doesNotMatch(html, /href="\/gym\/test-gym"/);
});
```

And in the first `routes-live` test, change the sitemap exclusion to `assert.ok(!urls.some(url => /kickboxing$|\/events$|\/claim$|\/search$/.test(url)));`.

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/web && npm test
```

Expected: the new tests FAIL (missing modules).

- [ ] **Step 3: Create `web/src/components/SiteSearch.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { nearestPlace } from "@/lib/geo";
import { EMPTY_INDEX, matchIndex, type SearchIndex } from "@/lib/search";

type Item = { key: string; label: string; detail: string; href: string };

/**
 * One box for gym and city names. Plain GET form to /search without JavaScript; with it, suggestions
 * come from /api/search-index (fetched once, on first focus) and "Use my location" jumps to the nearest listed city.
 * No router hooks: suggestions are <Link>s, Enter clicks the active one.
 */
export default function SiteSearch({ size = "compact", initialQuery = "" }: { size?: "compact" | "large"; initialQuery?: string }) {
  const id = useId();
  const listId = `${id}-listbox`;
  const [query, setQuery] = useState(initialQuery);
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [locating, setLocating] = useState(false);
  const pending = useRef<Promise<SearchIndex> | null>(null);
  const links = useRef<(HTMLAnchorElement | null)[]>([]);

  function loadIndex(): Promise<SearchIndex> {
    if (!pending.current) {
      pending.current = fetch("/api/search-index")
        .then((r) => (r.ok ? (r.json() as Promise<SearchIndex>) : EMPTY_INDEX))
        .catch(() => EMPTY_INDEX)
        .then((idx) => { setIndex(idx); return idx; });
    }
    return pending.current;
  }

  const q = query.trim();
  const matches = q && index ? matchIndex(q, index, 6) : EMPTY_INDEX;
  const items: Item[] = [
    ...matches.places.map((p) => ({ key: `p-${p.slug}`, label: `${p.city}, ${p.state}`, detail: `${p.count} gym${p.count === 1 ? "" : "s"}`, href: p.path })),
    ...matches.gyms.map((g) => ({ key: `g-${g.slug}`, label: g.name, detail: [g.city, g.state].filter(Boolean).join(", "), href: g.path })),
  ];
  // Only evaluated once the list is open (a client event), so server and first client render agree.
  const canLocate = !q && typeof navigator !== "undefined" && !!navigator.geolocation;
  const offset = canLocate ? 1 : 0;
  const count = items.length + offset;

  function locate() {
    if (locating || typeof navigator === "undefined" || !navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const idx = await loadIndex();
        const place = nearestPlace({ lat: pos.coords.latitude, lng: pos.coords.longitude }, idx.places);
        setLocating(false);
        if (place) window.location.assign(place.path);
      },
      () => setLocating(false),
      { maximumAge: 300000, timeout: 10000 },
    );
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || count === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % count); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a <= 0 ? count - 1 : a - 1)); }
    else if (e.key === "Escape") { setOpen(false); setActive(-1); }
    else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      if (canLocate && active === 0) locate();
      else links.current[active - offset]?.click();
    }
  }

  const large = size === "large";
  return (
    <form action="/search" method="get" role="search" className={`relative ${large ? "max-w-xl" : "w-48 md:w-64"}`}>
      <label htmlFor={`${id}-input`} className="sr-only">Search gyms and cities</label>
      <input
        id={`${id}-input`}
        name="q"
        type="search"
        value={query}
        placeholder={large ? "Search a gym or city" : "Gym or city"}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && count > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        onFocus={() => { setOpen(true); void loadIndex(); }}
        onBlur={() => setOpen(false)}
        onChange={(e) => { setQuery(e.target.value); setActive(-1); setOpen(true); }}
        onKeyDown={onKeyDown}
        className={`w-full rounded-md border border-line bg-panel px-3 focus:border-accent focus:outline-none ${large ? "py-3 text-base" : "py-1.5 text-sm"}`}
      />
      {open && count > 0 && (
        <ul
          id={listId}
          role="listbox"
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-md border border-line bg-panel text-sm shadow-lg"
        >
          {canLocate && (
            <li id={`${listId}-0`} role="option" aria-selected={active === 0}>
              <button type="button" onClick={locate} className={`block w-full px-3 py-2 text-left ${active === 0 ? "bg-bg" : ""}`}>
                {locating ? "Locating…" : "Use my location"} <span className="text-muted">nearest listed city</span>
              </button>
            </li>
          )}
          {items.map((item, i) => {
            const at = i + offset;
            return (
              <li key={item.key} id={`${listId}-${at}`} role="option" aria-selected={active === at}>
                <Link href={item.href} ref={(el) => { links.current[i] = el; }} className={`flex justify-between gap-3 px-3 py-2 ${active === at ? "bg-bg" : ""}`}>
                  <span>{item.label}</span>
                  <span className="text-muted">{item.detail}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </form>
  );
}
```

- [ ] **Step 4: Create `web/src/app/search/page.tsx`**

```tsx
import Link from "next/link";
import DirectoryState from "@/components/DirectoryState";
import GymCard from "@/components/GymCard";
import SiteSearch from "@/components/SiteSearch";
import { getAllGyms, getPlaces } from "@/lib/data";
import { matchIndex } from "@/lib/search";
import { buildSearchIndex } from "@/lib/search-index";
import { pageMetadata } from "@/lib/site";

// Always noindex: a query page is never a landing page and never enters the sitemap.
export const metadata = pageMetadata("/search", "Search gyms and cities", "Search listed Muay Thai and kickboxing gyms and cities by name.", false);

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const q = (raw ?? "").slice(0, 80);
  const [gyms, places] = await Promise.all([getAllGyms(), getPlaces()]);
  const results = matchIndex(q, buildSearchIndex(gyms, places), 20);
  const bySlug = new Map(gyms.map((g) => [g.slug, g]));
  const cards = results.gyms.flatMap((g) => bySlug.get(g.slug) ?? []);
  const none = q.trim() !== "" && results.places.length === 0 && cards.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Search gyms and cities</h1>
      <div className="mt-4"><SiteSearch size="large" initialQuery={q} /></div>
      {!gyms.length ? (
        <DirectoryState />
      ) : (
        <>
          {results.places.length > 0 && (
            <section className="mt-8">
              <h2 className="text-xl font-semibold">Cities</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {results.places.map((p) => (
                  <Link key={p.slug} href={p.path} className="rounded-full border border-line px-4 py-2 text-sm hover:border-accent">
                    {p.city}, {p.state} <span className="text-muted">({p.count})</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          {cards.length > 0 && (
            <section className="mt-8">
              <h2 className="text-xl font-semibold">Gyms</h2>
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {cards.map((g) => <GymCard key={g.id} gym={g} />)}
              </div>
            </section>
          )}
          {none && <p className="mt-8 text-muted">No listed gyms or cities match “{q}”. <Link href="/gyms" className="underline">Browse all cities.</Link></p>}
          {!q.trim() && <p className="mt-8 text-muted">Type a gym or city name, or <Link href="/gyms" className="underline">browse all cities</Link>.</p>}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Put the search box in the header**

In `web/src/app/layout.tsx` add `import SiteSearch from "@/components/SiteSearch";` and replace the `<nav>` block with:

```tsx
            <nav className="flex items-center gap-4 text-sm text-muted">
              <div className="hidden sm:block"><SiteSearch /></div>
              <Link href="/search" className="sm:hidden hover:text-ink">Search</Link>
              <Link href="/gyms" className="hover:text-ink">Gyms</Link>
              <Link href="/events" className="hover:text-ink">Events</Link>
              <Link href="/claim" className="hidden sm:inline-block rounded-md border border-line px-3 py-1.5 hover:border-accent hover:text-ink">
                Gym updates
              </Link>
            </nav>
```

(“Gym updates” stays reachable from the footer on phones.)

- [ ] **Step 6: Update the smoke test**

In `web/tests/smoke.mjs`:
- The first loop's path list becomes `["/", "/gyms", "/events", "/claim?gym=sample-siam-strike-arlington-va", "/search?q=arlington"]`.
- Change `assert.doesNotMatch(html, /Siam Strike Muay Thai|DMV Fight Night|aggregateRating|<form/);` to `assert.doesNotMatch(html, /Siam Strike Muay Thai|DMV Fight Night|aggregateRating|action="\/api\/submissions"/);` (the header search is a form on every page now).
- After the robots check add:

```js
  const index = await request("/api/search-index");
  assert.equal(index.status, 200);
  assert.equal(index.html, '{"gyms":[],"places":[]}');
  console.log("PASS /api/search-index: empty index without a backend");
```

- [ ] **Step 7: Run tests, typecheck, lint**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/web && npm test && npm run typecheck && npm run lint
```

Expected: PASS. If lint flags `react-hooks/refs` on `links.current[i] = el`, that assignment lives in a ref callback (allowed); if it flags `pending.current` reads, they are inside event handlers (allowed) — re-check the code is not reading refs during render before changing anything.

- [ ] **Step 8: Build and smoke (unconfigured)**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/web && NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= npm run build && NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= npm run test:smoke
```

Expected: build succeeds (`/search` listed as dynamic, `/api/search-index` as static), every smoke line prints PASS. `web/.env.local` holds live Supabase config; the empty-string overrides win because `@next/env` only fills variables that are undefined. If smoke nevertheless sees real data (a 200 on `/gyms/va/arlington`), run the same command with `.env.local` temporarily renamed to `.env.local.off`, then rename it back.

- [ ] **Step 9: Commit**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience && git add web/src/components/SiteSearch.tsx web/src/app/search web/src/app/layout.tsx web/tests && git commit -q -m "site search: header box, hero box, noindex /search fallback

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Homepage — search-first hero, computed coverage, most complete listings

**Files:**
- Modify: `web/src/app/page.tsx` (full rewrite below)
- Test: `web/tests/routes-live.test.tsx`, `web/tests/routes-missing.test.tsx`

**Interfaces:**
- Consumes: `SiteSearch`, `GymCard`, `DirectoryState`; `listStates` from `@/lib/format`; `byCompleteness`, `placeCounts` from `@/lib/geo`; `cityPath` from `@/lib/site`.

- [ ] **Step 1: Write the failing assertions**

In `web/tests/routes-live.test.tsx`, first test, after `const html = renderToStaticMarkup(await home.default());` add:

```ts
  assert.match(html, /1 gym in 1 city across VA\./);
  assert.match(html, /Most complete listings/);
  assert.match(html, /name="q"/);
  assert.doesNotMatch(html, /Explore the directory|listed alphabetically/);
```

In `web/tests/routes-missing.test.tsx`, first test, inside the loop after the `Directory temporarily unavailable` match add:

```ts
    assert.doesNotMatch(html, / cities across /);
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/web && node --import tsx --test tests/routes-live.test.tsx
```

Expected: FAIL on `1 gym in 1 city across VA`.

- [ ] **Step 3: Rewrite `web/src/app/page.tsx`**

```tsx
import Link from "next/link";
import DirectoryState from "@/components/DirectoryState";
import GymCard from "@/components/GymCard";
import SiteSearch from "@/components/SiteSearch";
import { getAllGyms, getPlaces } from "@/lib/data";
import { listStates } from "@/lib/format";
import { byCompleteness, placeCounts } from "@/lib/geo";
import { SITE, cityPath, pageMetadata } from "@/lib/site";
import { LIVE_STYLES, STYLE_LABEL } from "@/lib/types";

export const revalidate = 3600;

export async function generateMetadata() {
  const gyms = await getAllGyms();
  return pageMetadata("/", `${SITE.name} — ${SITE.tagline}`, SITE.description, gyms.length > 0);
}

// Factual about what is listed; nothing here promises data a gym has not published.
const HOW = [
  ["Start as a beginner", "Gyms tagged beginner friendly describe fundamentals or all-levels classes on their own site. Ask about a trial class and what to bring."],
  ["Find a real fight gym", "The fight team tag means the gym describes an active competition team on its site. Fighter records are not listed yet."],
  ["Know the price before you go", "Trial, drop-in and monthly prices appear where a gym publishes them, with the date they were checked. Confirm before you visit."],
] as const;

export default async function Home() {
  const [places, gyms] = await Promise.all([getPlaces(), getAllGyms()]);
  const counts = placeCounts(gyms);
  const cities = places.filter((p) => counts.get(p.slug)).sort((a, b) => (counts.get(b.slug) ?? 0) - (counts.get(a.slug) ?? 0));
  const featured = [...gyms].sort(byCompleteness).slice(0, 6);
  const states = listStates(cities.map((p) => p.state));

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-16 md:py-24 max-w-3xl">
        <p className="text-accent font-mono text-sm mb-3">muay thai · kickboxing · more soon</p>
        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05]">
          Find your Muay Thai or kickboxing gym.
        </h1>
        <p className="mt-5 text-lg text-muted max-w-xl">{SITE.description}</p>
        {gyms.length > 0 && (
          <p className="mt-3 text-sm text-muted">
            {gyms.length} gym{gyms.length === 1 ? "" : "s"} in {cities.length} {cities.length === 1 ? "city" : "cities"} across {states}.
          </p>
        )}
        <div className="mt-8"><SiteSearch size="large" /></div>
        <div className="mt-4 flex flex-wrap gap-2">
          {cities.slice(0, 8).map((p) => (
            <Link key={p.slug} href={cityPath(p)} className="rounded-full border border-line px-4 py-2 text-sm hover:border-accent">
              {p.city}, {p.state} <span className="text-muted">({counts.get(p.slug)})</span>
            </Link>
          ))}
          <Link href="/gyms" className="rounded-full px-4 py-2 text-sm text-muted hover:text-ink">
            all cities →
          </Link>
        </div>
      </section>

      <section className="py-8">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-xl font-semibold">Most complete listings</h2>
          <span className="text-sm text-muted">prices, schedule, photos and website where listed</span>
        </div>
        {!gyms.length && <DirectoryState />}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((g) => (
            <GymCard key={g.id} gym={g} />
          ))}
        </div>
      </section>

      <section className="py-8 grid gap-6 md:grid-cols-3">
        {HOW.map(([h, p]) => (
          <div key={h} className="rounded-xl border border-line p-5">
            <h3 className="font-semibold">{h}</h3>
            <p className="mt-2 text-sm text-muted">{p}</p>
          </div>
        ))}
      </section>

      <section className="py-8">
        <h2 className="text-xl font-semibold mb-3">Browse by discipline</h2>
        <div className="flex flex-wrap gap-2">
          {LIVE_STYLES.map((s) =>
            cities.filter((p) => gyms.some((g) => g.place_slug === p.slug && g.styles.includes(s))).slice(0, 4).map((p) => (
              <Link key={s + p.slug} href={cityPath(p, s)} className="text-sm text-muted hover:text-ink underline">
                {STYLE_LABEL[s]} in {p.city}
              </Link>
            )),
          )}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run tests, typecheck, lint**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/web && npm test && npm run typecheck && npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience && git add web/src/app/page.tsx web/tests && git commit -q -m "home: search-first hero, computed coverage, most complete listings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Submissions — parser, insert, `POST /api/submissions`, `/claim` states

**Files:**
- Create: `web/src/lib/submissions.ts`, `web/src/app/api/submissions/route.ts`
- Modify: `web/src/lib/data.ts` (add `getGymCard`, use it in `getGym`), `web/src/app/claim/page.tsx` (full rewrite below), `web/tests/smoke.mjs`
- Test: `web/tests/submissions.test.ts` (new)

**Interfaces:**
- Consumes: `safeExternalUrl`, `runtimePolicy` from `@/lib/site`.
- Produces (`@/lib/submissions`): `SUBMISSION_FIELDS`, `type SubmissionField`, `FIELD_LABEL: Record<SubmissionField, string>`, `parseCents(value): number | null`, `parseSubmission(body): ParsedSubmission`, `insertSubmission(entityId, input): Promise<void>`.
- Produces (`@/lib/data`): `getGymCard(slug): Promise<GymCard | null>`.
- Produces: `POST /api/submissions` per the spec's validation table; `/claim?submitted=1&gym=<slug>` and `/claim?error=<code>&gym=<slug>` states.

- [ ] **Step 1: Write the failing tests** — `web/tests/submissions.test.ts`

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCents, parseSubmission } from "../src/lib/submissions";
import { gym } from "./fixtures";

const live = { NODE_ENV: "production", VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-only-not-real" };
function unconfigured() {
  Object.assign(process.env, { NODE_ENV: "production" });
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SHOW_SAMPLE;
}
unconfigured();

function post(body: Record<string, string> | string, type = "application/x-www-form-urlencoded") {
  const text = typeof body === "string" ? body : new URLSearchParams(body).toString();
  return new Request("http://localhost:3000/api/submissions", { method: "POST", headers: { "content-type": type, "content-length": String(text.length) }, body: text });
}
const good = { gym: "test-gym", field: "trial_price", value: "$20", note: "first class", email: "" };
const url = (r: Response) => new URL(r.headers.get("location")!);

test("prices parse to cents within a sane range", () => {
  assert.equal(parseCents("$25"), 2500);
  assert.equal(parseCents("25.5"), 2550);
  assert.equal(parseCents(" 25.00 "), 2500);
  assert.equal(parseCents("1000"), 100000);
  for (const bad of ["twenty", "0.50", "1001", "-5", "25.999", "$", "", "1e3"]) assert.equal(parseCents(bad), null, bad);
});

test("parsing enforces the allowlist, value rules, note and email limits, and the honeypot", () => {
  assert.deepEqual(parseSubmission(good), { ok: true, honeypot: false, input: { gym: "test-gym", field: "trial_price", value: "$20", cents: 2000, note: "first class", email: null } });
  assert.deepEqual(parseSubmission({ ...good, website_url: "http://spam.example" }), { ok: true, honeypot: true, gym: "test-gym" });
  assert.deepEqual(parseSubmission({ ...good, gym: "../etc" }), { ok: false, error: "gym" });
  assert.deepEqual(parseSubmission({ ...good, field: "google_rating" }), { ok: false, error: "field" });
  assert.deepEqual(parseSubmission({ ...good, value: "twenty" }), { ok: false, error: "value" });
  assert.deepEqual(parseSubmission({ ...good, field: "website", value: "javascript:alert(1)" }), { ok: false, error: "value" });
  assert.equal(parseSubmission({ ...good, field: "website", value: "https://example.com/prices" }).ok, true);
  assert.deepEqual(parseSubmission({ ...good, field: "other", value: "" }), { ok: false, error: "value" });
  assert.deepEqual(parseSubmission({ ...good, field: "other", value: "x".repeat(201) }), { ok: false, error: "value" });
  assert.deepEqual(parseSubmission({ ...good, note: "x".repeat(1001) }), { ok: false, error: "value" });
  assert.deepEqual(parseSubmission({ ...good, email: "not-an-email" }), { ok: false, error: "value" });
  const withEmail = parseSubmission({ ...good, email: "a@b.co" });
  assert.equal(withEmail.ok && !withEmail.honeypot ? withEmail.input.email : null, "a@b.co");
  assert.deepEqual(parseSubmission({ ...good, value: ["$20"] }), { ok: false, error: "value" });
  assert.deepEqual(parseSubmission({}), { ok: false, error: "gym" });
});

test("route refuses outside the live directory and never contacts the backend", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not be called"); });
  const route = await import("../src/app/api/submissions/route");
  assert.equal((await route.POST(post(good))).status, 503);
  Object.assign(process.env, { ...live, NODE_ENV: "development", SHOW_SAMPLE: "1" }); // demo mode
  assert.equal((await route.POST(post(good))).status, 503);
  assert.equal(fetchMock.mock.callCount(), 0);
  unconfigured();
});

test("route validates, looks up the gym, inserts a pending row and redirects with 303", async (t) => {
  Object.assign(process.env, live);
  delete process.env.SHOW_SAMPLE;
  const calls: { url: string; method: string; body: string }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const u = String(input instanceof Request ? input.url : input);
    calls.push({ url: u, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : "" });
    if (u.includes("/gym_cards")) return Response.json(u.includes("slug=eq.missing") ? null : gym);
    if (u.includes("/submissions")) return new Response(null, { status: 201 });
    return Response.json([]);
  });
  const route = await import("../src/app/api/submissions/route");
  let res = await route.POST(post(good));
  assert.equal(res.status, 303);
  assert.equal(url(res).pathname + url(res).search, "/claim?submitted=1&gym=test-gym");
  const insert = calls.find((c) => c.url.includes("/submissions"));
  assert.ok(insert && insert.method === "POST", "insert was sent");
  assert.deepEqual(JSON.parse(insert.body), { entity_type: "gym", entity_id: "test-gym", field: "trial_price", proposed_value: { value: "$20", cents: 2000 }, note: "first class", contact_email: null, status: "pending" });

  calls.length = 0;
  res = await route.POST(post({ ...good, website_url: "x" }));
  assert.equal(url(res).search, "?submitted=1&gym=test-gym");
  assert.ok(!calls.some((c) => c.url.includes("/submissions")), "honeypot never inserts");

  for (const [body, error] of [[{ ...good, field: "nope" }, "field"], [{ ...good, value: "free" }, "value"], [{ ...good, gym: "missing" }, "notfound&gym=missing"], [{}, "gym"]] as const) {
    assert.equal(url(await route.POST(post(body))).search, `?error=${error}`, error);
  }
  assert.equal(url(await route.POST(post(JSON.stringify(good), "application/json"))).search, "?submitted=1&gym=test-gym");
  assert.equal(url(await route.POST(post("[1,2]", "application/json"))).search, "?error=gym");
  assert.equal(url(await route.POST(post("not json", "application/json"))).search, "?error=gym");
  assert.equal((await route.POST(post({ ...good, note: "x".repeat(9000) }))).status, 413);

  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
    String(input instanceof Request ? input.url : input).includes("/submissions")
      ? new Response(JSON.stringify({ message: "denied" }), { status: 403 })
      : Response.json(gym));
  assert.equal(url(await route.POST(post(good))).search, "?error=1&gym=test-gym", "a failed insert is never a thank-you");
  unconfigured();
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/web && node --import tsx --test tests/submissions.test.ts
```

Expected: FAIL, cannot find module `../src/lib/submissions`.

- [ ] **Step 3: Create `web/src/lib/submissions.ts`**

```ts
import { createClient } from "@supabase/supabase-js";
import { safeExternalUrl } from "./site";

export const SUBMISSION_FIELDS = ["trial_price", "drop_in_price", "monthly_price", "website", "other"] as const;
export type SubmissionField = (typeof SUBMISSION_FIELDS)[number];
const PRICE_FIELDS: readonly SubmissionField[] = ["trial_price", "drop_in_price", "monthly_price"];

export const FIELD_LABEL: Record<SubmissionField, string> = {
  trial_price: "Trial or intro price",
  drop_in_price: "Drop-in price",
  monthly_price: "Monthly price",
  website: "Website",
  other: "Something else",
};

export interface SubmissionInput {
  gym: string;
  field: SubmissionField;
  value: string;
  cents: number | null;
  note: string | null;
  email: string | null;
}

export type ParsedSubmission =
  | { ok: true; honeypot: false; input: SubmissionInput }
  | { ok: true; honeypot: true; gym: string | null }
  | { ok: false; error: "gym" | "field" | "value" };

const SLUG = /^[a-z0-9-]{1,120}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** "$25", "25", "25.00", "25.5" → cents; anything else, or outside $1–$1,000, → null. */
export function parseCents(value: string): number | null {
  const m = /^\$?\s*(\d{1,4})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return cents >= 100 && cents <= 100000 ? cents : null;
}

/** Pure validation of a form or JSON body. Non-string values count as empty. */
export function parseSubmission(body: Record<string, unknown>): ParsedSubmission {
  const gym = str(body.gym);
  const slug = SLUG.test(gym) ? gym : null;
  if (str(body.website_url)) return { ok: true, honeypot: true, gym: slug };
  if (!slug) return { ok: false, error: "gym" };
  const field = str(body.field) as SubmissionField;
  if (!SUBMISSION_FIELDS.includes(field)) return { ok: false, error: "field" };
  const value = str(body.value);
  const note = str(body.note);
  const email = str(body.email);
  if (note.length > 1000) return { ok: false, error: "value" };
  if (email && (email.length > 254 || !EMAIL.test(email))) return { ok: false, error: "value" };
  let cents: number | null = null;
  if (PRICE_FIELDS.includes(field)) {
    cents = parseCents(value);
    if (cents == null) return { ok: false, error: "value" };
  } else if (field === "website") {
    if (value.length > 500 || !safeExternalUrl(value)) return { ok: false, error: "value" };
  } else if (value.length < 1 || value.length > 200) {
    return { ok: false, error: "value" };
  }
  return { ok: true, honeypot: false, input: { gym: slug, field, value, cents, note: note || null, email: email || null } };
}

/** One pending row through the public anon key (RLS allows insert only). Nothing is published or updated. */
export async function insertSubmission(entityId: string, input: SubmissionInput): Promise<void> {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.from("submissions").insert({
    entity_type: "gym",
    entity_id: entityId,
    field: input.field,
    proposed_value: { value: input.value, cents: input.cents },
    note: input.note,
    contact_email: input.email,
    status: "pending",
  });
  if (error) throw new Error("Submission could not be saved.");
}
```

- [ ] **Step 4: Add `getGymCard` to `web/src/lib/data.ts` and use it in `getGym`**

Insert before `getGym`:

```ts
/** One public card row by slug, or null. Used by the profile and by the submissions route to resolve a gym id. */
export async function getGymCard(slug: string): Promise<GymCard | null> {
  const c = sb();
  if (!c) {
    if (!demo()) return null;
    const card = S.gyms.find((g) => g.slug === slug);
    return card && live(card) ? card : null;
  }
  const card: GymCard | null = await checked(c.from("gym_cards").select("*").eq("slug", slug).eq("is_sample", false).maybeSingle());
  return card && visible(card) && live(card) ? card : null;
}
```

Then in `getGym`, replace the two lines
`const card: GymCard | null = await checked(c.from("gym_cards")...maybeSingle());` and `if (!card || !visible(card) || !live(card)) return null;`
with
`const card = await getGymCard(slug);` and `if (!card) return null;`.

- [ ] **Step 5: Create `web/src/app/api/submissions/route.ts`**

```ts
import { getGymCard } from "@/lib/data";
import { runtimePolicy } from "@/lib/site";
import { insertSubmission, parseSubmission } from "@/lib/submissions";

const MAX_BODY = 8 * 1024;

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    if ((request.headers.get("content-type") ?? "").includes("application/json")) {
      const json: unknown = await request.json();
      return json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
    }
    const form = await request.formData();
    return Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));
  } catch {
    return {};
  }
}

/**
 * Files a pending correction from a gym page. Never publishes, never updates directory tables,
 * never runs outside the live directory. Redirects are 303 so the browser GETs /claim after a POST.
 */
export async function POST(request: Request) {
  if (runtimePolicy().mode !== "live") return Response.json({ error: "Submissions are not available in this environment." }, { status: 503 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "Submission too large." }, { status: 413 });
  const back = (query: string) => Response.redirect(new URL(`/claim?${query}`, request.url), 303);
  const parsed = parseSubmission(await readBody(request));
  if (!parsed.ok) return back(`error=${parsed.error}`);
  if (parsed.honeypot) return back(parsed.gym ? `submitted=1&gym=${parsed.gym}` : "submitted=1");
  try {
    const card = await getGymCard(parsed.input.gym);
    if (!card) return back(`error=notfound&gym=${parsed.input.gym}`);
    await insertSubmission(card.id, parsed.input);
    return back(`submitted=1&gym=${card.slug}`);
  } catch {
    return back(`error=1&gym=${parsed.input.gym}`);
  }
}
```

- [ ] **Step 6: Rewrite `web/src/app/claim/page.tsx`**

```tsx
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
```

- [ ] **Step 7: Add the smoke check**

In `web/tests/smoke.mjs`, after the search-index check from Task 6, add:

```js
  const post = await fetch(`http://127.0.0.1:${port}/api/submissions`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "gym=x&field=other&value=y", redirect: "manual", signal: AbortSignal.timeout(15000),
  });
  assert.equal(post.status, 503);
  console.log("PASS 503 /api/submissions: refuses without a live backend");
```

- [ ] **Step 8: Run tests, typecheck, lint**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/web && node --import tsx --test tests/submissions.test.ts && npm test && npm run typecheck && npm run lint
```

Expected: PASS. `routes-missing`'s claim test still matches `not available yet` and finds no `<form`.

- [ ] **Step 9: Commit**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience && git add web/src/lib/submissions.ts web/src/lib/data.ts web/src/app/api/submissions web/src/app/claim/page.tsx web/tests && git commit -q -m "submissions: pending-only corrections route and claim states

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Gym profile — trust line, cost panel, correction form, nearest gyms

**Files:**
- Create: `web/src/components/CorrectionForm.tsx`
- Modify: `web/src/app/gym/[slug]/page.tsx` (imports, top of component, trust line, JSON-LD `priceRange`, whole `<aside>`)
- Test: `web/tests/routes-live.test.tsx`

**Interfaces:**
- Consumes: `FIELD_LABEL`, `SUBMISSION_FIELDS` from `@/lib/submissions`; `nearestGyms` from `@/lib/geo`; `miles` from `@/lib/format`; `runtimePolicy` from `@/lib/site`; `getAllGyms`.
- Produces: `CorrectionForm({ slug })` server component rendering the plain HTML form with id `correct`.

- [ ] **Step 1: Write the failing tests** (in `web/tests/routes-live.test.tsx`)

In the profile test ("profiles use escaped, rating-free JSON-LD…"), replace
`assert.match(html, /Gym claims and submissions are not available yet\./);`
with:

```ts
  assert.doesNotMatch(html, /not available yet/);
  assert.match(html, /<form[^>]*action="\/api\/submissions"[^>]*method="post"/);
  assert.match(html, /name="gym" value="test-gym"/);
  assert.match(html, /name="website_url"/);
  assert.match(html, /What it costs[\s\S]*No prices listed yet/);
```

Add a new test:

```ts
test("profiles show what it costs, where the facts came from, and the nearest gyms", async t => {
  const near = { ...gym, id: "near", slug: "near-gym", name: "Near Gym", lat: 38.8827, lng: -77.0831 };
  const trial = { gym_id: gym.id, kind: "trial", amount_cents: 2000, currency: "usd", contract_months: null, free_trial: null, notes: null, verified_at: "2026-09-01", verified_by: "website" };
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const u = String(input instanceof Request ? input.url : input);
    if (u.includes("/gym_current_prices")) return Response.json([trial]);
    if (u.includes("/gym_cards")) return Response.json(u.includes("slug=eq.") ? gym : [gym, near]);
    return fixtureResponse(input);
  });
  const html = renderToStaticMarkup(await profile.default(gymProps));
  assert.match(html, /What it costs[\s\S]{0,400}Intro \/ trial[\s\S]{0,200}\$20/);
  assert.match(html, /Listed from the gym’s website · prices last verified 2026-09-01/);
  assert.match(html, /Nearby gyms[\s\S]*href="\/gym\/near-gym"[\s\S]*mi</);
  const schema = JSON.parse(html.match(/type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
  assert.equal(schema.priceRange, "$20 trial");
});
```

In the "preview and demo routes" test, after `assert.match(renderToStaticMarkup(await profile.default(sampleProps)), /Sample listing/);` add:

```ts
    const demoHtml = renderToStaticMarkup(await profile.default(sampleProps));
    assert.doesNotMatch(demoHtml, /api\/submissions/);
    assert.match(demoHtml, /not available in this environment/);
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/web && node --import tsx --test tests/routes-live.test.tsx
```

Expected: FAIL (no form, no "What it costs").

- [ ] **Step 3: Create `web/src/components/CorrectionForm.tsx`**

```tsx
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
```

- [ ] **Step 4: Edit `web/src/app/gym/[slug]/page.tsx`**

Imports become:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CorrectionForm from "@/components/CorrectionForm";
import { Badge, FighterBadge } from "@/components/GymCard";
import { GymPhoto } from "@/components/GymPhoto";
import { getAllGyms, getGym, getPlace } from "@/lib/data";
import { DOW, fmtTime, miles, money, photoUrl } from "@/lib/format";
import { nearestGyms } from "@/lib/geo";
import { SITE, cityPath, jsonLd as serializeJsonLd, pageMetadata, runtimePolicy, safeExternalUrl } from "@/lib/site";
import { LIVE_STYLES, STYLE_LABEL, TAG_LABEL, type Price } from "@/lib/types";
```

Top of the component, replace everything from `const place = …` through `const prices = …` with:

```tsx
  const [place, all] = await Promise.all([g.place_slug ? getPlace(g.place_slug) : null, getAllGyms()]);
  const cityHref = place ? cityPath(place) : "/gyms";
  const website = safeExternalUrl(g.website);
  const live = runtimePolicy().mode === "live";
  const byDay = new Map<number, typeof g.classes>();
  for (const c of g.classes) byDay.set(c.dow, [...(byDay.get(c.dow) ?? []), c]);
  const lastVerified = g.prices.map((p) => p.verified_at).filter(Boolean).sort().at(-1);
  const order: Price["kind"][] = ["drop_in", "trial", "class_pack", "monthly", "fighter", "private"];
  const prices = [...g.prices].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  // What a first-time visitor asks first: to try, to drop in, to join.
  const headline = (["trial", "drop_in", "monthly"] as const).flatMap((k) => prices.filter((p) => p.kind === k && p.amount_cents != null));
  const trial = g.trial_cents ?? headline.find((p) => p.kind === "trial")?.amount_cents ?? null;
  const fromWebsite = g.prices.some((p) => p.verified_by === "website") || g.photos.some((p) => p.credit === "website");
  const trust = [fromWebsite ? "Listed from the gym’s website" : null, lastVerified ? `prices last verified ${lastVerified}` : null].filter(Boolean).join(" · ");
  const nearby = nearestGyms(g, all, 3);
```

In `jsonLd`, replace the `priceRange` line with:

```tsx
    priceRange: trial != null ? `${money(trial)} trial` : g.drop_in_cents != null ? `${money(g.drop_in_cents)} drop-in` : undefined,
```

Directly after `<p className="mt-2 text-muted">{g.address}</p>` add:

```tsx
          {trust && <p className="mt-1 text-xs text-muted">{trust}</p>}
```

Replace the whole `<aside className="space-y-4">…</aside>` with:

```tsx
        <aside className="space-y-4">
          <div className="rounded-xl border border-line bg-panel p-4 text-sm">
            <div className="text-xs text-muted">What it costs</div>
            {headline.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {headline.map((p) => (
                  <li key={p.kind} className="flex items-baseline justify-between gap-3">
                    <span>{PRICE_LABEL[p.kind]}</span>
                    <span className="font-mono text-lg">{money(p.amount_cents)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-muted">No prices listed yet.{live && <> <a href="#correct" className="underline">Know a price? Tell us.</a></>}</p>
            )}
            <div className="mt-4 space-y-1.5">
              {website && <a href={website} rel="nofollow noopener" target="_blank" className="block underline hover:text-accent">Website ↗</a>}
              {g.instagram && <a href={`https://instagram.com/${g.instagram.replace(/^@/, "")}`} rel="nofollow noopener" target="_blank" className="block underline hover:text-accent">@{g.instagram.replace(/^@/, "")}</a>}
              {g.phone && <a href={`tel:${g.phone}`} className="block underline hover:text-accent">{g.phone}</a>}
              {g.address && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(g.address)}`} rel="nofollow noopener" target="_blank" className="block underline hover:text-accent">Directions ↗</a>}
            </div>
            {g.founded_year && <div className="mt-4 text-xs text-muted">Est. {g.founded_year}</div>}
          </div>
          {live ? (
            <CorrectionForm slug={g.slug} />
          ) : (
            <div className="rounded-xl border border-line p-4 text-sm">
              <div className="font-medium">Corrections</div>
              <p className="text-muted mt-1">Listing corrections are not available in this environment.</p>
            </div>
          )}
          <div className="rounded-xl border border-line p-4 text-sm">
            {nearby.length > 0 && (
              <>
                <div className="font-medium">Nearby gyms</div>
                <ul className="mt-2 space-y-1.5">
                  {nearby.map(({ gym: n, distanceMi }) => (
                    <li key={n.slug} className="flex justify-between gap-3">
                      <Link href={`/gym/${n.slug}`} className="underline hover:text-accent">{n.name}</Link>
                      <span className="text-muted whitespace-nowrap">{miles(distanceMi)}{n.city && n.city !== g.city ? ` · ${n.city}` : ""}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {place && (
              <>
                <Link href={cityHref} className={`${nearby.length ? "mt-3" : ""} block underline`}>All gyms in {place.city}</Link>
                {g.styles.filter((s) => LIVE_STYLES.includes(s)).map((s) => (
                  <Link key={s} href={cityPath(place, s)} className="mt-2 block underline">{STYLE_LABEL[s]} in {place.city}</Link>
                ))}
              </>
            )}
          </div>
        </aside>
```

- [ ] **Step 5: Run tests, typecheck, lint**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/web && npm test && npm run typecheck && npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience && git add web/src/components/CorrectionForm.tsx "web/src/app/gym/[slug]/page.tsx" web/tests/routes-live.test.tsx && git commit -q -m "gym profile: what it costs, trust line, correction form, nearby gyms

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Docs and the full check

**Files:**
- Modify: `web/tests/README.md` (Data contract / publishing), `CLAUDE.md` (layout + next), `docs/launch-operations.md` (gates + verification)

- [ ] **Step 1: `web/tests/README.md`** — in "## Data contract / publishing" replace the first paragraph with:

```markdown
Reads use `gym_cards` (migration 0003 adds `trial_cents` and `class_count`; rows without them render as missing data, not errors), `places`, `gyms`, `gym_current_prices`, `classes`, `coaches`, `fighters`, `events`. The only write path is `POST /api/submissions`, which inserts `status='pending'` rows into `submissions` through the anon key, never updates directory tables, and returns 503 outside the live directory. Keep `LIVE_STYLES` at `muay_thai` and `kickboxing`.
```

and replace the sentence beginning "`/claim` is always noindex and has no submission form…" with:

```markdown
`/claim` is always noindex and collects nothing itself; it only shows the thank-you and error states for corrections filed from a gym page. `/search` and `/api/search-index` expose gym and city names only; `/search` is noindex and never in the sitemap.
```

- [ ] **Step 2: `CLAUDE.md`** — in the `web/` layout bullet, after the sentence about `site.ts`, add: `` `lib/geo.ts` (distance, completeness, coverage), `lib/format.ts` (client-safe display helpers), `lib/search.ts` (index matcher), `lib/submissions.ts` (correction parsing + pending insert). ``
  In the migrations bullet append: `` `0003_gym_cards_v3.sql` — adds `trial_cents`, `class_count` to `gym_cards`. ``
  Replace "next" item 1 with: `` 1. magic-link auth + `claims`; then photo upload on `/claim` (storage policy for verified claimants already in 0002). `POST /api/submissions` (pending corrections from gym pages) is done. ``

- [ ] **Step 3: `docs/launch-operations.md`** — under "## Scope and current gates" add a bullet after the `SHOW_SAMPLE` one:

```markdown
- Apply `supabase/migrations/0003_gym_cards_v3.sql` (`cd scrapers && .venv/bin/python run_sql.py ../supabase/migrations/0003_gym_cards_v3.sql`) before deploying a build that reads `trial_cents`/`class_count`. Older rows render as missing data, not errors. Rollback is re-running the view definition in `0002_photos.sql`; never drop data.
```

Under "## Verification and rollback" add:

```markdown
- Corrections: `POST /api/submissions` writes `status='pending'` rows only. Review them in `submissions` and set `status` to `approved` or `rejected` by hand; approved values are entered through the normal scraper/manual paths with a `source_id`, never copied blindly.
```

- [ ] **Step 4: Full check**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/web && npm test && npm run typecheck && npm run lint && NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= npm run build && NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= npm run test:smoke
```

Expected: everything green. Same `.env.local` caveat as Task 6 Step 8.

- [ ] **Step 5: Commit**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience && git add web/tests/README.md CLAUDE.md docs/launch-operations.md && git commit -q -m "docs: gym_cards v3, submissions route, search routes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Apply migration 0003 live, verify with real data, open the PR

**Requires the user's explicit go-ahead before Step 1 (production view rebuild) and before Step 4 (writes one test row to the production `submissions` table).**

- [ ] **Step 1: Apply the migration**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/scrapers && set -a && . /Users/vinhnguyen/projects/fightgyms/scrapers/.env && set +a && /Users/vinhnguyen/projects/fightgyms/scrapers/.venv/bin/python run_sql.py ../supabase/migrations/0003_gym_cards_v3.sql
```

- [ ] **Step 2: Verify columns, coverage and anon grants**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/scrapers && set -a && . /Users/vinhnguyen/projects/fightgyms/scrapers/.env && set +a && /Users/vinhnguyen/projects/fightgyms/scrapers/.venv/bin/python run_sql.py -c "select count(*) filter (where trial_cents is not null) trial, count(*) filter (where class_count > 0) scheduled, count(*) total from gym_cards where is_sample = false" && .venv/bin/python run_sql.py -c "select grantee, privilege_type from information_schema.role_table_grants where table_name = 'gym_cards' and grantee in ('anon','authenticated') order by 1,2"
```

Expected on 2026-09-26 data: `trial 52, scheduled 40, total 192`, and `anon SELECT` present. If `anon` has no SELECT, run `grant select on gym_cards to anon, authenticated;` and re-check.

- [ ] **Step 3: Run the dev server against live data and check the three entrances**

Copy the ignored live config into the worktree first: `cp /Users/vinhnguyen/projects/fightgyms/web/.env.local /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/web/.env.local` (never commit it). Then start the `web` launch configuration (`.claude/launch.json`) and, in the browser:
- `/gyms/va/arlington`: coverage line shows nonzero counts, cards show `Trial $…` where present and `Prices not listed` otherwise, "Sort" control present, "Nearby cities" lists DC/Alexandria/Falls Church with distances. Click "Nearest to me" and allow location: cards re-sort and show mile chips (if location is denied nothing changes and no error appears).
- `/gym/<a real slug with a trial price>`: "What it costs" lists the trial, trust line shows "Listed from the gym's website · prices last verified …", "Correct this listing" form present, "Nearby gyms" lists three with distances.
- `/`: hero search box; type "arl" → suggestion "Arlington, VA (11 gyms)"; Enter navigates. Coverage line reads "192 gyms in 63 cities across DC, MD and VA." (numbers as of 2026-09-26).
- `/search?q=arl` with JavaScript disabled in dev tools: server-rendered results appear.
- Console: no hydration warnings on the city page or home.

- [ ] **Step 4: File one real correction and neutralise it (user go-ahead required)**

In the browser on a real gym page, submit: field "Something else", value `launch check — please ignore`, note `test submission, marking rejected`. Expect the thank-you page. Then:

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/scrapers && set -a && . /Users/vinhnguyen/projects/fightgyms/scrapers/.env && set +a && /Users/vinhnguyen/projects/fightgyms/scrapers/.venv/bin/python run_sql.py -c "select id, entity_id, field, proposed_value, status, created_at from submissions order by created_at desc limit 1"
```

Confirm the row is the test, then:

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience/scrapers && set -a && . /Users/vinhnguyen/projects/fightgyms/scrapers/.env && set +a && /Users/vinhnguyen/projects/fightgyms/scrapers/.venv/bin/python run_sql.py -c "update submissions set status = 'rejected', note = coalesce(note, '') || ' [launch check]' where id = '<id from the previous query>' and status = 'pending'"
```

- [ ] **Step 5: Push and open the PR**

```bash
cd /Users/vinhnguyen/projects/fightgyms/.claude/worktrees/first-visit-experience && git push -u origin first-visit-experience && gh pr create --base master --title "first-visit experience: honest cards, near me, search, corrections" --body "$(cat <<'BODY'
## summary
- city pages: most-complete-first order, sort by distance, nearby cities, honest coverage line
- gym cards: first listed price instead of two empty boxes, schedule chip, distance chip; migration 0003 surfaces trial prices and class counts
- gym profiles: what-it-costs panel, source/trust line, correction form → `POST /api/submissions` (pending rows only), nearest gyms
- site-wide search in the header and hero with a cached index route and a noindex `/search` fallback
- homepage: search-first hero, computed coverage line, most complete listings

## test plan
- [ ] `npm test && npm run typecheck && npm run lint && npm run build && npm run test:smoke` green
- [ ] migration 0003 applied; `gym_cards` has `trial_cents` (52) and `class_count` (40) on 2026-09-26 data; anon can select
- [ ] live: city page, profile, home, `/search` checked in the browser; one correction filed and marked rejected

spec: `docs/superpowers/specs/2026-09-26-first-visit-experience-design.md`
plan: `docs/superpowers/plans/2026-09-26-first-visit-experience.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

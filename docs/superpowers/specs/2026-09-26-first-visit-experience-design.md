# first-visit experience — design

2026-09-26. approved in conversation; implementation plan follows.

## intent

a first-time visitor should answer, on the page they land on, the two questions the playbook says searchers have: can i start here as a beginner, and is this a real fight gym. success is a visitor who picks a gym and leaves for its website or directions trusting what they saw, or tells us a fact we were missing.

entrances, in priority order by expected traffic:

1. google → `/gyms/[state]/[city]` ("muay thai gyms in arlington va")
2. google → `/gym/[slug]` (gym name)
3. direct → `/`

## constraints

live data on 2026-09-26 (queried, not estimated): 192 real gyms across 63 places. website 178, address 192, phone 181, coordinates 192. beginner_friendly tag 153, kids 97, fighter_gym 68. trial price 52, monthly 16, drop-in 8, class schedules 40, photos 9. fighters 0, claimed 0, descriptions 0.

design for today's data: lead with what is populated, let missing fields recede, ask visitors to fill gaps. never invent or estimate. never show google ratings. keep all directory pages static under the existing 1h isr. no map library.

## shared pieces

**card** (`GymCard`). the two price boxes are removed. one cost line shows the first present of: `Trial $X` · `Drop-in $X` · `Monthly $X/mo`; otherwise muted "Prices not listed". badges: live disciplines, then tags with `beginner_friendly` first, then a `Schedule listed` chip when `class_count > 0`. photo or existing fallback on top. an optional distance chip (`1.2 mi`) rendered when the parent supplies a distance. no empty boxes anywhere.

**completeness** (`lib/geo.ts`): integer 0–4 = has any price + has schedule + has photo + has website. default order on list pages: completeness desc, then name asc, then slug asc. pages that use it say so in visible copy ("most complete listings first").

**distance** (`lib/geo.ts`): haversine in miles; `nearbyPlaces(place, places, counts, {radiusMi: 25, limit: 6})`; `nearestGyms(gym, gyms, 3)`. pure functions, no i/o, safe in client bundles.

**format** (`lib/format.ts`): `money`, `DOW`, `fmtTime`, `photoUrl` move here from `lib/data.ts` (which re-exports them for existing imports). `data.ts` imports supabase and sample json and must never reach a client bundle.

**search** (`components/SiteSearch.tsx`, client). one text box matching gym names and city names, case-insensitive prefix then substring. selecting a gym → `/gym/[slug]`; a city → its city page. keyboard: up/down/enter/escape. when empty and geolocation is available, first suggestion is "Use my location" → nearest populated place. index is fetched on first focus from `GET /api/search-index` (`{ gyms: [{name, slug, city, state}], places: [{city, state, slug, lat, lng, count}] }`, isr 1h, ~15 kb today). no-js fallback: the box is `<form action="/search" method="get">`. rendered in the header on every page (compact) and in the homepage hero (large). no tag or price filtering.

**search page** (`/search?q=`): dynamic, noindex, not in sitemap. renders matching gyms as cards and matching cities as links using the same match function. empty query or no match shows a short state with a link to `/gyms`.

## 1. city page

- h1 unchanged. subline becomes a computed coverage line, nonzero parts only: `11 gyms · 8 beginner friendly · 3 with a listed price · 4 with a schedule · most complete listings first`.
- style chips unchanged. beside them, `SortControl` (client): `Most complete` (default, matches server order) · `A to Z` · `Nearest to me`. nearest requests browser geolocation, computes distance to each gym from lat/lng already in the rendered data, re-sorts, and passes distances to cards. denied or unavailable → control stays on the previous sort, no error ui. the gym list is a client component `GymList` that receives the server-ordered array and renders cards; initial html is identical to today's static render.
- nearby cities block: populated places within 25 mi, by distance, up to 6, with counts. at the bottom always; also above the list when the city has fewer than 4 gyms.
- beginner section unchanged.
- json-ld itemlist order follows the rendered default order.

## 2. gym profile + submissions

- trust line under the h1 when data exists: `Listed from the gym's website` (when any price/photo has `verified_by`/`credit = website`) `· prices last verified <date>`. omitted when unknown.
- sidebar cost panel: list of present prices, order trial, drop-in, monthly, each with its verified label. none → "No prices listed yet" + anchor link to the form.
- "Correct this listing" form replaces the "not available" box. fields: `field` select (trial_price, drop_in_price, monthly_price, website, other), `value` text, `note` optional textarea, `email` optional, `website_url` honeypot (hidden, must stay empty), hidden `gym`. plain html form, `method="post" action="/api/submissions"`, works without js.
- nearby gyms: 3 closest by distance, any city, with distance shown, replacing "More gyms in {city}". the discipline-in-city links stay.
- json-ld `priceRange` uses trial when present, else drop-in.

**`POST /api/submissions`** (form-encoded or json):

| check | failure |
|---|---|
| runtime mode is `live` | 503, nothing written |
| honeypot empty | 303 → `/claim?submitted=1` with nothing written, so bots see success |
| `gym` resolves via `gym_cards` (`is_sample=false`) | 303 → `/claim?error=notfound` |
| `field` in allowlist | 303 → `/claim?error=field` |
| price fields: `value` parses to cents in [100, 100000] | 303 → `/claim?error=value` |
| website: `safeExternalUrl(value)` ok | 303 → `/claim?error=value` |
| other: `value` 1–200 chars | 303 → `/claim?error=value` |
| `note` ≤ 1000 chars, `email` optional and shaped like an email | 303 → `/claim?error=value` |
| insert `{entity_type:'gym', entity_id, field, proposed_value:{value, cents?}, note, contact_email, status:'pending'}` via the anon client (rls `submissions_insert_any`) | 303 → `/claim?error=1` on insert error |
| success | 303 → `/claim?submitted=1&gym=<slug>` |

`/claim` shows a thank-you state for `submitted=1` and a short retry message for `error=*`, stays noindex, collects nothing itself. the route never publishes or updates directory tables. body size limit 8 kb.

## 3. homepage

- hero: headline unchanged; large `SiteSearch` replaces the city chips as the primary action; top 8 city chips stay under it as the no-js path.
- coverage line computed: `{gyms} gyms in {places} cities across {states joined}`. never hardcoded.
- featured section: six most complete listings, labeled "most complete listings".
- three explainer boxes rewritten around the two questions: start as a beginner (what the beginner tag means and what to ask), find a real fight gym (fight team tag; fighter records coming), know the price before you go (trial/drop-in/monthly where listed, confirm with the gym). factual, no claims about unlisted data.
- discipline links section unchanged.

## 4. data

**migration `0003_gym_cards_v3.sql`**: `drop view if exists gym_cards; create view gym_cards as ...` with the 0002 column set plus, appended: `tr.amount_cents as trial_cents` (join `gym_current_prices` kind `trial`) and `coalesce(cc.n, 0) as class_count` (lateral count from `classes`). verified on pglite like 0001/0002. `sample.json` and the `GymCard` type gain `trial_cents` and `class_count`.

**new files**: `web/src/lib/geo.ts`, `web/src/lib/format.ts`, `web/src/components/SiteSearch.tsx`, `web/src/components/SortControl.tsx`, `web/src/components/GymList.tsx`, `web/src/app/api/submissions/route.ts`, `web/src/app/api/search-index/route.ts`, `web/src/app/search/page.tsx`, `supabase/migrations/0003_gym_cards_v3.sql`.

**edited**: `GymCard.tsx`, `CityPage.tsx`, `gym/[slug]/page.tsx`, `page.tsx`, `layout.tsx` (header search), `claim/page.tsx` (states), `lib/data.ts` (re-exports, trial/class fields), `lib/types.ts`, `lib/site.ts` (sitemap excludes `/search`), `data/sample.json`.

## errors

reads keep throwing on backend failure (existing policy). the route returns explicit statuses and never turns a failed insert into a thank-you. client components degrade to the server-rendered state when geolocation or fetch fails; they never blank the list.

## tests

- `geo.test.ts`: haversine against two known pairs, nearby radius and limit, nearest gyms excludes self, completeness ordering with ties.
- `components.test.tsx`: card shows `Trial $X` when only trial exists, shows "Prices not listed" and no price boxes when none; card shows `Schedule listed` only when `class_count > 0`; city page coverage line omits zero parts and states the order; profile renders the form with honeypot and hidden gym; home coverage line derived from fixtures.
- `submissions.test.ts`: each row of the validation table, transport stubbed as existing tests do; 503 in unconfigured mode with no request made.
- `search.test.tsx`: match function prefix-before-substring; search page noindex; index route shape.
- `sitemap.test.ts`: `/search` never listed.
- smoke: `/api/submissions` → 503 and `/search?q=x` → noindex on an unconfigured build.
- full check stays green: `npm test && npm run typecheck && npm run lint && npm run build && npm run test:smoke`.

## out of scope

filter pages (`/beginner`, `/drop-in`, `/fighter-gyms`), maps, auth and claims, photo upload, auto-publishing submissions, fuzzy search, tag or price filters in search, mma/bjj.

## assumptions

- coverage numbers above will not change materially before this ships; the design does not depend on them, only the copy examples do.
- vercel's default request limits are enough abuse protection for the route alongside the honeypot; no captcha. revisit if pending submissions show spam.
- `searchParams` on `/claim` and `/search` make those routes dynamic; both are noindex and cheap.

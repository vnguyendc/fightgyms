# Gotchas from the 2026-09 northeast run (NYC, NJ, PA, DMV: 593 sites checked, 199 imported)

## Sources and policy

- Google Places content may not be stored (Places policy: "You must not pre-fetch, cache, or store
  Places API content"). `scrapers/seed_places.py` seeded the first 192 DMV gyms and is legacy. Every
  fact now comes verbatim from the gym's own website; search engines and directories are only leads.
- The auto-mode permission classifier blocks `public_candidates run --apply` (and further prep of the
  same import) as a production change unless the user explicitly says to run the production import in
  chat. Ask before the first apply; never route around a denial.

## Discovery

- WebSearch is capped at 200 calls per Claude Code session, shared by all agents
  (`CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`). Six agents exhausted it within minutes; later regions
  ran on directory fallbacks and came out thin. Split the budget across agents in their prompts
  (for example 25 each) and say so in the brief.
- Directory fallbacks that worked as lead sources: distinguishedteaching.com city pages (robots allow
  all; gym URLs are base64 in the listing), matmade.com, atly.com lists, dojos.info, mmagyms.net
  sitemap, muaythaimap, OpenStreetMap Overpass.
- Yield: about a third of sites checked end valid. Most skips are fitness-kickboxing franchises, BJJ
  or boxing only, robots/403 (Tiger Schulmann's tsk.com is 403 everywhere), dead or hijacked domains.
- Real gyms often guess-named wrong: an agent that guesses a domain and gets "unreachable" should
  search the gym's name, not log robots_or_blocked.

## Evidence format (validator and kit)

- Most gym sites print "518 5th Ave, Brooklyn, NY 11215" with no country. The validator assumes US by
  scope (every region list is US city/state pairs) and accepts a printed state name ("Rockaway, New
  Jersey 07866"; West Virginia is not Virginia). New states need their printed name added to
  `STATE_NAMES` in `scrapers/public_candidates.py` (with a test), and a region list in
  `scrapers/cities/`.
- A location quote may wrap over up to three lines of one address block; other quotes are one line.
- The uncertainty guard splits sentences on . ! ? only, not on line breaks: a heading followed by
  "No experience needed" rejects the heading. "No-Gi" is exempt. WordPress footers ("No Comments")
  and menus ("CLOSED") still block nearby quotes; capture another page.
- Compact JSON-LD used to trip the URL-credential guard; fixed. JSON-LD with Firebase image URLs
  (`?alt=media&token=`) still trips the token guard, so the kit leaves such blocks out of captures.
- Squarespace/GoDaddy put the address in JSON with a literal "\n" ("...Avenue\nThe Bronx"), which
  glues words ("nthe") and fails support. Use the visible address or another page.
- Queens house numbers (37-18) and letter suffixes (34-A) are fine; the kit must not read suite
  numbers ("Ste 3A") or ordinals ("2nd Floor") as house numbers.
- "New York" is a city and a state: without care "78 Reade St New York, NY 10007" was stored as
  "78 Reade St New York". The kit prefers complete (zip) spans.
- Captures are never overwritten: a later capture of the same final URL (for example through a
  redirecting old domain) once replaced valid evidence with an off-host redirect chain.

## Review before import (hold in holds.json)

- Stale sites (old copyright, no recent dates), a directory listing another name or address (moved?),
  two different addresses on one site, "coming soon" locations.
- Kids-only striking, cardio or fitness kickboxing as the only evidence, personal-training sites with
  no facility, a program hosted inside another listed gym at the same address.
- Same-website second locations: the importer imports the first and holds the rest as
  ambiguous_location (by design; about 12 in this run). They need a person, not a retry.
- An agent's out_of_area skip only means outside its own areas; consolidate never lets it override
  another region's proposal.

## Import and after

- The importer writes gyms with the full printed address, no coordinates and no phone. Run
  `enrich.py geocode` right after: without coordinates a gym gets no distance, no nearby gyms, and its
  city no nearby-cities block. The census geocoder handles street-only addresses by appending city
  and state, and retries without suite/unit/floor text, with the state as its code and a comma before
  the city. It matched 173 of 186 in this run; the misses were new developments, route-style
  addresses ("961 NJ-10") and plazas. Leave those without coordinates: never give a gym its city's
  centroid. 40 older google-seeded places also lack coordinates (21 with live city pages); the
  geocoder does not touch them by design.
- `extract_site.py` must be run per `--gym-slug` for imported gyms: its default selection skips gyms
  whose website has a `website` source newer than 30 days, and the importer's provenance row is one.
- Street-only addresses (JSON-LD evidence) show a city only once the web `fullAddress()` helper is
  deployed; deploys go through the Vercel CLI from web/.
- New gym and city routes render on demand; the home page, /gyms/all and the sitemap refresh within
  the hour (ISR).

# Gym discovery brief: region {REGION}

Find real Muay Thai and kickboxing gyms in the areas below, capture each gym's OWN website as
evidence, and log one decision per gym. Never touch the database, git, or files in the repo.

Areas: {AREAS}
States in scope for this run: {STATES}

## Commands (write every command out in full; shell variables do not persist between calls)

    {PY} {KIT} --run {RUN} capture URL
        fetch ONE page of the gym's site (robots.txt honoured, redirects recorded). Prints the capture
        path, address options it can quote, style quotes and links worth capturing next.
    {PY} {KIT} --run {RUN} find CAPTURE_FILE "words"
        exact lines of a capture containing all the words (check address, name, styles).
    {PY} {KIT} --run {RUN} propose --region {REGION} CAP1 [CAP2 ...] --name "Gym Name" --note "short note"
            [--address "123 Main St" --city "Brooklyn" --state NY] [--styles muay_thai,kickboxing]
        builds the candidate from the captures, picks exact quotes, runs the real validator and logs the
        result. "valid" is the goal; "rejected"/"incomplete" are logged too.
    {PY} {KIT} --run {RUN} skip --region {REGION} --name "Gym Name" --url URL --reason REASON [--city C --state ST]

Gyms already in the directory (grep before capturing; skip with reason already_listed): {EXISTING}

## Workflow per area

1. Discover. WebSearch is capped per SESSION and shared by every agent: stay within the search budget
   in your task. Spend it on `muay thai gym <area>` / `kickboxing gym <area>`, then use lead sources
   that need no search: distinguishedteaching.com city pages, matmade.com, atly.com lists, dojos.info,
   mmagyms.net, muaythaimap, an OpenStreetMap Overpass query (sport=muay_thai / kickboxing /
   martial_arts). Yelp, ClassPass, Tapology, Facebook, Instagram, listicles and directories are leads
   only: find the gym's OWN website. Stop an area when leads stop being new.
2. Capture the homepage, or the location-specific page for a multi-location brand. If the hints show
   no `locations`, capture the contact / location / about page from `follow_links`. Max 4 pages per
   gym, all on one website.
3. Propose with `--name` = the gym's proper name as its site prints it (brand only, no taglines).
   Check the printed address, city, state and styles against the page with `find`. If the kit parsed
   them wrong, re-run with `--address/--city/--state` copied exactly as printed. City is the postal
   city in the gym's address ("New York" for Manhattan, "Brooklyn", Queens neighbourhoods such as
   "Astoria", "Jersey City"...). A spelled-out state ("New Jersey") and a missing zip are fine.
4. At most 3 propose attempts per gym, then move on. Never alter quotes or invent values.

## Who belongs

Include: a physical gym, academy or club in the areas whose own site says it teaches Muay Thai and/or
kickboxing as a martial art to adults (classes or programs). MMA and BJJ gyms with a real striking
program count. Styles are only what the site says it teaches (muay_thai, kickboxing,
dutch_kickboxing); if the only "kickboxing" is cardio or fitness kickboxing, pass --styles muay_thai
or skip.

Skip with `skip` and one of these reasons:
- fitness_kickboxing — CKO Kickboxing, 9Round, iLoveKickboxing, Title Boxing Club, UFC GYM, KickHouse,
  cardio kickboxing studios, fitness gyms with a cardio kickboxing class
- not_muay_thai_or_kickboxing — boxing-only, BJJ-only, karate/taekwondo schools without a real adult
  kickboxing or Muay Thai program, kids-only striking
- no_official_site — only Facebook/Instagram/Linktree/directory pages, expired or hijacked domains
- multi_location_no_location_page — one site for several locations and no page specific to one (if
  location pages exist, propose each from its own page and say "multi-location" in --note)
- already_listed, closed, out_of_area, robots_or_blocked, unreachable, js_only_site,
  private_trainer_no_facility

Say in --note anything a reviewer should know: stale site (old copyright, no recent dates), two
different addresses on the site, kids-only or cardio evidence, a directory listing another name or
address, "coming soon".

## Rules

- The kit waits between requests and honours robots.txt. Never work around a robots disallow, a 403 or
  a login wall; skip instead. No more than 4 pages per site.
- Evidence comes only from `capture`. WebFetch/WebSearch summaries are never evidence.
- Do not run scrapers/public_candidates.py, touch any database, edit repo files, use git, or delete
  captures (other agents' leads may cite them).

## Final message

Counts (valid / rejected / incomplete / skipped by last decision per gym), then one line per gym:
`status | name | city, ST | url | note or reason`. Then the new_city values, what you could not cover
and why, and anything a reviewer should check before import.

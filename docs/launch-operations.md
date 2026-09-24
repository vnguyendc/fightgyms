# Launch and discovery operations

## Scope and current gates

Canonical domain: **https://findfightgyms.com**. Product name: FightGyms.

The launch slice does not depend on Jev. It provides safe SEO behavior and a public-source candidate queue/importer. Code checks are not proof of a live deployment or database connection.

- Configure the Vercel project from repository `vnguyendc/fightgyms`, production branch `master`, root directory `web`, using Node 22.
- Set `NEXT_PUBLIC_SITE_URL=https://findfightgyms.com`, `NEXT_PUBLIC_SUPABASE_URL`, and the **public anon** `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Never expose a service-role key to the browser.
- Leave `SHOW_SAMPLE` unset/`0`. Verify the existing schema and public-read RLS with actual data before publishing.
- Attach the purchased domain and verify HTTPS and the preferred apex/www redirect. No DNS or domain change is implied by this document.
- Without a configured real backend, production intentionally shows an unavailable state, noindex, no fictional detail routes, and an empty sitemap. That state is **not an SEO launch**.

See [web checks](../web/tests/README.md) for commands and environment behavior.

## Candidate pipeline

Discovery uses public official gym websites, not copied Google Maps/Places ratings or reviews. Start with `scrapers/cities/dmv.txt` and the public Muay Thai/kickboxing scope. Do not invent prices, schedules, fighters, or credentials. The current importer writes only supported public identity/location/discipline metadata; it does not refresh existing gym fields or run the credential-dependent fact extractor.

```bash
# Repository root; use the project Python 3.12 environment.
.venv/bin/python -m scrapers.public_candidates --help
.venv/bin/python -m scrapers.public_candidates ingest \
  --input /private/candidates.jsonl --queue /private/candidates.sqlite3
.venv/bin/python -m scrapers.public_candidates run \
  --queue /private/candidates.sqlite3
.venv/bin/python -m scrapers.public_candidates status \
  --queue /private/candidates.sqlite3
```

`ingest` writes only the private local queue. `run` is an offline dry-run by default. A production import requires an explicitly authorized apply command and a securely exported `DATABASE_URL`:

```bash
.venv/bin/python -m scrapers.public_candidates run \
  --queue /private/candidates.sqlite3 --apply --max-new 3
```

Do not use `--apply` in unattended discovery until the real database contract has been checked on the intended FightGyms instance. The importer uses short table-locking transactions and requires appropriate Postgres permissions. Existing gyms are preserved; ambiguous matches are held for review rather than overwritten.

## Evidence contract

The CLI help contains the exact JSONL schema. Every candidate must be a reviewed, official, public, single-location source with real fetch timestamps, redirect provenance, and verbatim supporting quotations.

- Each quote must exist in the captured source text and retain the complete assertion context. Never crop away a negation or contrary qualification.
- Location evidence currently requires address, city, state abbreviation, and explicit US/USA/United States in one quote. Official location-specific JSON-LD can provide this evidence. Missing evidence means skip/review, not invent or rewrite a quote.
- Do not include Google reviews, personal testimonials, secret values, private pages, or unrelated source material.
- Excerpts are acceptable only after inspecting the source context; keep the raw capture private for audit. Store no raw corpus in Git.
- Synthetic fixtures remain marked synthetic and cannot publish.
- Evidence expires after 30 days. Queue capacity and per-run caps are enforced; stopped/partial runs are not successful full coverage.

## Recurring discovery contract

Intended first operating mode is **discovery-only**: at most four search queries, eight official-site fetches, and three new candidates per daily run. Honor robots directives and rate limits; skip blocked pages instead of bypassing them. Rotate through the existing DMV city list, retain actual source timestamps, ingest valid candidates, and read back queue status. No database apply, Vercel changes, secret lookup, model-provider changes, or git pushes belong in that job.

A schedule is active only when its exact job record has been created and verified; this document alone does not enable automation.

## Initial SEO work

1. Launch actual sourced gym profiles and populated city/discipline pages; no empty programmatic location inventory.
2. Verify the public homepage, a city page, a gym page, robots.txt, and sitemap.xml after deployment. Confirm canonical URLs, HTTPS, real content, and expected indexing directives.
3. Verify the domain in the owner's Google Search Console account and submit the live sitemap. Search Console access and indexing are separate from Vercel deployment.
4. Measure impressions, indexed pages, search queries, and useful outbound gym-site visits before expanding geography or generating editorial pages.

There is no guarantee of rankings or traffic merely from deploying a sitemap. No Search Console submission, ranking, or traffic result is claimed here.

## Verification and rollback

- Python: `.venv/bin/python -m unittest discover -s scrapers/tests -v`.
- Web: `cd web && npm test && npm run typecheck && npm run lint && npm run build && npm run test:smoke` (smoke expects an unconfigured production build; do not use it as live-data proof).
- A real public Kaizen MMA Fairfax source was captured and accepted into the local queue, then dry-run successfully with zero database inserts. This is candidate-path verification, not confirmation the gym is absent from the existing database or published on the site.
- Stop a discovery schedule through Hermes cron controls. Keep queued evidence for audit; do not delete published rows as a rollback shortcut.

References: [Google scaled-content policy](https://developers.google.com/search/docs/essentials/spam-policies), [Places API policies](https://developers.google.com/maps/documentation/places/web-service/policies).

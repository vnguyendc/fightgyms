# fightgyms — context for Claude Code

Combat sports gym directory. Database/directory SaaS + programmatic SEO play.
Muay thai + kickboxing pages live first; MMA, BJJ stored but gated behind `LIVE_STYLES` in `web/src/lib/types.ts`.
Canonical domain `https://findfightgyms.com`, product name FightGyms (`web/src/lib/site.ts`).

Full playbook (competitors, data sources, schema rationale, pSEO routes, discipline rollout, traffic plan):
https://claude.ai/code/artifact/4dcfe436-3410-4c99-8ea5-fa9f349c611b
Operational gates (Vercel config, credentials, candidate pipeline, SEO verification): `docs/launch-operations.md`.

## layout

- `web/` — Next.js 16 app router (params are Promises; `PageProps<'/route'>` helper), Tailwind v4, `@supabase/supabase-js`. ISR 1h on all directory pages. Read `web/AGENTS.md` and `node_modules/next/dist/docs` before touching Next APIs. `web/src/lib/site.ts` owns `runtimePolicy()` (live / demo / unavailable), `pageMetadata()`, `jsonLd()`, `cityPath()`, sitemap rules. Tests in `web/tests` (see its README).
- `supabase/migrations/0001_init.sql` — schema + RLS + views. `0002_photos.sql` — `gym_photos` + `gym-photos` storage bucket, adds `photo_path` to `gym_cards`. `supabase/seed.sql` — 6 fictional demo gyms flagged `is_sample`.
- `scrapers/` — python 3.12. `seed_places.py` (Google Places → gyms; legacy, review provider terms before reuse), `extract_site.py` (crawl → Claude Haiku structured output → validated prices/classes), `fetch_photos.py` (site images → Haiku vision filter → storage), `public_candidates.py` (reviewed public-source candidate queue/importer, the intended recurring discovery path), `jev_triage.py` (optional shadow triage; never publishes), `run_sql.py` (migrations / one-off sql without psql). Tests: `python -m unittest discover -s scrapers/tests` from the repo root.

## how it runs

- `cd web && npm ci && SHOW_SAMPLE=1 npm run dev` — fictional demo from `web/src/data/sample.json`. Production never serves samples; without a real Supabase config it renders an unavailable, noindex state.
- With Supabase env set, `web/src/lib/data.ts` reads `gym_cards` / `gym_current_prices` / `gym_photos`. Read errors throw (no silent empty listings).
- Scraper env lives in `scrapers/.env` (gitignored; scripts do not auto-load it): `DATABASE_URL` (session pooler, not the IPv6-only direct host), `GOOGLE_PLACES_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (photos upload).
- Full check: `cd web && npm test && npm run typecheck && npm run lint && npm run build && npm run test:smoke` (smoke needs an unconfigured production build). Keep it green.
- Migrations verified against Postgres 16 / PGlite with stubbed `auth` and `storage` schemas; `seed.sql` applies after 0001.

## conventions

- Never delete rows; `is_active=false`. Every scraped fact carries a `source_id` into `sources` (raw payload kept).
- Prices append (one row per verification); schedules replace wholesale per source. `verified_by` tier is shown on the page: manual/phone > gym_claim > website > user_report.
- Never invent prices or data for real gyms. Sample rows are fictional and must stay `is_sample=true` with `sample-` slugs; their photos are generated gradients in `web/public/sample/`.
- Photos: only from the gym's own site (`credit=website`) or uploaded by a verified claimant (`credit=gym_claim`). No Google Places or Instagram images. Google rating fields are stored but never displayed or ranked on.
- Anthropic SDK is 1.x: `temperature` goes in `extra_body`; tools use `strict: True`.
- Style is lowercase/terse in commits and comments; no header scaffolding in docs.

## next (in order)

1. `web/src/app/api/submissions/route.ts` — insert into `submissions` from the `/claim` form; then magic-link auth + `claims`; then photo upload on `/claim` (storage policy for verified claimants already in 0002).
2. `scrapers/enrich_tapology.py` — gym → fighters with records; then `select refresh_gym_fighter_stats()`.
3. Templates: `/gyms/[state]/[city]/drop-in`, `/beginner`, `/fighter-gyms`; `/fighters/[slug]`, `/coaches/[slug]`.
4. Cost-by-city editorial pages backed by `gym_current_prices`.
5. Flip `LIVE_STYLES` to add `mma` (month 2), then `bjj` (month 3–4).

## git

Remote github.com/vnguyendc/fightgyms, default branch `master`. Work lands via PRs. Vercel project `fightgyms` deploys `web/` (currently via CLI, not git integration).

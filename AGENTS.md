# fightgyms — context for Codex

Combat sports gym directory. Database/directory SaaS + programmatic SEO play.
Muay thai + kickboxing pages live first; MMA, BJJ stored but gated behind `LIVE_STYLES` in `web/src/lib/types.ts`.
Placeholder name "FightGyms" — configured in `web/src/lib/site.ts` and env; swap when the domain is decided
(candidates: fightgyms.io, thefightmap.com, wheretofight.com).

Full playbook (competitors, data sources, schema rationale, pSEO routes, discipline rollout, traffic plan):
https://Codex.ai/code/artifact/4dcfe436-3410-4c99-8ea5-fa9f349c611b

## layout

- `web/` — Next.js 16 app router (params are Promises; `PageProps<'/route'>` helper), Tailwind v4, `@supabase/supabase-js`. ISR 1h on all directory pages. Read `web/AGENTS.md` and `node_modules/next/dist/docs` before touching Next APIs.
- `supabase/migrations/0001_init.sql` — schema + RLS + views. `0002_photos.sql` — `gym_photos` + `gym-photos` storage bucket, adds `photo_path` to `gym_cards`. `supabase/seed.sql` — 6 fictional demo gyms flagged `is_sample`.
- `scrapers/` — python 3.11. `seed_places.py` (Google Places → gyms), `extract_site.py` (crawl → Codex Haiku structured output → validated prices/classes), `fetch_photos.py` (site images → Haiku vision filter → storage). Tests in `scrapers/tests`. See `scrapers/README.md`.

## how it runs

- `cd web && npm i && npm run dev` — with no `NEXT_PUBLIC_SUPABASE_URL` it serves `web/src/data/sample.json`.
- With Supabase env set, `web/src/lib/data.ts` reads the `gym_cards` / `gym_current_prices` views.
- Migrations were verified against Postgres 16 / PGlite with stubbed `auth` and `storage` schemas; `seed.sql` applies after 0001.
- `npm run build` prerenders 33 pages from sample data. Keep it green.

## conventions

- Never delete rows; `is_active=false`. Every scraped fact carries a `source_id` into `sources` (raw payload kept).
- Prices append (one row per verification); schedules replace wholesale per source. `verified_by` tier is shown on the page: manual/phone > gym_claim > website > user_report.
- Never invent prices or data for real gyms. Sample rows are fictional and must stay `is_sample=true`; their photos are generated gradients in `web/public/sample/`.
- Photos: only from the gym's own site (`credit=website`) or uploaded by a verified claimant (`credit=gym_claim`). No Google Places or Instagram images.
- Style is lowercase/terse in commits and comments; no header scaffolding in docs.

## next (in order)

1. `web/src/app/api/submissions/route.ts` — insert into `submissions` from the `/claim` form; then magic-link auth + `claims`; then photo upload on `/claim` (storage policy for verified claimants already in 0002).
2. `scrapers/enrich_tapology.py` — gym → fighters with records; then `select refresh_gym_fighter_stats()`.
3. Templates: `/gyms/[state]/[city]/drop-in`, `/beginner`, `/fighter-gyms`; `/fighters/[slug]`, `/coaches/[slug]`.
4. Cost-by-city editorial pages backed by `gym_current_prices`.
5. Run `seed_places.py --cities cities/dmv.txt --dry-run` with a real Places key and review before writing.
6. Flip `LIVE_STYLES` to add `mma` (month 2), then `bjj` (month 3–4).

## git

Repo intended for github.com/vnguyendc/fightgyms (private). First commit is local only; push once the remote exists.

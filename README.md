# fightgyms

combat sports gym directory. muay thai + kickboxing first, mma/bjj behind a flag.
real prices, real schedules, and which gyms actually produce fighters.

```
web/        next.js 16 app router, tailwind v4, supabase-js. ISR pages for pSEO.
supabase/   migrations/0001_init.sql (schema, RLS, views) + seed.sql (fictional demo gyms)
scrapers/   python: google places seed, LLM site extraction. see scrapers/README.md
```

## run it

```
cd web && npm i && npm run dev
```

no env needed — with no `NEXT_PUBLIC_SUPABASE_URL` it serves `web/src/data/sample.json`.

## wire supabase

1. create a project, run `supabase/migrations/0001_init.sql` in the SQL editor (or `supabase db push`)
2. optionally `supabase/seed.sql` for the demo rows (they're flagged `is_sample` and hidden in prod)
3. copy `web/.env.example` → `web/.env.local`, fill the url + anon key
4. `cd scrapers && pip install -r requirements.txt && python seed_places.py --cities cities/dmv.txt --dry-run`

## routes

| route | page |
| --- | --- |
| `/` | home, top fighter gyms, city links |
| `/gyms` | all cities by state |
| `/gyms/[state]/[city]` | city listing, ranked by active fighters |
| `/gyms/[state]/[city]/[style]` | discipline filter (muay-thai, kickboxing; others gated by `LIVE_STYLES`) |
| `/gym/[slug]` | profile: prices w/ verification tier, schedule, coaches, fight team, JSON-LD |
| `/events` | upcoming cards |
| `/claim` | claim / suggest-a-fix form (placeholder, not wired) |
| `/sitemap.xml`, `/robots.txt` | generated |

## next up

- [ ] `/api/submissions` route + magic-link auth for claims
- [ ] `scrapers/enrich_tapology.py` → fighters table
- [ ] `/gyms/[state]/[city]/drop-in`, `/beginner`, `/fighter-gyms` templates
- [ ] `/fighters/[slug]` and `/coaches/[slug]` pages
- [ ] cost-by-city editorial pages backed by the `gym_current_prices` view
- [ ] flip `LIVE_STYLES` to add mma, then bjj (see the playbook doc)

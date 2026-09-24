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
cd web && npm ci && SHOW_SAMPLE=1 npm run dev
```

For an explicitly fictional **local demo**, use `SHOW_SAMPLE=1` as above. Production never falls back to bundled sample data: without a real Supabase configuration it shows an unavailable, noindex state. That is not a live directory launch.

See [launch and discovery operations](docs/launch-operations.md) for the domain, credential gates, public-source pipeline, and SEO verification.

## wire supabase

1. create a project, run `supabase/migrations/0001_init.sql` — no psql needed: `cd scrapers && python run_sql.py ../supabase/migrations/0001_init.sql`
2. optionally `supabase/seed.sql` for the demo rows (they're flagged `is_sample` and hidden in prod)
3. configure `NEXT_PUBLIC_SITE_URL=https://findfightgyms.com`, `NEXT_PUBLIC_SUPABASE_URL`, and the public `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel or a gitignored `web/.env.local`; never expose a service-role key
4. `scrapers/.env` needs `DATABASE_URL` (use the **session pooler**, the direct host is IPv6-only), `GOOGLE_PLACES_KEY`, `ANTHROPIC_API_KEY` — see `scrapers/README.md`
5. use the reviewed public-source candidate workflow in [launch operations](docs/launch-operations.md). The legacy Google Places seed script is not used by the new recurring pipeline; review its provider storage/attribution requirements before using it. Only run the separate fact extractor once its credentials and outputs are verified.

local `next build` caches supabase responses in `.next/cache/fetch-cache` across builds (routes set `revalidate`); `rm -rf web/.next/cache/fetch-cache` when the db changed and the build looks stale. production ISR revalidates hourly.

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

## Jev shadow-triage pilot

The optional Jev pilot evaluates saved public gym-page text and can attach a separate shadow report to the existing scraper. It recommends keeping, reviewing, or rejecting a candidate; **it never changes the extractor's inputs, writes classification decisions to Supabase, or publishes/removes a listing**.

- [Setup, contract, and rollback](docs/jev-shadow-triage.md)
- [Human-labeled evaluation and promotion gate](docs/jev-evaluation.md)
- [Scraper commands](scrapers/README.md)

The default scraper remains unchanged unless the shadow option is explicitly selected. Live evaluation requires a server-side `TYPESAFE_API_KEY`; automated tests use clearly synthetic provider fixtures and do not establish live model accuracy.

## next up

- [ ] `/api/submissions` route + magic-link auth for claims
- [ ] `scrapers/enrich_tapology.py` → fighters table
- [ ] schedules behind mindbody / zenplanner / gymdesk widgets (detected + stored on `sources`, not extracted — needs a headless fetch or the widget's own endpoint)
- [ ] `/gyms/[state]/[city]/drop-in`, `/beginner`, `/fighter-gyms` templates
- [ ] `/fighters/[slug]` and `/coaches/[slug]` pages
- [ ] cost-by-city editorial pages backed by the `gym_current_prices` view
- [ ] flip `LIVE_STYLES` to add mma, then bjj (see the playbook doc)

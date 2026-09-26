# Web launch checks

Run from `web/` using Node 22 (the CI version):

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm run test:smoke
```

The smoke command starts/stops a local production server on port 3108 (`SMOKE_PORT` overrides it). It requires an **unconfigured production build**: unset both Supabase variables before building and running it. It checks actual HTTP HTML, status codes, canonicals, noindex, robots and sitemap. Unit/render tests use clearly labeled fixtures and stub only Supabase's HTTP transport; they never access or write an external database.

## Production environment

- `NEXT_PUBLIC_SITE_URL=https://findfightgyms.com` (also the default). Overrides must be HTTPS origins without credentials, path, query or fragment. Local HTTP is accepted only in development. Invalid overrides fail the build rather than publishing bad canonicals.
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` must both be configured. Use the public anonymous key with the existing public-read schema/RLS, **not** a service-role key. Configuration alone is not proof of database reachability or correct RLS.
- Leave `SHOW_SAMPLE` unset or `0`. Production never serves bundled samples, even with `SHOW_SAMPLE=1`; that flag also disables indexing.
- Vercel sets `VERCEL_ENV`: only `production` (or unset for self-hosted production) is eligible for indexing. Preview/development and explicit non-production demo mode are always noindex and have an empty sitemap.
- `SHOW_SAMPLE=1` opts non-production environments into a clearly labeled, fictional demo instead of a live backend. No demo URLs enter the sitemap.
- Analytics and monitoring need no environment variables. `@vercel/analytics` and `@vercel/speed-insights` are mounted in the root layout and only send data when the Vercel project has **Web Analytics** and **Speed Insights** switched on (Project → Analytics / Speed Insights → Enable); off Vercel they are inert. Server errors are written by `src/instrumentation.ts` as one JSON line (`"event":"request_error"`, with `digest`, `route`, `path` without query, no headers) to stderr, which Vercel keeps in Runtime Logs / Observability. The route error boundary shows the same `digest` as `Reference …` so a user report can be matched to that line. `POST /api/submissions` records a `correction_submitted` custom event (field name only) after a successful insert.
- Redeploy after environment changes. Pages/sitemap use the existing one-hour revalidation period. A missing-config build is intentionally safe to preview but **not an SEO launch**: noindex, empty sitemap, visible unavailable state, fictional detail routes return 404.

## Data contract / publishing

Reads use `gym_cards` (migration 0003 adds `trial_cents` and `class_count`; rows without them render as missing data, not errors), `places`, `gyms`, `gym_current_prices`, `classes`, `coaches`, `fighters`, `events`. The only write path is `POST /api/submissions`, which inserts `status='pending'` rows into `submissions` through the anon key, never updates directory tables, and returns 503 outside the live directory. Migration 0004 makes the row-level policy enforce the same limits, since the anon key is public and the route is not a security boundary. Keep `LIVE_STYLES` at `muay_thai` and `kickboxing`.

Publish real active gym rows with `is_sample=false`, stable slugs, public discipline(s), and matching place records. Reserve the `sample-` slug prefix for fictional fixtures. Existing event seeds have no `is_sample` column, so `sample-*` event slugs are explicitly excluded. Do not put fictional events under ordinary slugs. Google rating fields remain stored but are not displayed, ranked on, or emitted as aggregate ratings.

City/style URLs must contain at least one matching gym; missing/empty routes return 404. `/events` is noindex and excluded from the sitemap when empty. `/claim` is always noindex and collects nothing itself; it only shows the thank-you and error states for corrections filed from a gym page. `/search` and `/api/search-index` expose gym and city names only; `/search` is noindex and never in the sitemap. Backend read errors throw instead of becoming empty successful listings; the error boundary has a noindex retry state. Build-time read failures deliberately fail a configured build.

## Verification record

Baseline: `npm ci` succeeded; lint had three existing unescaped-apostrophe errors; `npm run build` succeeded but generated fictional sample routes. Those lint issues are fixed.

The implementation was exercised RED → GREEN for canonical/environment policy, missing backend fallback, failed Supabase reads, sample filtering, Google-review ordering, escaping, metadata, populated sitemap rules, unavailable claims and exact prices. The suite currently has 19 passing tests. Tests/typecheck/lint/build and local production HTTP smoke checks pass on both the host runtime and Node 22. No authenticated Supabase/Vercel configuration was available, so **real data, production deployment, Search Console and remote CI have not been verified**.

Guidance: [Google spam policies](https://developers.google.com/search/docs/essentials/spam-policies), [LocalBusiness structured data](https://developers.google.com/search/docs/appearance/structured-data/local-business). Keep pages useful and factual; do not turn sparse data into generic claims or copied review-rich-result markup.

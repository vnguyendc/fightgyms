# Web launch checks

Run from `web/` using Node 24 (`engines.node`, which CI and Vercel both use):

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm run test:smoke
```

The smoke command starts/stops a local production server on port 3108 (`SMOKE_PORT` overrides it). It requires an **unconfigured production build**: unset both Supabase variables before building and running it. A `web/.env.local` is loaded by `next build` even when the variables are unset in the shell, so with one present set them to empty strings instead: `NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= npm run build && NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= npm run test:smoke`. It checks actual HTTP HTML, status codes, canonicals, noindex, robots and sitemap. Unit/render tests use clearly labeled fixtures and stub only Supabase's HTTP transport; they never access or write an external database.

## Production environment

- `NEXT_PUBLIC_SITE_URL=https://www.findfightgyms.com` in production (the apex 308s to www; the code default is the apex, so set this explicitly). Overrides must be HTTPS origins without credentials, path, query or fragment. Local HTTP is accepted only in development. Invalid overrides fail the build rather than publishing bad canonicals.
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` must both be configured. Use the public anonymous key with the existing public-read schema/RLS, **not** a service-role key. Configuration alone is not proof of database reachability or correct RLS.
- Leave `SHOW_SAMPLE` unset or `0`. Production never serves bundled samples, even with `SHOW_SAMPLE=1`; that flag also disables indexing.
- Vercel sets `VERCEL_ENV`: only `production` (or unset for self-hosted production) is eligible for indexing. Preview/development and explicit non-production demo mode are always noindex and have an empty sitemap.
- `SHOW_SAMPLE=1` opts non-production environments into a clearly labeled, fictional demo instead of a live backend. No demo URLs enter the sitemap.
- Analytics and monitoring need no environment variables. `@vercel/analytics` and `@vercel/speed-insights` are mounted in the root layout and only send data when the Vercel project has **Web Analytics** and **Speed Insights** switched on (Project → Analytics / Speed Insights → Enable); off Vercel they are inert. Server errors are written by `src/instrumentation.ts` as one JSON line (`"event":"request_error"`, with `digest`, `route`, `path` without query, no headers) to stderr, which Vercel keeps in Runtime Logs / Observability. The route error boundary shows the same `digest` as `Reference …` so a user report can be matched to that line. `POST /api/owner-edit` records `owner_edit_published` after a successful edit (price-field count only); `correction_submitted` is retired.
- Redeploy after environment changes. Pages/sitemap use the existing one-hour revalidation period. A missing-config build is intentionally safe to preview but **not an SEO launch**: noindex, empty sitemap, visible unavailable state, fictional detail routes return 404.

## Data contract / publishing

Reads use `gym_cards` (migration 0003 adds `trial_cents` and `class_count`; rows without them render as missing data, not errors), `places`, `gyms`, `gym_current_prices`, `classes`, `coaches`, `fighters`, `events`, `gym_photos`, `gym_socials`. `POST /api/claims` and `/api/submissions/gym` insert pending rows as the signed-in user. `POST /api/owner-edit` publishes listing details and trial/drop-in/monthly prices through migration 0007's authenticated-only `edit_owned_gym` RPC. It locks the exact verified claim, revalidates bounded data, derives attribution and writes an append-only audit plus price sources atomically. `POST /api/submissions` returns 410; the database denies new corrections even through the public Data API. Historical submissions/read views remain. Apply migrations 0001–0007 **before deploying the UI**, with no broad gym UPDATE policy and no service-role key in the app. Sign-in uses Supabase magic links and httpOnly sessions (`src/proxy.ts` refreshes `/claim`). Active write handlers return 503 outside the live directory. Keep `LIVE_STYLES` at `muay_thai` and `kickboxing`.

`migrations.test.ts` retains 0001–0006 regression coverage; `owner-edits-db.test.ts` exercises the complete 0001–0007 chain and retirement over existing submissions in PGlite with Supabase auth/storage schemas stubbed. It covers immediate public data/profile propagation, same-day price ordering, withdrawal, exact-claim authorization, revocation, forged fields, direct SQL/RPC access, database attribution, immutable audit, and rollback when the audit insert fails. Route and render tests cover CSRF, byte bounds, session checks, strict parsing, cache invalidation, editor visibility and retirement. These local checks do not verify hosted Supabase, multiple-connection lock scheduling, browser email delivery or a production deployment.

Publish real active gym rows with `is_sample=false`, stable slugs, public discipline(s), and matching place records. Reserve the `sample-` slug prefix for fictional fixtures. Existing event seeds have no `is_sample` column, so `sample-*` event slugs are explicitly excluded. Do not put fictional events under ordinary slugs. Google rating fields remain stored but are not displayed, ranked on, or emitted as aggregate ratings.

City/style URLs must contain at least one matching gym; missing/empty routes return 404. `/events` is noindex and excluded from the sitemap when empty. `/claim` is always noindex and provides sign-in, claims, verified-owner editing, own submission history, and new-gym submission. `/search` and `/api/search-index` expose gym and city names only; `/search` is noindex and never in the sitemap. Backend read errors throw instead of becoming empty successful listings; the error boundary has a noindex retry state. Build-time read failures deliberately fail a configured build.

## Verification record

Baseline: `npm ci` succeeded; lint had three existing unescaped-apostrophe errors; `npm run build` succeeded but generated fictional sample routes. Those lint issues are fixed.

2026-10-07: the preserved auth fix plus owner editing/correction retirement pass all **112 tests**, `npm run typecheck`, `npm run lint`, an unconfigured production `npm run build`, and `npm run test:smoke` on **Node 24.18.0**. The final build and smoke were repeated after the last route change. Focused RED → GREEN runs used Node 26.8.1; the final owner-route suite also passes on Node 24.18.0. Negative auth tests intentionally exercise invalid-cookie and revoked-refresh warnings.

Run each focused suite from `web/` with `node --import tsx --test tests/<file>`:

| File | observed RED | final GREEN |
| --- | --- | --- |
| `owner-edits-db.test.ts` | missing RPC (4 failures); retirement insert unexpectedly accepted; address edit retained stale coordinates | 6 tests pass, including actual public loader/profile rendering over PGlite |
| `owner-edits.test.ts` | missing parser/route (3 failures); cache failure threw after commit; error responses lost refreshed cookies | 5 tests pass |
| `owner-editor.test.tsx` | verified owner had no editor; delayed refresh did not display its saved-state limitation | 3 tests pass |
| `retired-corrections.test.tsx` | old endpoint returned 503 instead of 410; correction copy and form remained (3 failures) | 3 tests pass |

Claim, new-gym, public rendering, streamed body limits, analytics documentation and smoke expectations were updated with the retirement. The original auth tests remain in the full suite, including canonical redirect before consuming the one-use token. No hosted migration, email, production mutation, deployment, push or PR was performed. Hosted Supabase/browser end-to-end behavior and multi-connection lock timing remain unverified; concurrent complete-form saves use the last serialized write, with every edit audited.

Guidance: [Google spam policies](https://developers.google.com/search/docs/essentials/spam-policies), [LocalBusiness structured data](https://developers.google.com/search/docs/appearance/structured-data/local-business). Keep pages useful and factual; do not turn sparse data into generic claims or copied review-rich-result markup.

# scrapers

python 3.12. `python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt`

env — put these in `scrapers/.env` (gitignored) and load with `set -a; source .env; set +a`:
- `DATABASE_URL` — supabase postgres. use the **session pooler** (`postgres.<ref>@aws-0-<region>.pooler.supabase.com:5432`); the direct `db.<ref>.supabase.co` host is IPv6-only and unreachable from most home networks. session mode (port 5432, not 6543) is fine for `refresh materialized view concurrently`.
- `GOOGLE_PLACES_KEY` — Places API (New) enabled
- `ANTHROPIC_API_KEY` — for extract_site.py and fetch_photos.py
- `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` — fetch_photos.py uploads to the `gym-photos` storage bucket (service role; never ships to the browser)

order:
1. `python -m scrapers.public_candidates` (from the repo root; see [launch operations](../docs/launch-operations.md)) — reviewed official-site evidence → new gyms, scoped by the region lists in `cities/*.txt`. `seed_places.py --cities cities/dmv.txt` is the legacy google seeder: Places content may not be stored, so review provider terms before reuse.
1b. `python geocode_census.py` — lat/lng for gyms that have none (census bureau geocoder, public domain); `--dry-run` prints matches.
2. `python extract_site.py --limit 50` — crawls each gym site, extracts prices/schedule/coaches
2b. `python fetch_photos.py --limit 50` — homepage + gallery images, vision-filtered, into storage; the same pages' instagram / facebook / tiktok / youtube / x profile links go to `gym_socials` (one per platform, existing link kept). `--socials-only` skips images (no model, no storage). `--url https://...` dry-runs any site
3. `python enrich_tapology.py` — (todo) fighter records → fighters table
4. `python run_sql.py -c "select refresh_gym_fighter_stats()"` — no psql needed; `run_sql.py <file.sql>` also applies migrations

always run with `--dry-run` on a new city first and eyeball the output.

## Optional Jev shadow triage

Jev classifies public gym-page evidence separately from the existing fact extractor. It never filters extraction inputs or publishes, changes, or deletes a gym listing. Full setup and limitations: [shadow-triage runbook](../docs/jev-shadow-triage.md). Promotion criteria: [evaluation plan](../docs/jev-evaluation.md).

From the repository root, create the Python 3.12 environment and install `scrapers/requirements.txt` as described in the runbook. Set `TYPESAFE_API_KEY` securely in the process environment; `TYPESAFE_MODEL` optionally overrides the pinned `jev-1.13.0` default. `.env.example` contains placeholders only and is not automatically loaded by these scripts.

### Saved public-page corpora (no database or Anthropic required)

```bash
mkdir -p scrapers/reports
.venv/bin/python scrapers/jev_triage.py \
  --input scrapers/corpora/public-corpora.jsonl \
  --report scrapers/reports/jev-shadow.jsonl \
  --limit 10
```

Each input line is a JSON object with `public_content: true` and `pages: [{"url": "https://...", "text": "..."}]`. The public-content marker is your attestation, not an automatic privacy check. Never submit private data or credentials. This command reads saved text; it does not crawl the submitted URLs.

The report is append-only JSONL. Missing credentials, invalid input, and provider failures yield `not_evaluated` / `review_candidate` entries and a nonzero standalone exit status. They are not successful classifications.

### Alongside the existing scraper

```bash
.venv/bin/python scrapers/extract_site.py \
  --gym-slug YOUR_EXISTING_GYM_SLUG \
  --dry-run \
  --shadow-report scrapers/reports/jev-shadow.jsonl
```

This still uses the existing scraper's database read and Anthropic API; `--dry-run` prevents database writes, not network calls or model costs. The shadow report is optional and cannot change what the existing extractor sees or writes. Omit `--shadow-report` to disable Jev completely.

### Offline verification

```bash
.venv/bin/python -m unittest discover -s scrapers/tests -v
```

Provider responses in tests are deliberately synthetic. Passing tests verifies the adapter, policy, guards, and integration behavior; it does not verify Jev accuracy. See the runbook for the actual credential-preflight result and the PR for independent review and CI results.

## Review website prices and schedules without publishing

From the repository root (Python 3.12):

```bash
.venv/bin/python -m scrapers.audit_sites \
  --manifest /private/path/gyms.json \
  --run-dir /private/path/website-audit
```

The manifest is a JSON array or JSONL with unique `slug`, `name`, `city`, `state`,
`website`; optional `research_website` takes precedence. Unrelated fields such as
email contacts are discarded. Missing sites stay visible in coverage. Collection
requires neither a database nor an AI key. Run files must live outside the repo.
The command never imports the DB adapter and has no apply mode.

Explicit paid extraction (only with spending authority):

```bash
.venv/bin/python -m scrapers.audit_sites \
  --manifest /private/path/gyms.json --run-dir /private/path/website-audit \
  --extract --budget-usd 10
```

Set `ANTHROPIC_API_KEY` securely; do not print or commit it. The fixed first-party
Haiku 4.5 model uses $1/$5 per million input/output tokens, verified against
[provider pricing](https://platform.claude.com/docs/en/about-claude/pricing) on
2026-11-02. Recheck pricing before later runs. A changed model requires a reviewed
rate update. No cache, batch, server tool or regional pricing is requested.
The count-token API rejects overly large inputs; the ledger reserves the full
200k-token context bound of this pinned model plus the full output limit before
each request (at least $0.24096). Unknown outcomes
retain that reservation; automatic SDK retries are disabled. A returned usage
above the reservation stops the paid run. This is a conservative operational cap,
not an external billing-account spending limit. `usage.json` includes all calls
in this run directory; do not start a second run to evade its ceiling.

`--only slug-a,slug-b` selects a pilot while the entire manifest stays in coverage.
Resume with the same run directory; collected responses and identical model/prompt
inputs are cached. For a deliberate refresh use a new run directory and a newly
allocated budget that accounts for prior spending. The run lock prevents
concurrent commands in one directory. No private email evidence is accepted by
this public-site workflow.

HTTP collection uses link labels and paths, including FAQs, and retains queries.
Fragments/widgets become targeted browser tasks instead of being treated as new
HTTP pages. Public linked PDF/image files are sent as document/image evidence
only during paid extraction. Image/PDF facts are always held for visual review.
Output is conservative: candidate facts still need semantic source review; a
matching quote does not certify audience, plan eligibility, location or schedule
completeness. Never feed these CSVs into the phone-only price importer.

For dynamic pages use supported browser tooling to read the visible public site,
including site-linked frames/tabs as needed; then save a capture array:

```json
[{
  "gym_slug": "synthetic-example-gym",
  "public_content": true,
  "url": "https://example.org/schedule",
  "parent_url": "https://example.org/",
  "captured_at": "2026-11-02T12:00:00Z",
  "text": "Captured visible public text, including schedule headings",
  "label": "rendered public schedule"
}]
```

Pass `--captures /private/path/captures.json` on resume. Capture provenance must
be attested by the selected gym's collected page/fallback links (or its official
homepage); at most two rendered captures per gym per import. Capture attestation
is operator-controlled: never label authenticated/private content public. Save
screenshots separately for visual audit. No login, CAPTCHA bypass, signup,
booking or form submission. If a browser page cannot expose the information,
leave an explicit coverage gap. No standalone browser automation is installed.

Outputs: `prices.csv`, `classes.csv`, `facts.jsonl`, `held.jsonl`, `evidence.jsonl`,
`coverage.jsonl`, `report.md`, `summary.json`, original response bytes, source
bundles and cost ledger. All facts retain their billing intervals and source IDs;
unknown/contradictory facts remain held. Schedules are never replaced by this
command. Dates, timezone and recurrence must not be inferred from business hours.

Limits: 12 HTML pages, 30 network attempts including robots/redirects, 180 seconds
per gym, 20 seconds/request, 5 redirect hops, 10 MB/response, 5 relevant linked
assets, 200k text characters per gym, 70k model input tokens, 8192 output tokens.
The local HTTP fetcher checks public DNS answers before each hop, pins the
validated public address at connection time while preserving Host/TLS SNI and
certificate verification, disables cross-host connection reuse and environment
proxies. It is not a public arbitrary-URL service and should not be deployed as one.
Robots denial, missing content, timeouts, clipping, unsupported widgets and model
errors are reported separately from successful empty extraction. A coverage flag
never proves that pricing is unpublished.

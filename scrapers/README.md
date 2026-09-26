# scrapers

python 3.12. `python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt`

env — put these in `scrapers/.env` (gitignored) and load with `set -a; source .env; set +a`:
- `DATABASE_URL` — supabase postgres. use the **session pooler** (`postgres.<ref>@aws-0-<region>.pooler.supabase.com:5432`); the direct `db.<ref>.supabase.co` host is IPv6-only and unreachable from most home networks. session mode (port 5432, not 6543) is fine for `refresh materialized view concurrently`.
- `GOOGLE_PLACES_KEY` — Places API (New) enabled
- `ANTHROPIC_API_KEY` — for extract_site.py and fetch_photos.py
- `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` — fetch_photos.py uploads to the `gym-photos` storage bucket (service role; never ships to the browser)

order:
1. `python seed_places.py --cities cities/dmv.txt` — seeds gyms + places from google. city/state come from each result's address components, not the search city (text search for "X in Arlington" returns half of NoVA).
2. `python extract_site.py --limit 50` — crawls each gym site, extracts prices/schedule/coaches
2b. `python fetch_photos.py --limit 50` — homepage + gallery images, vision-filtered, into storage. `--url https://...` dry-runs any site
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

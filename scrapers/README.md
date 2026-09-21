# scrapers

python 3.12. `python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt`

env — put these in `scrapers/.env` (gitignored) and load with `set -a; source .env; set +a`:
- `DATABASE_URL` — supabase postgres. use the **session pooler** (`postgres.<ref>@aws-0-<region>.pooler.supabase.com:5432`); the direct `db.<ref>.supabase.co` host is IPv6-only and unreachable from most home networks. session mode (port 5432, not 6543) is fine for `refresh materialized view concurrently`.
- `GOOGLE_PLACES_KEY` — Places API (New) enabled
- `ANTHROPIC_API_KEY` — for extract_site.py

order:
1. `python seed_places.py --cities cities/dmv.txt` — seeds gyms + places from google. city/state come from each result's address components, not the search city (text search for "X in Arlington" returns half of NoVA).
2. `python extract_site.py --limit 50` — crawls each gym site, extracts prices/schedule/coaches
3. `python enrich_tapology.py` — (todo) fighter records → fighters table
4. `python run_sql.py -c "select refresh_gym_fighter_stats()"` — no psql needed; `run_sql.py <file.sql>` also applies migrations

always run with `--dry-run` on a new city first and eyeball the output.

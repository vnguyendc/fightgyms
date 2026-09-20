# scrapers

python 3.11+. `pip install -r requirements.txt`

env:
- `DATABASE_URL` — supabase postgres connection string (use the *direct* one, port 5432, not the pooler, for `refresh materialized view concurrently`)
- `GOOGLE_PLACES_KEY` — Places API (New) enabled
- `ANTHROPIC_API_KEY` — for extract_site.py

order:
1. `python seed_places.py --cities cities/dmv.txt` — seeds gyms + places from google
2. `python extract_site.py --limit 50` — crawls each gym site, extracts prices/schedule/coaches
3. `python enrich_tapology.py` — (todo) fighter records → fighters table
4. `psql "$DATABASE_URL" -c "select refresh_gym_fighter_stats()"`

always run with `--dry-run` on a new city first and eyeball the output.

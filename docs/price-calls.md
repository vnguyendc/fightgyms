# phone price sprint

Use the scraper Python environment with `scrapers/requirements.txt` installed (see `scrapers/README.md`); from the repository root the existing Mac environment is `scrapers/.venv/bin/python`. The commands below assume that environment is active.

Export a real DMV call sheet with `python scrapers/manual_prices.py --export-calls /private/tmp/dmv-calls.csv` after setting `DATABASE_URL` using the existing local environment. The database transaction is read-only and the output path must not already exist. The call sheet contains public gym name/location/phone/website with blank status and notes fields. Keep filled call sheets and price CSVs outside Git.

Ask whether the gym currently offers Muay Thai or kickboxing, the monthly membership and commitment, drop-in fee, any free/paid trial, and where to confirm its schedule. Note verification date and any membership restrictions or signup fees. Invite the gym to claim its listing at its existing FightGyms gym-page link; do not mark claims verified yourself. No answer means leave the price absent, never $0. A free trial is a `trial` row at `0`. This tool records prices only; it doesn't create gyms or change schedules.

Create a UTF-8 CSV with exactly these headers:

```csv
gym_slug,kind,amount_dollars,verified_at,notes
```

One row per confirmed price: `monthly`, `drop_in`, or `trial`; USD dollars with at most two decimals; actual ISO verification date; quote notes containing conditions. Use exact slugs from the call sheet. Never place fictional examples into an import file. An empty CSV and unknown, inactive or sample gyms are rejected. Duplicate gym/kind/date rows are rejected. Update one verified fact at a time; this is append-only, not a replacement of historical prices.

`python scrapers/manual_prices.py /private/tmp/verified-prices.csv` defaults to a read-only dry run. Check the target, match count and pending-price count. Applying real prices requires authorization for those actual facts and database: `python scrapers/manual_prices.py /private/tmp/verified-prices.csv --apply`. The whole file validates before any write; sources and prices commit together. Every new fact gets a `manual` source with its normalized payload, SHA-256 fingerprint and `verified_by='phone'`. Identical reimports skip; changed price/date/notes produce new facts. Concurrent imports are serialized. Never include caller names, private contact details, credentials or unrelated notes.

Local tests: `python -m unittest discover -s scrapers/tests`. The PGlite integration test in `web/tests/manual-prices.test.ts` executes the import SQL twice and checks append/provenance/rollback against the migration chain. No production import is performed by the tests.

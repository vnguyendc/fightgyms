# Jev shadow-triage pilot

Status: implemented and locally tested; opt-in only and not enabled in production. Live model validation requires a TypeSafe API key. Do not interpret a local test fixture as model output.

## Decision

Add a bounded, opt-in Jev evaluation alongside the existing Python website extraction pipeline. The first release produces **recommendations only**. It must not reject scraper inputs, change extracted facts, write classification results into Supabase, or publish/delete listings.

This is a gym-corpus triage pilot: the model sees a bounded subset of already-fetched public website pages for one candidate gym. Per-page filtering and automatic enforcement are explicitly deferred.

## Questions

Ask small independent questions using the TypeSafe typed API:

- Does the supplied content establish a combat-sports gym rather than a retailer, event, editorial page, or unrelated fitness business?
- Is the content specific to one location, chain-wide, or unclear?
- Which supported disciplines are explicitly evidenced? Missing evidence is unknown, not a fabricated offering.
- Is there enough evidence to review this candidate for the directory?

Combine answers using deterministic policy into `keep_candidate`, `review_candidate`, or `reject_candidate` recommendations. None is an authorization. Unknowns, truncated input, malformed responses, and provider failures route to review/not-evaluated rather than silent rejection. Scores and thresholds are provisional until evaluated on labeled FightGyms examples.

## Acceptance contract

1. Disabled by default: the existing extraction/write path behaves identically without the explicit shadow-report option.
2. An offline-input command accepts saved public-page corpora and produces a versioned JSONL report without requiring database or Anthropic credentials and without fetching submitted URLs.
3. The existing scraper can emit the same report after crawling, without changing its extraction inputs, validated outputs, or database writes.
4. The client uses the documented `POST https://api.typesafe.ai/v1/systemone` endpoint and bearer authentication. Default model is pinned to `jev-1.13.0`, with an explicit override and resolved-model reporting.
5. Input size, number of records, network timeouts, and retries are bounded. Reports include input hash, rubric/policy version, timestamp, source URLs, truncation state, response model, latency, usage where available, recommendation, and machine-readable reasons.
6. Validate provider answer types, enum membership, finite probabilities in range, required fields, and probability distributions. Missing or invalid responses never become accepted decisions.
7. Public URLs only; do not send credentials, authenticated URLs, private documents, patient information, or secrets. Treat source text as untrusted data, never as instructions. Reports do not contain raw page text, API keys, or provider error bodies. The scraper hook must retain redirect/final-source provenance separately from the unchanged extraction inputs, and refuse shadow evaluation when provenance is missing or any hop is unsafe. These checks are not general crawler SSRF or DNS-rebinding protection.
8. Unit, HTTP-boundary, CLI, and scraper-integration tests prove disabled mode, success, uncertainty, malformed output, HTTP errors, timeouts, missing credentials, truncation, and no publishing authority.
9. A fixture-based test demonstrates the feature gap before implementation. Integration tests prove shadow recommendations never gate or alter the existing extractor, including a reject recommendation.
10. Setup, commands, evaluation criteria, rollout, and rollback are documented. No claim of live accuracy, savings, or production activation without observed evidence.

## Setup and use

Run from the repository root. Python 3.12 is the documented scraper environment.

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r scrapers/requirements.txt
.venv/bin/python -m unittest discover -s scrapers/tests -v
```

Provision `TYPESAFE_API_KEY` in the process environment through your secret manager or a gitignored local environment file. Never put the key in command arguments, commit it, or paste it into a chat. This integration is server-side only; do not use a `NEXT_PUBLIC_` variable. `TYPESAFE_MODEL` can override the pinned default, but record a new evaluation when changing models.

### Saved public-page input

The standalone command accepts JSONL, one gym corpus per line:

```json
{"public_content":true,"pages":[{"url":"https://synthetic-gym.example/classes","text":"SYNTHETIC EXAMPLE ONLY: fictional gym offering boxing classes at one location."}]}
```

This is a synthetic schema example, not a real gym or a Jev result. The `public_content` flag is an operator attestation, not proof that a file is safe: inspect every corpus before submitting it to a third-party provider. Do not submit scraped account pages, authenticated URLs, private documents, or secrets. The command does not fetch page URLs, connect to Supabase, or invoke Anthropic.

```bash
mkdir -p scrapers/reports
.venv/bin/python scrapers/jev_triage.py \
  --input scrapers/corpora/public-corpora.jsonl \
  --report scrapers/reports/jev-shadow.jsonl \
  --limit 10
```

Use a new report path for a new evaluation run. Reports append records; count attempted/evaluated/error rows rather than assuming a command invocation produced a clean benchmark. Missing credentials or failed evaluations produce honest `not_evaluated` results and a nonzero standalone exit status, not invented answers.

### Operational bounds and exit codes

- At most six pages and 20,000 characters of canonical serialized state are sent per evaluation. Any omission/truncation forces a review recommendation.
- Standalone `--limit` accepts 1–10 records, default 10. If input remains after the cap, the command reports `record_limit_reached` and exits `2`; it does not imply that the whole file was processed.
- Input lines are bounded at 2 MB and provider responses at 64 KiB. The HTTP client uses 15-second per-operation timeouts, no retries, no redirects, and no environment proxy configuration. This is not an overall wall-clock deadline.
- Exit `0`: all processed records evaluated. Exit `1`: at least one record was not evaluated. Exit `2`: configuration/file/empty-input error, unprocessed input remains after the record cap, or an oversized line aborts the batch. Inspect the report and stderr reason codes.
- An oversized line produces `batch_aborted: true`, `remaining_input_unchecked: true`, and `record_limit_reached: null`; stderr is `batch_aborted_input_too_large`. The command does not drain or inspect the remaining stream, so it makes no claim about whether additional records exist. Normal CLI rows set both batch flags to `false`.
- Invalid model configuration is rejected before opening the input/report or processing any record, with exit `2` and stderr `invalid_model`.
- `--model` overrides `TYPESAFE_MODEL`; only version-shaped `jev-X.Y.Z` names are accepted, not moving aliases. The API still needs to support that version.
- `input_hash` is SHA-256 of the exact bounded canonical `{"pages": [...]}` state. `source_urls` lists the included pages, not every original page. Invalid input may have no hash or URLs, to avoid leaking rejected material.
- Input validation and sensitive-content detection are heuristic guardrails, not proof of privacy or a general PII detector. The operator must review public-source eligibility.

### Existing scraper

Use the optional shadow-report argument described in [the scraper README](../scrapers/README.md). The ordinary scraper still requires its existing database and Anthropic credentials. Its `--dry-run` means **no database writes**, not **no network calls or model charges**. A Jev recommendation must not influence which pages reach the existing extractor or which validated facts it writes.

### Reading recommendations

- `keep_candidate`: evidence appears suitable for further review/extraction; not permission to publish.
- `review_candidate`: uncertainty, incomplete or truncated input, chain-wide scope, missing discipline evidence, or an evaluation problem.
- `reject_candidate`: strong explicit evidence of an unrelated business/content type; still only a recommendation.

The report records both the selected option's probability and the provider's separate distribution-derived confidence. Do not interpret confidence as measured FightGyms accuracy. Missing evidence of a discipline is not a claim it is absent from the gym.

## Rollout gate

Start with saved public-page corpora and an explicit small record limit. In shadow mode, compare recommendations against independent human labels, recording false rejects, false keeps, review coverage, latency, and token usage. Report denominators and errors. Do not count deterministic tests or synthetic fixtures as a live benchmark.

Automatic filtering needs a separately reviewed change and explicit authorization after calibration on representative pages. No website UI, schema migration, cron job, production database run, or DNS/domain purchase is part of this pilot.

## Rollback

Omit the shadow-report option to return to the original scraper behavior. The standalone command does not change the database. Delete or archive local report files according to project retention needs; no database rollback is required.

## Verification record

On 2026-09-23, the standalone command was exercised on a real public-page capture from `https://attpdx.com` with no TypeSafe key. It exited with status `1` and emitted `status: not_evaluated`, `recommendation: review_candidate`, and `reasons: [missing_api_key]`. The report contained no answers or claimed response model. This verifies the credential-failure path only: **it is not a live Jev inference or a classification benchmark**.

Automated-test and independent-review results are recorded in the pull request. No production database was used for the pilot verification.

## API references

- https://docs.typesafe.ai/api — endpoint and typed request/response contract
- https://docs.typesafe.ai/models — model versions, limits, aliases, and data handling
- https://docs.typesafe.ai/confidence — interpreting model confidence

The vendor documents zero-data-retention as an enterprise feature; do not assume it applies to this account. Only explicitly public website content is in scope.

"""Bounded public-source candidate ingestion. Run with --help for the contract."""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from contextlib import contextmanager
import hashlib
import json
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

MAX_QUEUE = 500
STYLES = {"muay_thai": "muay thai", "kickboxing": "kickboxing", "dutch_kickboxing": "dutch kickboxing"}
FIELDS = {"schema_version", "synthetic", "public_content", "official_site", "single_location",
          "official_url", "name", "address", "city", "state", "country", "styles", "discovered_at",
          "pages", "evidence"}
SENSITIVE = re.compile(r"password[\"']?\s*[:=]|secret[\"']?\s*[:=]|token[\"']?\s*[:=]|"
                       r"api[_-]?key[\"']?\s*[:=]|\bbearer\s|authorization\s*:|"
                       r"-----BEGIN .*PRIVATE KEY|postgres(?:ql)?://|https?://[^/\s]*@|"
                       r"\b\d{3}-\d{2}-\d{4}\b", re.I)
UNCERTAIN = re.compile(r"\b(?:not|no|never|closed|closing|ceased|formerly|previously|planned|"
                       r"discontinued|unavailable|might|maybe)\b|coming soon|used to|do not|don't", re.I)


class Rejected(ValueError):
    """Only fixed reason codes cross reporting boundaries."""


def require(condition, code="invalid_shape"):
    if not condition:
        raise Rejected(code)


def text(value, limit):
    require(isinstance(value, str) and 0 < len(value) <= limit and value == value.strip()
            and not re.search(r"[\x00-\x1f\x7f\ud800-\udfff]", value))
    return value


def public_url(value):
    text(value, 2048)
    try:
        p = urlsplit(value)
        host = (p.hostname or "").lower()
        require(p.scheme in ("http", "https") and p.username is None and p.password is None
                and p.port in (None, 80, 443) and not p.query and not p.fragment
                and not re.search(r"[\s\\%]", value)
                and re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63}", host)
                and not host.endswith((".local", ".internal", ".localhost", ".lan", ".home", ".arpa"))
                and not re.search(r"(?:^|\.)(?:auth|accounts?|login|signin|admin|private|members?)(?:\.|$)", host)
                and not re.search(r"(?:^|[/_.-])(?:login|logon|sign[-_]?in|account|admin|private|patient|"
                                  r"auth|oauth|token|secret|member(?:s)?|user|profile|dashboard)(?:[/_.-]|$)", p.path, re.I), "unsafe_url")
        return host.removeprefix("www.")
    except ValueError as exc:
        raise Rejected("unsafe_url") from exc


def timestamp(value, now):
    text(value, 40)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        require(parsed.tzinfo is not None and parsed <= now + timedelta(minutes=5), "invalid_timestamp")
        require(parsed >= now - timedelta(days=30), "stale_evidence")
        return parsed
    except (ValueError, OverflowError) as exc:
        if isinstance(exc, Rejected):
            raise
        raise Rejected("invalid_timestamp") from exc


def supports(value, quote):
    return (" " + normalized(value) + " ") in (" " + normalized(quote) + " ")



def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def normalized(value):
    return " ".join(re.findall(r"[a-z0-9]+", unicodedata.normalize("NFKD", value)
                              .encode("ascii", "ignore").decode().lower()))


def validate(record, *, now=None):
    now = now or datetime.now(timezone.utc)
    require(isinstance(record, dict) and set(record) == FIELDS)
    require(type(record["schema_version"]) is int and record["schema_version"] == 1
            and type(record["synthetic"]) is bool)
    require(all(record[k] is True for k in ("public_content", "official_site", "single_location")),
            "attestation_required")
    for key, bound in (("name", 160), ("address", 240), ("city", 80), ("state", 2), ("country", 2)):
        text(record[key], bound)
    require(re.match(r"^\d+[A-Za-z-]*\s+\S+\s+\S+", record["address"]), "invalid_address")
    scope = {tuple(line.split(", ")) for line in Path(__file__).with_name("cities").joinpath("dmv.txt")
             .read_text().splitlines() if line and not line.startswith("#")}
    require(record["country"] == "US" and (record["city"], record["state"]) in scope, "out_of_scope")
    styles = record["styles"]
    require(isinstance(styles, list) and 1 <= len(styles) <= 3
            and all(isinstance(s, str) and s in STYLES for s in styles)
            and len(set(styles)) == len(styles), "out_of_scope")
    host = public_url(record["official_url"])
    discovered = timestamp(record["discovered_at"], now)
    pages = record["pages"]
    require(isinstance(pages, list) and 1 <= len(pages) <= 4)
    by_url = {}
    for page in pages:
        require(isinstance(page, dict) and set(page) == {"url", "text", "fetched_at", "redirect_chain"})
        require(public_url(page["url"]) == host, "unofficial_source")
        chain = page["redirect_chain"]
        require(isinstance(chain, list) and 1 <= len(chain) <= 5, "invalid_shape")
        for url in chain:
            require(public_url(url) == host, "unofficial_source")
        require(chain[-1] == page["url"] and page["url"] not in by_url)
        fetched = timestamp(page["fetched_at"], now)
        require(fetched >= discovered - timedelta(minutes=5), "invalid_timestamp")
        body = page["text"]
        require(isinstance(body, str) and 0 < len(body) <= 50_000
                and not re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff]", body))
        require(not SENSITIVE.search(body), "sensitive_input")
        require(not re.search(r"permanently closed|no longer (?:offer|teach)|ceased operations|"
                              r"closed for good|not currently offering", body, re.I), "contradictory_content")
        by_url[page["url"]] = body
    evidence = record["evidence"]
    require(isinstance(evidence, dict) and set(evidence) == {"name", "location", "styles"})
    require(isinstance(evidence["styles"], dict) and set(evidence["styles"]) == set(styles))

    def quote(item):
        require(isinstance(item, dict) and set(item) == {"url", "quote"})
        text(item["url"], 2048)
        q = text(item["quote"], 800)
        require(item["url"] in by_url and q in by_url[item["url"]], "quote_not_found")
        require(not UNCERTAIN.search(q), "unsupported_value")
        # Check complete source sentences, not just a potentially cropped assertion.
        # Every occurrence must agree: repeated positive/negative text is ambiguous.
        body = by_url[item["url"]]
        matches = list(re.finditer(re.escape(q), body))
        for sentence in re.finditer(r"[^.!?]+[.!?]*", body):
            if any(m.start() < sentence.end() and m.end() > sentence.start() for m in matches):
                require(not UNCERTAIN.search(sentence.group()), "unsupported_value")
        return q

    require(supports(record["name"], quote(evidence["name"])), "unsupported_value")
    location = quote(evidence["location"])
    require(all(supports(record[k], location) for k in ("address", "city", "state"))
            and any(supports(v, location) for v in ("US", "USA", "United States")), "unsupported_value")
    for style in styles:
        q = quote(evidence["styles"][style])
        require(supports(STYLES[style], q) and re.search(
            r"\b(?:offer|offers|teach|teaches|classes|training|lessons)\b", q, re.I), "unsupported_value")
    fields = {key: record[key] for key in ("name", "address", "city", "state", "country")}
    fields.update(website=record["official_url"], styles=sorted(record["styles"]))
    identity = [normalized(fields[key]) for key in ("name", "address", "city", "state")]
    return {"id": hashlib.sha256(canonical(identity).encode()).hexdigest(),
            "fields": fields, "record": record}


@contextmanager
def queue_db(path, *, readonly=False):
    if not readonly:
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if not path.exists():
            try:
                os.close(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600))
            except FileExistsError:
                pass
    require(not path.is_symlink() and path.is_file(), "queue_io_error")
    require(path.stat().st_mode & 0o077 == 0 and path.stat().st_nlink == 1, "queue_permissions")
    db = sqlite3.connect(path.as_uri() + ("?mode=ro" if readonly else "?mode=rw"), uri=True, timeout=5)
    try:
        if not readonly:
            db.execute("PRAGMA synchronous=FULL")
            db.execute("BEGIN IMMEDIATE")
            db.execute("""CREATE TABLE IF NOT EXISTS candidates (
                id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
                reason TEXT, gym_id TEXT)""")
        yield db
        if not readonly:
            db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


def queue_counts(db):
    counts: dict[str, int] = dict.fromkeys(("pending", "applied", "review"), 0)
    counts.update(dict(db.execute("SELECT status, count(*) FROM candidates GROUP BY status")))
    counts["total"] = sum(counts.values())
    return counts


def summary(command):
    return {"schema_version": 1, "command": command, "status": "ok", "mode": "local_only",
            "accepted": 0, "rejected": 0, "duplicate": 0, "inserted": 0,
            "reasons": {}, "remaining_input_unchecked": False}


def reject(report, reason):
    report["rejected"] += 1
    report["reasons"][reason] = report["reasons"].get(reason, 0) + 1


def strict_json(line):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate key")
            result[key] = value
        return result
    try:
        return json.loads(line, object_pairs_hook=pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeError, RecursionError):
        raise Rejected("invalid_json") from None


def ingest(args, now):
    report = summary("ingest")
    require(args.input.is_file(), "input_io_error")
    require(not args.queue.exists() or not args.input.samefile(args.queue), "input_queue_alias")
    with args.input.open("rb") as source:
        records = []
        for _ in range(args.limit):
            line = source.readline(300_001)
            if not line:
                break
            if len(line) > 300_000:
                raise Rejected("input_too_large")
            records.append(line)
        report["remaining_input_unchecked"] = bool(source.read(1))
    require(records, "empty_input")
    if report["remaining_input_unchecked"]:
        report["reasons"]["input_limit"] = 1
    with queue_db(args.queue) as db:
        for line in records:
            try:
                item = validate(strict_json(line), now=now)
                existing = db.execute("SELECT payload FROM candidates WHERE id=?", (item["id"],)).fetchone()
                if existing:
                    require(strict_json(existing[0])["fields"] == item["fields"], "conflicting_candidate")
                    report["duplicate"] += 1
                else:
                    require(queue_counts(db)["total"] < MAX_QUEUE, "queue_full")
                    db.execute("INSERT INTO candidates (id, payload) VALUES (?, ?)",
                               (item["id"], canonical(item)))
                    report["accepted"] += 1
            except Rejected as exc:
                reject(report, str(exc))
        report["queue"] = queue_counts(db)
    return report


def write_source(cur, item, gym_id):
    record = item["record"]
    provenance = {"pipeline": "public-candidates-v1", "candidate_id": item["id"], "gym_id": str(gym_id),
                  "fields": item["fields"], "evidence": record["evidence"],
                  "discovered_at": record["discovered_at"], "pages": [
                      {k: p[k] for k in ("url", "fetched_at", "redirect_chain")} |
                      {"text_sha256": hashlib.sha256(p["text"].encode()).hexdigest()} for p in record["pages"]]}
    fetched_at = max(datetime.fromisoformat(p["fetched_at"].replace("Z", "+00:00")) for p in record["pages"])
    cur.execute("INSERT INTO sources (kind, url, fetched_at, raw) VALUES (%s, %s, %s, %s) RETURNING id",
                ("website", item["fields"]["website"], fetched_at, canonical(provenance)))
    require(cur.fetchone(), "database_verification_failed")


def insert_gym(cur, item):
    f = item["fields"]
    place_slug = normalized(f["city"] + " " + f["state"]).replace(" ", "-")
    slug = normalized(f["name"] + " " + f["city"] + " " + f["state"]).replace(" ", "-")
    cur.execute("""SELECT id, state, city, slug FROM places
        WHERE slug=%s OR (state=%s AND lower(city)=lower(%s)) LIMIT 3""",
                (place_slug, f["state"], f["city"]))
    places = cur.fetchall()
    require(len(places) <= 1 and all(p["state"] == f["state"] and normalized(p["city"]) == normalized(f["city"])
                                    for p in places), "ambiguous_location")
    place = places[0] if places else None
    if not place:
        cur.execute("INSERT INTO places (state, city, slug) VALUES (%s, %s, %s) RETURNING id",
                    (f["state"], f["city"], place_slug))
        place = cur.fetchone()
    require(place, "database_verification_failed")
    cur.execute("""INSERT INTO gyms
        (slug, name, styles, place_id, address, website, is_active, is_sample, claimed, tags)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                (slug, f["name"], f["styles"], place["id"], f["address"], f["website"], True, False, False, []))
    row = cur.fetchone()
    require(row, "database_verification_failed")
    write_source(cur, item, row["id"])
    return str(row["id"])


def existing_gym(cur, item):
    f = item["fields"]
    place_slug = normalized(f["city"] + " " + f["state"]).replace(" ", "-")
    slug = normalized(f["name"] + " " + f["city"] + " " + f["state"]).replace(" ", "-")
    host = public_url(f["website"])
    cur.execute("""SELECT g.id, g.slug, g.name, g.address, g.website, g.is_sample, g.is_active, p.city, p.state
        FROM gyms g LEFT JOIN places p ON p.id=g.place_id
        WHERE p.slug=%s OR (lower(p.city)=lower(%s) AND p.state=%s) OR g.slug=%s
          OR regexp_replace(lower(g.name), '[^a-z0-9]+', '', 'g')=%s OR g.website ~* %s LIMIT 501""",
        (place_slug, f["city"], f["state"], slug, normalized(f["name"]).replace(" ", ""),
         r"^https?://(www\.)?" + re.escape(host) + r"([/:]|$)"))
    rows = cur.fetchall()
    require(len(rows) <= 500, "too_many_matches")
    related = []
    for row in rows:
        same_city = all(normalized(row.get(k) or "") == normalized(f[k]) for k in ("city", "state"))
        same_name = normalized(row["name"]) == normalized(f["name"])
        same_address = normalized(row.get("address") or "") == normalized(f["address"])
        try:
            same_host = public_url(row["website"]) == host if row.get("website") else False
        except Rejected:
            same_host = False
        if row["slug"] == slug or same_host or (same_city and (same_name or same_address)):
            require(same_city and same_name and same_address and row["is_active"]
                    and not row["is_sample"] and (not row.get("website") or same_host), "ambiguous_location")
            related.append(row)
    require(len(related) <= 1, "ambiguous_location")
    return related[0] if related else None


@contextmanager
def database():
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError:
        raise Rejected("database_driver_missing") from None
    try:
        with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row,
                              connect_timeout=10, autocommit=False) as pg:
            yield pg
    except psycopg.Error:
        # Commit acknowledgement can be lost: never report success; replay is safe.
        raise Rejected("database_error") from None


def apply_batch(items, max_new):
    outcomes = []
    new_count = 0
    with database() as pg:
        with pg.cursor() as cur:
            cur.execute("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
            cur.execute("SET LOCAL lock_timeout = '5s'")
            cur.execute("SET LOCAL statement_timeout = '30s'")
            # Locks conflict with ordinary INSERT/UPDATE, including older scraper writers.
            # READ COMMITTED gives the second overlapping run a fresh post-lock snapshot.
            cur.execute("LOCK TABLE places, gyms, sources IN SHARE ROW EXCLUSIVE MODE")
            for item in items:
                try:
                    existing = existing_gym(cur, item)
                    cur.execute("""SELECT raw FROM sources WHERE kind=%s
                        AND raw->>'pipeline'=%s AND raw->>'candidate_id'=%s LIMIT 2""",
                        ("website", "public-candidates-v1", item["id"]))
                    sources = cur.fetchall()
                    if sources:
                        require(len(sources) == 1 and existing
                                and sources[0]["raw"].get("gym_id") == str(existing["id"])
                                and sources[0]["raw"].get("fields") == item["fields"], "provenance_conflict")
                        outcomes.append((item["id"], "duplicate", str(existing["id"])))
                    elif existing:
                        write_source(cur, item, existing["id"])
                        outcomes.append((item["id"], "duplicate", str(existing["id"])))
                    elif new_count >= max_new:
                        outcomes.append((item["id"], "deferred", "new_gym_cap"))
                    else:
                        gym_id = insert_gym(cur, item)
                        new_count += 1
                        outcomes.append((item["id"], "inserted", gym_id))
                except Rejected as exc:
                    if str(exc) not in {"ambiguous_location", "too_many_matches", "provenance_conflict"}:
                        raise
                    outcomes.append((item["id"], "review", str(exc)))
    return outcomes


def run_queue(args, now):
    if args.apply:
        require(os.environ.get("DATABASE_URL", "").strip(), "missing_database_url")
    report = summary("run")
    report.update(mode="apply" if args.apply else "dry_run", eligible=0, max_new=args.max_new,
                  database_outcome="not_attempted", deferred=0)
    with queue_db(args.queue, readonly=not args.apply) as db:
        pending_before = queue_counts(db)["pending"]
        rows = db.execute("SELECT id, payload FROM candidates WHERE status='pending' ORDER BY rowid LIMIT ?",
                          (args.limit,)).fetchall()
        items = []
        for key, payload in rows:
            try:
                saved = strict_json(payload)
                require(isinstance(saved, dict) and set(saved) == {"id", "fields", "record"}, "queue_corrupt")
                item = validate(saved["record"], now=now)
                require(item["id"] == key == saved["id"] and item["fields"] == saved["fields"], "queue_corrupt")
                if args.apply:
                    require(not item["record"]["synthetic"] and not public_url(item["fields"]["website"])
                            .endswith((".example", ".test", ".invalid")), "synthetic_not_publishable")
                report["eligible"] += 1
                items.append(item)
            except Rejected as exc:
                reject(report, str(exc))
                if args.apply:
                    db.execute("UPDATE candidates SET status='review', reason=? WHERE id=?", (str(exc), key))
        if args.apply and items:
            outcomes = apply_batch(items, args.max_new)
            report["database_outcome"] = "committed"
            for key, outcome, value in outcomes:
                if outcome == "review":
                    reject(report, value)
                    db.execute("UPDATE candidates SET status='review', reason=? WHERE id=?", (value, key))
                elif outcome == "deferred":
                    report["deferred"] += 1
                    report["reasons"][value] = report["reasons"].get(value, 0) + 1
                else:
                    report[outcome] += 1
                    db.execute("UPDATE candidates SET status='applied', gym_id=? WHERE id=?", (value, key))
        report["queue"] = queue_counts(db)
        if pending_before > len(rows):
            report["reasons"]["queue_batch_limit"] = 1
    return report


HELP = """
Workflow (from repository root; Python 3.11+, psycopg needed only for apply):
  python -m scrapers.public_candidates ingest --input candidates.jsonl --queue /private/queue.sqlite3
  python -m scrapers.public_candidates run --queue /private/queue.sqlite3
  python -m scrapers.public_candidates run --queue /private/queue.sqlite3 --apply --max-new 3
  python -m scrapers.public_candidates status --queue /private/queue.sqlite3

Ingest validates and writes ONLY the durable local queue, never Postgres. Run is
an offline dry-run unless --apply is present; dry-run does not alter the queue,
connect to Postgres, or predict database duplicates. No crawling, inference,
Google Places, Jev, or fact extractor is invoked. Apply requires an explicitly
exported DATABASE_URL (no .env auto-loading or fallback). Keep credentials out
of arguments and logs. Use a direct privileged Postgres connection with SELECT,
INSERT and table LOCK permissions for the existing places, gyms, sources tables.

JSONL v1: exactly these keys; all fields required, no extra metadata:
  schema_version: integer 1; synthetic: boolean (true fixtures can NEVER apply)
  public_content, official_site, single_location: literal true attestations
  official_url: official location website HTTP(S) URL (max 2048 characters)
  name: nonempty string <=160; address: physical street string <=240,
    starting with street number and >=2 following words (not a PO box)
  city: string <=80 exactly as in scrapers/cities/dmv.txt; state: VA, MD or DC
    paired with that city; country: literal "US"
  styles: unique nonempty array containing only muay_thai, kickboxing,
    dutch_kickboxing (max 3); unrelated disciplines are rejected, not guessed
  discovered_at: timezone-aware ISO-8601 timestamp
  pages: 1..4 objects, each with exactly:
    url, fetched_at (timezone-aware ISO-8601), text (1..50000 characters),
    redirect_chain (1..5 URLs including initial request and final url, in order)
  evidence: exactly name, location, styles:
    name: {"url": "<page url>", "quote": "<exact name-bearing quote>"}
    location: {"url": "<page url>", "quote": "<exact address, city, state, country quote>"}
    styles: {"muay_thai": {"url": "<page url>", "quote": "<exact offering quote>"}, ...}

Quotes are nonempty <=800-character exact substrings, each supporting its value
on word boundaries (case/spacing/punctuation/accent-insensitive value matching).
One location quote must contain address, city, state and US/USA/United States.
State/country abbreviation inference is intentionally NOT performed. Each style
quote must contain its readable name (e.g. Muay Thai) plus offer/teach/classes/
training/lessons wording; negative/uncertain quotes and known closure language
are rejected. official_url is supported by the official_site attestation and
same-host pages, not by an invented quote of a URL. All page/redirect hosts must
match official_url (www alias allowed). Named hosts only: no IP literals, local
hosts, credentials, queries, fragments, percent escapes, auth paths/subdomains,
or nonstandard ports. Reserved .example/.test/.invalid hosts cannot apply.
All timestamps must be within 30 days and at most 5 minutes in the future;
fetched_at must not precede discovered_at by more than 5 minutes. Revalidated
on every run; expired or ambiguous records go to review, never auto-published.

Trust boundary: caller must actually visit and review the PUBLIC official site,
record every redirect, confirm one operating location and affirmative offerings,
and supply exact, unedited quotations. This is a conservative deterministic
validator, NOT an authenticity/semantic oracle: no DNS lookup, network access,
geocoding, or external verification is performed. Do not mark uncertain content
as attested; do not submit private pages, Google ratings/reviews, or secrets.
A realistic SYNTHETIC example is scrapers/tests/fixtures/synthetic_candidates.jsonl;
its fixed timestamps eventually expire. It is NOT a discovered business.

Bounds and persistence:
  --limit defaults 20, hard max 50 input lines / pending candidates per run.
  JSONL line max 300000 bytes; oversized lines abort the entire ingest batch
  without draining the file; normal invalid rows are rejected independently.
  --max-new defaults 3, hard max 5 NEW gyms per apply run; excess stay pending.
  Queue max 500 records including applied/review; no automatic eviction.
  SQLite BEGIN IMMEDIATE + FULL synchronous commit serializes local writers
  (5s busy timeout); use durable LOCAL storage, not NFS. New queue mode is 0600;
  symlink/hardlink or group/world-readable queues are refused. Use a private
  directory. Raw page text remains local-only; never publish the queue/corpus.
  Same normalized name/address/city/state dedupes; conflicting public fields
  require manual review rather than replacement. New evidence does not silently
  revive reviewed/applied items. Archive the queue and ingest a fresh reviewed
  corpus into a NEW queue for refresh/recovery or capacity rollover; remote
  identity/provenance checks still protect reruns. Back up before manual repair.

Database contract (no schema migration):
  places(state,city,slug) inserted only when a unique consistent place is absent.
  gyms(slug,name,styles,place_id,address,website,is_active=true,is_sample=false,
       claimed=false,tags=[]) inserted for unambiguously new locations only.
  Existing gyms are NEVER updated, even empty fields/styles, preserving manual
  values. Same brand/host with unclear address or slug conflicts is held for
  review, not collapsed into another branch; no price/class/fighter inference.
  sources(kind='website',url,fetched_at,raw) stores candidate_id, gym_id,
  pipeline='public-candidates-v1', fields, exact evidence, timestamps, redirect
  chains and page SHA-256 hashes, NOT raw page text. Source metadata stays private
  under existing sources RLS. Keyed provenance is inserted at most once.
  A READ COMMITTED transaction locks places, gyms, sources in SHARE ROW EXCLUSIVE
  mode BEFORE matching. Overlapping runs (even distinct queues) serialize, and
  ordinary legacy table writers are blocked during the transaction. Existing
  fuzzy duplicates are not repaired. Max 500 matching gyms; excess requires review.
  Connect timeout 10s, lock timeout 5s, statement timeout 30s. Lock privileges and
  brief contention are operational prerequisites. DB commits before queue state;
  a crash/uncertain commit is safe to replay using remote identity/provenance.

One sanitized JSON object on stdout, with accepted/rejected/duplicate counts,
inserted NEW gyms, reasons, queue counts and database_outcome. Ingest counts are
local; run eligible is local validation, NOT a prediction of publishable new rows.
Blocked inserted=0 means zero CONFIRMED inserts, not proof of remote rollback;
unknown_retry_safe requires a rerun. Exit 0 complete, 1 rejected/review rows,
2 blocked/invalid arguments or a cap leaving work unchecked/deferred. Status
reads aggregate queue counts without DB access; it does not imply DB sync.
Reason codes:
  invalid_arguments input_required input_io_error input_queue_alias empty_input
  input_too_large invalid_json invalid_shape attestation_required invalid_address
  out_of_scope unsafe_url unofficial_source invalid_timestamp stale_evidence
  sensitive_input contradictory_content quote_not_found unsupported_value
  conflicting_candidate queue_full queue_io_error queue_permissions queue_corrupt
  io_error synthetic_not_publishable missing_database_url database_driver_missing
  database_error database_verification_failed ambiguous_location too_many_matches
  provenance_conflict input_limit queue_batch_limit new_gym_cap
"""


class SafeParser(argparse.ArgumentParser):
    def error(self, message):
        raise Rejected("invalid_arguments")


def main(argv=None, *, now=None):
    parser = SafeParser(description=__doc__, epilog=HELP, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=("ingest", "status", "run"), help="enqueue, report, or preview/apply")
    parser.add_argument("--queue", type=Path, default=Path.home() / ".local/share/fightgyms/candidates.sqlite3",
                        help="private durable SQLite file (default: ~/.local/share/fightgyms/candidates.sqlite3)")
    parser.add_argument("--input", type=Path, help="local JSONL file; required for ingest only")
    parser.add_argument("--limit", type=int, choices=range(1, 51), default=20, metavar="1..50",
                        help="max input lines/pending candidates (default: 20)")
    parser.add_argument("--max-new", type=int, choices=range(1, 6), default=3, metavar="1..5",
                        help="max NEW gyms per apply transaction (default: 3)")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="explicitly enable Postgres writes for run")
    mode.add_argument("--dry-run", action="store_true", help="explicit no-DB preview (run default)")
    try:
        args = parser.parse_args(argv)
    except Rejected:
        report = summary("invalid")
        report.update(status="blocked", reasons={"invalid_arguments": 1})
        print(canonical(report))
        return 2
    args.queue = args.queue.absolute()
    try:
        require((args.command == "run" or not (args.apply or args.dry_run))
                and (args.command == "ingest" or args.input is None), "invalid_arguments")
        require(args.command != "ingest" or args.input is not None, "input_required")
        if args.command == "ingest":
            report = ingest(args, now)
        elif args.command == "run":
            report = run_queue(args, now)
        else:
            report = summary("status")
            with queue_db(args.queue, readonly=True) as db:
                report["queue"] = queue_counts(db)
    except (OSError, sqlite3.Error, Rejected) as exc:
        report = summary(args.command)
        reason = str(exc) if isinstance(exc, Rejected) else "io_error"
        report.update(status="blocked", reasons={reason: 1},
                      mode="apply" if args.apply else "dry_run" if args.command == "run" else "local_only",
                      database_outcome="unknown_retry_safe" if args.apply and reason not in
                      {"missing_database_url", "database_driver_missing"} else "not_attempted")
    capped = any(r in report["reasons"] for r in ("input_limit", "new_gym_cap", "queue_batch_limit"))
    if report["status"] != "blocked" and (report["rejected"] or capped):
        report["status"] = "partial"
    print(canonical(report))
    return 2 if report["status"] == "blocked" or capped else int(bool(report["rejected"]))


if __name__ == "__main__":
    sys.exit(main())

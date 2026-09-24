"""Offline synthetic fixtures only. No websites, inference providers or live DB."""
import copy
import importlib.util
import os
import sqlite3
import tempfile
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import patch
import json
import unittest
from datetime import datetime, timezone
from pathlib import Path

NOW = datetime(2026, 9, 23, 12, tzinfo=timezone.utc)
FIXTURE = Path(__file__).parent / "fixtures/synthetic_candidates.jsonl"


def candidate():
    return json.loads(FIXTURE.read_text())


class Validation(unittest.TestCase):
    def test_authentication_subdomains_and_contradictory_content_are_not_public_evidence(self):
        from scrapers import public_candidates as pipeline
        for url in ("https://accounts.gym.example/", "https://auth.gym.example/", "https://gym.example/sign-in",
                    "https://gym.example/wp-admin", "https://gym.example/user/profile"):
            record = candidate()
            record["official_url"] = url
            with self.subTest(url=url):
                with self.assertRaises(pipeline.Rejected) as error:
                    pipeline.validate(record, now=NOW)
                self.assertEqual(str(error.exception), "unsafe_url")
        record = candidate()
        record["pages"][0]["text"] += " Our gym is permanently closed."
        with self.assertRaises(pipeline.Rejected) as error:
            pipeline.validate(record, now=NOW)
        self.assertEqual(str(error.exception), "contradictory_content")

    def test_untrusted_or_unsupported_metadata_is_rejected_with_codes(self):
        from scrapers import public_candidates as pipeline
        self.assertTrue(hasattr(pipeline, "Rejected"), "Validation must reject unsafe records")
        cases = [
            (lambda r: r.update(name=9), "invalid_shape"),
            (lambda r: r.update(schema_version=True), "invalid_shape"),
            (lambda r: r.update(name="x" * 161), "invalid_shape"),
            (lambda r: r.update(name=""), "invalid_shape"),
            (lambda r: r.update(rating=5), "invalid_shape"),
            (lambda r: r.update(styles=["mma"]), "out_of_scope"),
            (lambda r: r.update(styles=["muay_thai", "muay_thai"]), "out_of_scope"),
            (lambda r: r.update(styles=[{}]), "out_of_scope"),
            (lambda r: r.update(country="CA"), "out_of_scope"),
            (lambda r: r.update(state="CA"), "out_of_scope"),
            (lambda r: r.update(city="Imaginary"), "out_of_scope"),
            (lambda r: r.update(address="unknown"), "invalid_address"),
            (lambda r: r.update(public_content=1), "attestation_required"),
            (lambda r: r.update(official_site=False), "attestation_required"),
            (lambda r: r.update(single_location=False), "attestation_required"),
            (lambda r: r.update(discovered_at="2026-09-23"), "invalid_timestamp"),
            (lambda r: r.update(discovered_at="2026-09-24T00:00:00Z"), "invalid_timestamp"),
            (lambda r: r["pages"][0].update(fetched_at="2025-01-01T00:00:00Z"), "stale_evidence"),
            (lambda r: r["pages"][0].update(text="x" * 50_001), "invalid_shape"),
            (lambda r: r["pages"][0].update(text="password=SYNTHETIC_SECRET"), "sensitive_input"),
            (lambda r: r["pages"][0].update(text="bad\ud800"), "invalid_shape"),
            (lambda r: r["evidence"]["name"].update(quote="Made up quotation"), "quote_not_found"),
            (lambda r: r.update(name="Invented Gym"), "unsupported_value"),
            (lambda r: r["evidence"]["location"].update(quote="Arlington"), "unsupported_value"),
            (lambda r: r["evidence"]["styles"].pop("muay_thai"), "invalid_shape"),
        ]
        for mutate, code in cases:
            with self.subTest(code=code, mutation=repr(mutate)):
                record = candidate()
                mutate(record)
                with self.assertRaises(pipeline.Rejected) as error:
                    pipeline.validate(record, now=NOW)
                self.assertEqual(str(error.exception), code)
        urls = ["ftp://gym.example/", "http://127.0.0.1/", "http://[::1]/", "http://10.1.2.3/",
                "http://2130706433/", "http://127.1/", "http://printer/", "https://gym.local/",
                "https://gym.internal/", "https://user:secret@gym.example/", "https://gym.example:9999/",
                "https://gym.example/?token=SECRET", "https://gym.example/#secret",
                "https://gym.example/login", "https://gym.example/members-only", "https://gym.example/admin.php",
                "https://gym.example/%2561ccount", "https://gym.example/\\secret"]
        for url in urls:
            with self.subTest(url=url):
                for target in ("official", "redirect"):
                    record = candidate()
                    if target == "official":
                        record["official_url"] = url
                    else:
                        record["pages"][0]["redirect_chain"].insert(0, url)
                    with self.assertRaises(pipeline.Rejected) as error:
                        pipeline.validate(record, now=NOW)
                    self.assertEqual(str(error.exception), "unsafe_url")
        for quote in ("We do not offer Muay Thai classes.", "Muay Thai classes coming soon.",
                      "An article about Muay Thai."):
            record = candidate()
            record["pages"][0]["text"] += " " + quote
            record["evidence"]["styles"]["muay_thai"]["quote"] = quote
            with self.assertRaises(pipeline.Rejected) as error:
                pipeline.validate(record, now=NOW)
            self.assertEqual(str(error.exception), "unsupported_value")

    def test_cropped_uncertainty_in_source_sentence_is_rejected(self):
        from scrapers import public_candidates as pipeline
        selected = "offer Muay Thai classes"
        for sentence in ("We do not offer Muay Thai classes.",
                         "We might offer Muay Thai classes.",
                         "We offer Muay Thai classes, maybe next year.",
                         "We do not\noffer Muay Thai classes.",
                         "We offer Muay Thai classes. We do not offer Muay Thai classes."):
            with self.subTest(sentence=sentence):
                record = candidate()
                record["pages"][0]["text"] += " " + sentence
                record["evidence"]["styles"]["muay_thai"]["quote"] = selected
                with self.assertRaises(pipeline.Rejected) as error:
                    pipeline.validate(record, now=NOW)
                self.assertEqual(str(error.exception), "unsupported_value")

    def test_cropped_name_and_location_use_the_same_source_context_guard(self):
        from scrapers import public_candidates as pipeline
        for field, selected in (("name", "Synthetic Potomac Striking Gym"),
                                ("location", "123 Example Avenue, Arlington, VA 22201, United States")):
            with self.subTest(field=field):
                record = candidate()
                record["pages"][0]["text"] += f" We are not {selected}."
                record["evidence"][field]["quote"] = selected
                with self.assertRaises(pipeline.Rejected) as error:
                    pipeline.validate(record, now=NOW)
                self.assertEqual(str(error.exception), "unsupported_value")

    def test_unrelated_negative_sentence_does_not_disqualify_positive_evidence(self):
        from scrapers import public_candidates as pipeline
        for selected in ("offer Muay Thai classes", "We offer Muay Thai classes."):
            with self.subTest(selected=selected):
                record = candidate()
                record["pages"][0]["text"] += (
                    " No experience required. We offer Muay Thai classes. No equipment needed.")
                record["evidence"]["styles"]["muay_thai"]["quote"] = selected
                result = pipeline.validate(record, now=NOW)
                self.assertIn("muay_thai", result["fields"]["styles"])

    def test_source_backed_candidate_projects_only_public_fields(self):
        self.assertIsNotNone(importlib.util.find_spec("scrapers.public_candidates"),
                             "The public candidate validation slice is not implemented")
        from scrapers import public_candidates as pipeline
        source = candidate()
        before = copy.deepcopy(source)
        result = pipeline.validate(source, now=NOW)
        self.assertEqual(result["fields"], {
            "name": "Synthetic Potomac Striking Gym", "address": "123 Example Avenue",
            "city": "Arlington", "state": "VA", "country": "US",
            "website": "https://synthetic-potomac.example/",
            "styles": ["kickboxing", "muay_thai"],
        })
        self.assertEqual(len(result["id"]), 64)
        self.assertEqual(result["record"], before)
        self.assertEqual(source, before)
        self.assertNotIn("text", result["fields"])


def invoke(*args):
    from scrapers import public_candidates as pipeline
    output = StringIO()
    with redirect_stdout(output):
        code = pipeline.main(list(map(str, args)), now=NOW)
    return code, json.loads(output.getvalue())


class QueueCLI(unittest.TestCase):
    def test_queue_capacity_bad_flags_and_unsafe_file_permissions_are_explicit(self):
        from scrapers import public_candidates as pipeline
        self.assertTrue(hasattr(pipeline, "MAX_QUEUE"), "Durable queue must have an explicit storage cap")
        with tempfile.TemporaryDirectory() as directory:
            queue, source = Path(directory) / "queue.sqlite3", Path(directory) / "input.jsonl"
            second = FIXTURE.read_text().replace("Potomac", "Capitol").replace("potomac", "capitol")
            source.write_text(FIXTURE.read_text() + second)
            with patch.object(pipeline, "MAX_QUEUE", 1):
                code, report = invoke("ingest", "--input", source, "--queue", queue)
            self.assertEqual(report["accepted"], 1)
            self.assertEqual(report["reasons"], {"queue_full": 1})
            self.assertNotEqual(code, 0)
            queue.chmod(0o644)
            code, report = invoke("status", "--queue", queue)
            self.assertEqual(code, 2)
            self.assertEqual(report["reasons"], {"queue_permissions": 1})
            queue.chmod(0o600)
            for flags in (("--limit", "0"), ("--max-new", "6"), ("--limit", "SYNTHETIC_SECRET"),
                          ("--apply", "--dry-run")):
                code, report = invoke("run", "--queue", queue, *flags)
                self.assertEqual(code, 2)
                self.assertEqual(report["reasons"], {"invalid_arguments": 1})
                self.assertNotIn("SYNTHETIC_SECRET", json.dumps(report))
            self.assertEqual(invoke("ingest", "--input", source, "--queue", queue, "--apply")[0], 2)

    def test_simultaneous_local_ingestion_keeps_one_durable_candidate(self):
        import subprocess
        import sys
        with tempfile.TemporaryDirectory() as directory:
            queue = Path(directory) / "queue.sqlite3"
            command = [sys.executable, "-c", "from scrapers.public_candidates import main; "
                       "from scrapers.tests.test_public_candidates import NOW; "
                       "raise SystemExit(main(now=NOW))", "ingest", "--input", str(FIXTURE), "--queue", str(queue)]
            runs = [subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                    for _ in range(3)]
            reports = []
            for run in runs:
                out, err = run.communicate(timeout=15)
                self.assertEqual(run.returncode, 0, err + out)
                reports.append(json.loads(out))
            self.assertEqual(sum(r["accepted"] for r in reports), 1)
            self.assertEqual(sum(r["duplicate"] for r in reports), 2)
            self.assertEqual(invoke("status", "--queue", queue)[1]["queue"]["total"], 1)

    def test_caps_conflicts_and_io_failures_never_claim_false_acceptance(self):
        from scrapers import public_candidates as pipeline
        with tempfile.TemporaryDirectory() as directory:
            queue, source = Path(directory) / "queue.sqlite3", Path(directory) / "input.jsonl"
            source.write_text(FIXTURE.read_text() * 3)
            code, report = invoke("ingest", "--input", source, "--queue", queue, "--limit", 1)
            self.assertEqual(code, 2)
            self.assertTrue(report["remaining_input_unchecked"])
            self.assertEqual(report["reasons"], {"input_limit": 1})
            changed = candidate()
            changed["styles"] = ["muay_thai"]
            changed["evidence"]["styles"].pop("kickboxing")
            source.write_text(json.dumps(changed) + "\n")
            code, report = invoke("ingest", "--input", source, "--queue", queue)
            self.assertEqual(report["reasons"], {"conflicting_candidate": 1})
            self.assertEqual(report["accepted"], 0)
            for data, reason in ((b"", "empty_input"), (b"x" * 300_001, "input_too_large"),
                                 (b'{"a":1,"a":2}\n', "invalid_json"),
                                 (b"[" * 10_000, "invalid_json"), (b"\xff\n", "invalid_json")):
                source.write_bytes(data)
                code, report = invoke("ingest", "--input", source, "--queue", queue)
                self.assertNotEqual(code, 0)
                self.assertEqual(report["accepted"], 0)
                self.assertEqual(report["reasons"], {reason: 1})
            source.write_text(FIXTURE.read_text())
            for input_path, queue_path in ((source, source), (source, Path(directory)),
                                           (Path(directory) / "missing", queue)):
                code, report = invoke("ingest", "--input", input_path, "--queue", queue_path)
                self.assertEqual(code, 2)
                self.assertEqual(report["status"], "blocked")
                self.assertNotIn(directory, json.dumps(report))
            with patch.object(pipeline.sqlite3, "connect", side_effect=sqlite3.OperationalError("SYNTHETIC_SECRET")):
                code, report = invoke("ingest", "--input", source, "--queue", queue)
                self.assertEqual(code, 2)
                self.assertEqual(report["accepted"], 0)
                self.assertNotIn("SYNTHETIC_SECRET", json.dumps(report))
            self.assertEqual(invoke("status", "--queue", queue)[1]["queue"]["total"], 1)

    def test_ingest_is_durable_deduplicated_and_status_is_sanitized(self):
        from scrapers import public_candidates as pipeline
        self.assertTrue(hasattr(pipeline, "main"), "Queue CLI not implemented")
        with tempfile.TemporaryDirectory() as directory:
            queue, source = Path(directory) / "queue.sqlite3", Path(directory) / "input.jsonl"
            source.write_text(FIXTURE.read_text() * 2 + '{"secret":"SYNTHETIC_SECRET"}\n')
            with patch("psycopg.connect", side_effect=AssertionError("Never connect on ingest")):
                code, report = invoke("ingest", "--input", source, "--queue", queue)
                self.assertEqual(code, 1)
                self.assertEqual((report["accepted"], report["duplicate"], report["rejected"]), (1, 1, 1))
                self.assertEqual(report["reasons"], {"invalid_shape": 1})
                self.assertEqual(report["mode"], "local_only")
                self.assertEqual(invoke("ingest", "--input", FIXTURE, "--queue", queue)[1]["duplicate"], 1)
                code, status = invoke("status", "--queue", queue)
            self.assertEqual(code, 0)
            self.assertEqual(status["queue"], {"pending": 1, "applied": 0, "review": 0, "total": 1})
            self.assertNotIn("SYNTHETIC_SECRET", json.dumps(report))
            self.assertNotIn("Example Avenue", json.dumps(status))
            self.assertEqual(queue.stat().st_mode & 0o777, 0o600)
            with sqlite3.connect(queue) as local:
                self.assertEqual(local.execute("select count(*) from candidates").fetchone()[0], 1)


def contract_item():
    """Synthetic fixture with live-shaped flags; only use behind mocked DB boundary."""
    from scrapers import public_candidates as pipeline
    record = json.loads(FIXTURE.read_text().replace(".example", "-fixture.com"))
    record["synthetic"] = False
    return pipeline.validate(record, now=NOW)


def mock_postgres(gyms=None, sources=None, places=None):
    from unittest.mock import MagicMock
    connection, pg, cur = MagicMock(), MagicMock(), MagicMock()
    connection.__enter__.return_value = pg
    pg.cursor.return_value.__enter__.return_value = cur
    calls = []
    def execute(sql, params=None):
        sql = " ".join(sql.lower().split())
        calls.append((sql, params))
        cur.fetchone.return_value = None
        cur.fetchall.return_value = []
        if "from gyms" in sql:
            cur.fetchall.return_value = copy.deepcopy(gyms or [])
        elif "from sources" in sql:
            cur.fetchall.return_value = copy.deepcopy(sources or [])
        elif "from places" in sql:
            cur.fetchall.return_value = copy.deepcopy(places or [])
        elif sql.startswith("insert into"):
            table = sql.split()[2]
            cur.fetchone.return_value = {"id": table + "-id"}
    cur.execute.side_effect = execute
    return connection, calls


class DatabaseContract(unittest.TestCase):
    def test_overlapping_database_runs_serialize_and_do_not_duplicate_gym_or_source(self):
        from scrapers import public_candidates as pipeline
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier, Lock
        from unittest.mock import MagicMock
        item, barrier, lock = contract_item(), Barrier(2), Lock()
        gyms, sources = [], []
        def connect(*args, **kwargs):
            barrier.wait(timeout=5)
            connection, pg, cur = MagicMock(), MagicMock(), MagicMock()
            connection.__enter__.return_value = pg
            pg.cursor.return_value.__enter__.return_value = cur
            held = False
            def execute(sql, params=None):
                nonlocal held
                sql = " ".join(sql.lower().split())
                cur.fetchone.return_value = None
                cur.fetchall.return_value = []
                if sql.startswith("lock table"):
                    lock.acquire(timeout=5)
                    held = True
                if sql.startswith(("select", "insert")):
                    self.assertTrue(held, "Database reads and writes must follow the exclusive writer lock")
                if "from gyms" in sql:
                    cur.fetchall.return_value = copy.deepcopy(gyms)
                elif "from sources" in sql:
                    cur.fetchall.return_value = copy.deepcopy(sources)
                elif sql.startswith("insert into gyms"):
                    gyms.append({**item["fields"], "id": "gym-id", "slug": params[0],
                                 "is_sample": False, "is_active": True})
                    cur.fetchone.return_value = {"id": "gym-id"}
                elif sql.startswith("insert into sources"):
                    sources.append({"raw": json.loads(params[-1])})
                    cur.fetchone.return_value = {"id": "source-id"}
                elif sql.startswith("insert into places"):
                    cur.fetchone.return_value = {"id": "place-id"}
            cur.execute.side_effect = execute
            def exit_transaction(*args):
                if held:
                    lock.release()
                return False
            connection.__exit__.side_effect = exit_transaction
            return connection
        with patch("psycopg.connect", side_effect=connect), \
                patch.dict(os.environ, {"DATABASE_URL": "postgresql://synthetic-contract"}), \
                ThreadPoolExecutor(max_workers=2) as workers:
            results = list(workers.map(lambda _: pipeline.apply_batch([item], 3), range(2)))
        self.assertEqual(sorted(result[0][1] for result in results), ["duplicate", "inserted"])
        self.assertEqual((len(gyms), len(sources)), (1, 1))

    def test_place_collisions_do_not_publish_into_wrong_geography(self):
        from scrapers import public_candidates as pipeline
        item = contract_item()
        for places in ([{"id": "wrong-id", "state": "VA", "city": "Alexandria", "slug": "arlington-va"}],
                       [{"id": "one", "state": "VA", "city": "Arlington", "slug": "arlington-va"},
                        {"id": "two", "state": "VA", "city": "arlington", "slug": "arlington-other"}]):
            connection, calls = mock_postgres(places=places)
            with patch("psycopg.connect", return_value=connection), \
                    patch.dict(os.environ, {"DATABASE_URL": "postgresql://synthetic-contract"}):
                outcome = pipeline.apply_batch([item], 3)
            self.assertEqual(outcome, [(item["id"], "review", "ambiguous_location")])
            self.assertFalse(any(sql.startswith("insert") for sql, _ in calls))

    def test_existing_identity_is_preserved_and_replayed_provenance_not_duplicated(self):
        from scrapers import public_candidates as pipeline
        item = contract_item()
        gym = {**item["fields"], "id": "existing-id", "slug": "manual-slug", "is_sample": False,
               "is_active": True, "styles": ["boxing"], "claimed": True}
        gym["website"] += "verified"
        for existing_source in (False, True):
            with self.subTest(existing_source=existing_source):
                source = [{"raw": {"gym_id": "existing-id", "fields": item["fields"]}}] if existing_source else []
                connection, calls = mock_postgres(gyms=[gym], sources=source)
                with patch("psycopg.connect", return_value=connection), \
                        patch.dict(os.environ, {"DATABASE_URL": "postgresql://synthetic-contract"}):
                    outcomes = pipeline.apply_batch([item], 3)
                self.assertEqual(outcomes, [(item["id"], "duplicate", "existing-id")])
                writes = [sql for sql, _ in calls if sql.startswith(("insert", "update", "delete"))]
                self.assertEqual(len(writes), 0 if existing_source else 1)
                self.assertTrue(all("into sources" in sql for sql in writes))

    def test_ambiguous_locations_are_held_without_any_writes(self):
        from scrapers import public_candidates as pipeline
        item = contract_item()
        base = {**item["fields"], "id": "existing-id", "slug": "manual-slug", "is_sample": False,
                "is_active": True}
        cases = [[{**base, "address": "999 Different Avenue"}],
                 [{**base, "name": "Other Gym"}], [base, base], [{**base, "address": None}],
                 [{**base, "is_sample": True}], [{**base, "is_active": False}]]
        for gyms in cases:
            connection, calls = mock_postgres(gyms=gyms)
            with patch("psycopg.connect", return_value=connection), \
                    patch.dict(os.environ, {"DATABASE_URL": "postgresql://synthetic-contract"}):
                outcomes = pipeline.apply_batch([item], 3)
            self.assertEqual(outcomes, [(item["id"], "review", "ambiguous_location")])
            self.assertFalse(any(sql.startswith(("insert", "update", "delete")) for sql, _ in calls))

    def test_max_new_caps_actual_inserts_before_creating_places_or_sources(self):
        from scrapers import public_candidates as pipeline
        first = contract_item()
        record = json.loads(json.dumps(first["record"]).replace("Potomac", "Capitol")
                            .replace("potomac", "capitol").replace("123 Example", "456 Example"))
        second = pipeline.validate(record, now=NOW)
        connection, calls = mock_postgres()
        with patch("psycopg.connect", return_value=connection), \
                patch.dict(os.environ, {"DATABASE_URL": "postgresql://synthetic-contract"}):
            outcomes = pipeline.apply_batch([first, second], 1)
        self.assertEqual(outcomes, [(first["id"], "inserted", "gyms-id"),
                                    (second["id"], "deferred", "new_gym_cap")])
        self.assertEqual(sum(sql.startswith("insert into gyms") for sql, _ in calls), 1)
        self.assertEqual(sum(sql.startswith("insert into sources") for sql, _ in calls), 1)


class ApplyCLI(unittest.TestCase):
    def test_synthetic_stale_and_tampered_queue_records_never_connect(self):
        from scrapers import public_candidates as pipeline
        for mode in ("synthetic", "stale", "tampered"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                queue, source = Path(directory) / "queue.sqlite3", Path(directory) / "input.jsonl"
                record = candidate() if mode == "synthetic" else contract_item()["record"]
                source.write_text(json.dumps(record) + "\n")
                invoke("ingest", "--input", source, "--queue", queue)
                if mode == "tampered":
                    with sqlite3.connect(queue) as local:
                        local.execute("UPDATE candidates SET payload='{}'")
                if mode == "stale":
                    with sqlite3.connect(queue) as local:
                        payload = local.execute("SELECT payload FROM candidates").fetchone()[0]
                        payload = payload.replace("2026-09-23", "2020-01-01")
                        local.execute("UPDATE candidates SET payload=?", (payload,))
                with patch("psycopg.connect", side_effect=AssertionError("Unsafe apply")), \
                        patch.dict(os.environ, {"DATABASE_URL": "postgresql://synthetic-contract"}):
                    code, report = invoke("run", "--queue", queue, "--apply")
                self.assertEqual(code, 1)
                self.assertEqual(report["inserted"], 0)
                self.assertEqual(report["queue"]["review"], 1)
                expected = {"synthetic": "synthetic_not_publishable", "stale": "stale_evidence", "tampered": "queue_corrupt"}[mode]
                self.assertEqual(report["reasons"], {expected: 1})

    def test_database_errors_rollback_leave_pending_and_redact_secrets(self):
        import psycopg
        for stage in ("connect", "statement", "commit"):
            with self.subTest(stage=stage), tempfile.TemporaryDirectory() as directory:
                queue, source = Path(directory) / "queue.sqlite3", Path(directory) / "input.jsonl"
                source.write_text(json.dumps(contract_item()["record"]) + "\n")
                invoke("ingest", "--input", source, "--queue", queue)
                before = queue.read_bytes()
                connection, calls = mock_postgres()
                error = psycopg.OperationalError("SYNTHETIC_SECRET postgres://credentials")
                if stage == "commit":
                    connection.__exit__.side_effect = error
                if stage == "statement":
                    connection.__enter__.return_value.cursor.return_value.__enter__.return_value.execute.side_effect = error
                with patch.dict(os.environ, {"DATABASE_URL": "postgresql://synthetic-contract"}), \
                        patch("psycopg.connect", side_effect=error if stage == "connect" else None,
                              return_value=connection):
                    code, report = invoke("run", "--queue", queue, "--apply")
                self.assertEqual(code, 2)
                self.assertEqual(report["status"], "blocked")
                self.assertEqual(report["inserted"], 0)
                self.assertEqual(report["reasons"], {"database_error": 1})
                self.assertEqual(report["database_outcome"], "unknown_retry_safe")
                self.assertEqual(queue.read_bytes(), before)
                self.assertNotIn("SYNTHETIC_SECRET", json.dumps(report))

    def test_cap_and_ambiguity_outcomes_persist_without_losing_pending_work(self):
        for mode in ("cap", "ambiguity"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                queue, source = Path(directory) / "queue.sqlite3", Path(directory) / "input.jsonl"
                item = contract_item()
                extra = json.loads(json.dumps(item["record"]).replace("Potomac", "Capitol")
                                   .replace("potomac", "capitol").replace("123 Example", "456 Example"))
                source.write_text(json.dumps(item["record"]) + "\n" + json.dumps(extra) + "\n")
                invoke("ingest", "--input", source, "--queue", queue)
                gym = {**item["fields"], "id": "old-id", "slug": "old", "address": "999 Other Avenue",
                       "is_sample": False, "is_active": True}
                connection, calls = mock_postgres(gyms=[gym] if mode == "ambiguity" else [])
                with patch.dict(os.environ, {"DATABASE_URL": "postgresql://synthetic-contract"}), \
                        patch("psycopg.connect", return_value=connection):
                    code, report = invoke("run", "--queue", queue, "--apply", "--max-new", 1)
                self.assertNotEqual(code, 0)
                self.assertEqual(report["inserted"], 1)
                if mode == "cap":
                    self.assertEqual(report["queue"]["pending"], 1)
                    self.assertEqual(report["deferred"], 1)
                    self.assertEqual(report["reasons"], {"new_gym_cap": 1})
                else:
                    self.assertEqual(report["queue"]["review"], 1)
                    self.assertEqual(report["reasons"], {"ambiguous_location": 1})

    def test_apply_inserts_only_public_fields_with_private_provenance_under_lock(self):
        from scrapers import public_candidates as pipeline
        record = candidate()
        # Explicit synthetic contract test, NEVER submit this to a live DB.
        record = json.loads(json.dumps(record).replace(".example", "-fixture.com"))
        record["synthetic"] = False
        from unittest.mock import MagicMock
        pg, cur = MagicMock(), MagicMock()
        pg.cursor.return_value.__enter__.return_value = cur
        sql_calls = []
        def execute(sql, params=None):
            sql = " ".join(sql.lower().split())
            sql_calls.append((sql, params))
            cur.fetchall.return_value = []
            cur.fetchone.return_value = None
            if sql.startswith("insert into places"):
                cur.fetchone.return_value = {"id": "place-id"}
            if sql.startswith("insert into gyms"):
                cur.fetchone.return_value = {"id": "gym-id"}
            if sql.startswith("insert into sources"):
                cur.fetchone.return_value = {"id": "source-id"}
        cur.execute.side_effect = execute
        with tempfile.TemporaryDirectory() as directory:
            queue, source = Path(directory) / "queue.sqlite3", Path(directory) / "input.jsonl"
            source.write_text(json.dumps(record) + "\n")
            invoke("ingest", "--input", source, "--queue", queue)
            with patch.dict(os.environ, {"DATABASE_URL": "postgresql://synthetic-contract"}), \
                    patch("psycopg.connect") as connect:
                connect.return_value.__enter__.return_value = pg
                code, report = invoke("run", "--queue", queue, "--apply")
            self.assertEqual(code, 0)
            self.assertEqual(report["inserted"], 1)
            self.assertEqual(report["database_outcome"], "committed")
            self.assertEqual(report["queue"]["applied"], 1)
            self.assertEqual(connect.call_args.kwargs["connect_timeout"], 10)
            lock_index = next(i for i, (sql, _) in enumerate(sql_calls) if sql.startswith("lock table"))
            reads = [i for i, (sql, _) in enumerate(sql_calls) if sql.startswith("select")]
            self.assertLess(lock_index, min(reads))
            self.assertIn("places, gyms, sources in share row exclusive mode", sql_calls[lock_index][0])
            inserts = [(sql, args) for sql, args in sql_calls if sql.startswith("insert")]
            self.assertEqual(len(inserts), 3)
            gym_sql, gym_values = next((sql, args) for sql, args in inserts if "into gyms" in sql)
            self.assertNotIn("google_", gym_sql)
            self.assertNotIn("update", gym_sql)
            self.assertIn("is_sample", gym_sql)
            self.assertIn(record["name"], gym_values)
            provenance = json.loads(next(args[-1] for sql, args in inserts if "into sources" in sql))
            self.assertEqual(provenance["gym_id"], "gym-id")
            self.assertEqual(provenance["fields"]["name"], record["name"])
            self.assertEqual(provenance["evidence"], record["evidence"])
            self.assertEqual(provenance["pipeline"], "public-candidates-v1")
            self.assertNotIn("text", provenance["pages"][0])
            self.assertEqual(len(provenance["pages"][0]["text_sha256"]), 64)
            with patch("psycopg.connect", side_effect=AssertionError("Already applied")), \
                    patch.dict(os.environ, {"DATABASE_URL": "postgresql://synthetic-contract"}):
                self.assertEqual(invoke("run", "--queue", queue, "--apply")[1]["inserted"], 0)

    def test_default_run_never_writes_and_missing_credentials_block_before_connect(self):
        from scrapers import public_candidates as pipeline
        self.assertTrue(hasattr(pipeline, "run_queue"), "Dry-run/apply boundary missing")
        with tempfile.TemporaryDirectory() as directory:
            queue = Path(directory) / "queue.sqlite3"
            invoke("ingest", "--input", FIXTURE, "--queue", queue)
            before = queue.read_bytes()
            with patch("psycopg.connect", side_effect=AssertionError("Must not connect")) as connect, \
                    patch.dict(os.environ, {"DATABASE_URL": ""}):
                code, report = invoke("run", "--queue", queue)
                self.assertEqual(code, 0)
                self.assertEqual(report["mode"], "dry_run")
                self.assertEqual(report["eligible"], 1)
                self.assertEqual(report["inserted"], 0)
                self.assertEqual(queue.read_bytes(), before)
                code, report = invoke("run", "--queue", queue, "--apply")
                self.assertEqual(code, 2)
                self.assertEqual(report["status"], "blocked")
                self.assertEqual(report["reasons"], {"missing_database_url": 1})
                connect.assert_not_called()
            self.assertEqual(queue.read_bytes(), before)


class HelpContract(unittest.TestCase):
    def test_help_documents_input_schema_caps_and_operational_caveats(self):
        from scrapers import public_candidates as pipeline
        output = StringIO()
        with redirect_stdout(output), self.assertRaises(SystemExit) as exit_status:
            pipeline.main(["--help"])
        self.assertEqual(exit_status.exception.code, 0)
        for required in ("schema_version", "official_site", "single_location", "redirect_chain", "evidence",
                         "DATABASE_URL", "--max-new", "30 days", "500", "no DNS", "raw page text",
                         "missing_database_url", "ambiguous_location", "source", "dry-run"):
            self.assertIn(required, output.getvalue())


if __name__ == "__main__":
    unittest.main()

"""Offline tests only: example domains and synthetic provider fixtures, never live inference."""
import copy
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import httpx

from scrapers import jev_triage as triage

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scrapers/jev_triage.py"
FIXTURE = Path(__file__).parent / "fixtures/synthetic_public.jsonl"


class SavedCorpusCLI(unittest.TestCase):
    def test_saved_corpus_cli_caps_calls_and_honors_explicit_limit_and_model(self):
        from contextlib import redirect_stderr
        from io import StringIO
        for flags, count in (([], 10), (["--limit", "1", "--model", "jev-1.12.0"], 1)):
            with self.subTest(flags=flags), tempfile.TemporaryDirectory() as directory:
                source, report = Path(directory) / "input.jsonl", Path(directory) / "report.jsonl"
                source.write_text(FIXTURE.read_text() * 12)
                requests = []
                def respond(request):
                    requests.append(request)
                    return httpx.Response(200, json=fixture_response())
                client_class = httpx.Client
                with patch.dict(os.environ, {"TYPESAFE_API_KEY": "synthetic-key"}), \
                        patch.object(triage.httpx, "Client", side_effect=lambda **kw: client_class(
                            transport=httpx.MockTransport(respond))), redirect_stderr(StringIO()):
                    code = triage.main(["--input", str(source), "--report", str(report), *flags])
                self.assertEqual(len(requests), count)
                rows = [json.loads(line) for line in report.read_text().splitlines()]
                self.assertEqual(len(rows), count)
                self.assertEqual(code, 2)  # unprocessed records: never a silent complete batch
                self.assertTrue(rows[-1]["record_limit_reached"])
                self.assertEqual(rows[-1]["input_line"], count)
                self.assertEqual(rows[0]["requested_model"], "jev-1.12.0" if flags else "jev-1.13.0")

    def test_cli_invalid_model_exits_before_opening_files_or_evaluating(self):
        from contextlib import redirect_stderr
        from io import StringIO
        for origin in ("flag", "environment"):
            for model in ("latest", "SYNTHETIC_SECRET", ""):
                with self.subTest(origin=origin, model=model), tempfile.TemporaryDirectory() as directory:
                    source, report = Path(directory) / "source.jsonl", Path(directory) / "report.jsonl"
                    source.write_text(FIXTURE.read_text())
                    report.write_text("existing report\n")
                    flags = ["--model", model] if origin == "flag" else []
                    env = {"TYPESAFE_MODEL": model if origin == "environment" else triage.DEFAULT_MODEL,
                           "TYPESAFE_API_KEY": "synthetic-key"}
                    stderr = StringIO()
                    with patch.dict(os.environ, env), redirect_stderr(stderr), \
                            patch.object(Path, "open", autospec=True, side_effect=Path.open) as opened, \
                            patch.object(triage, "evaluate", wraps=triage.evaluate) as evaluate:
                        code = triage.main(["--input", str(source), "--report", str(report), *flags])
                    self.assertEqual(code, 2)
                    self.assertEqual(stderr.getvalue(), "invalid_model\n")
                    opened.assert_not_called()
                    evaluate.assert_not_called()
                    self.assertEqual(report.read_text(), "existing report\n")

    def test_cli_refuses_source_report_aliases_and_invalid_limits(self):
        env = {**os.environ, "TYPESAFE_API_KEY": ""}
        for mode in ("same", "symlink", "hardlink", "zero", "negative", "large"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                source, report = Path(directory) / "source.jsonl", Path(directory) / "report.jsonl"
                original = FIXTURE.read_text()
                source.write_text(original)
                if mode == "same":
                    report = source
                elif mode == "symlink":
                    report.symlink_to(source)
                elif mode == "hardlink":
                    report.hardlink_to(source)
                limit = {"zero": "0", "negative": "-1", "large": "11"}.get(mode, "1")
                result = subprocess.run([sys.executable, str(SCRIPT), "--input", str(source),
                                         "--report", str(report), "--limit", limit],
                                        env=env, capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(source.read_text(), original)
                self.assertNotIn(directory, result.stderr)

    def test_cli_oversized_line_aborts_without_draining_or_peeking(self):
        from contextlib import nullcontext, redirect_stderr
        from io import BytesIO, StringIO
        for limit in (1, 10):
            for remainder in (b"", b"\n" + FIXTURE.read_bytes(), b"still first line\n" + FIXTURE.read_bytes()):
                with self.subTest(limit=limit, remainder_bytes=len(remainder)), tempfile.TemporaryDirectory() as directory:
                    source_path, report = Path(directory) / "source.jsonl", Path(directory) / "report.jsonl"
                    source_path.write_bytes(b"")
                    source = BytesIO(b"x" * 2_000_001 + remainder)
                    real_open = Path.open
                    def open_file(path, *args, **kwargs):
                        return nullcontext(source) if path == source_path else real_open(path, *args, **kwargs)
                    stderr = StringIO()
                    with patch.object(Path, "open", autospec=True, side_effect=open_file), \
                            patch.object(source, "readline", wraps=source.readline) as readline, \
                            patch.object(source, "read", wraps=source.read) as read, \
                            patch.object(triage.httpx, "Client") as client, \
                            patch.dict(os.environ, {"TYPESAFE_MODEL": triage.DEFAULT_MODEL}), redirect_stderr(stderr):
                        code = triage.main(["--input", str(source_path), "--report", str(report),
                                            "--limit", str(limit)])
                    readline.assert_called_once_with(2_000_001)
                    read.assert_not_called()  # Even a one-byte limit probe would inspect unread input.
                    self.assertEqual(source.tell(), 2_000_001)
                    client.assert_not_called()
                    self.assertEqual(code, 2)
                    self.assertEqual(stderr.getvalue(), "batch_aborted_input_too_large\n")
                    rows = [json.loads(line) for line in report.read_text().splitlines()]
                    self.assertEqual(len(rows), 1)
                    self.assertEqual(rows[0]["reasons"], ["input_too_large"])
                    self.assertEqual(rows[0]["status"], "not_evaluated")
                    self.assertTrue(rows[0]["batch_aborted"])
                    self.assertTrue(rows[0]["remaining_input_unchecked"])
                    self.assertIsNone(rows[0]["record_limit_reached"])
                    self.assertEqual(rows[0]["input_line"], 1)

    def test_cli_bad_records_and_io_errors_are_bounded_and_redacted(self):
        env = {**os.environ, "TYPESAFE_API_KEY": ""}
        cases = [(b"{SYNTHETIC_SECRET}\n", "invalid_json"), (b"\xff\n", "invalid_json"),
                 (b"x" * 2_000_001, "input_too_large"),
                 (("[" * 100_000 + "]" * 100_000).encode(), "invalid_json")]
        for contents, reason in cases:
            with self.subTest(reason=reason), tempfile.TemporaryDirectory() as directory:
                source, report = Path(directory) / "source.jsonl", Path(directory) / "report.jsonl"
                source.write_bytes(contents)
                result = subprocess.run([sys.executable, str(SCRIPT), "--input", str(source),
                                         "--report", str(report)], env=env, capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 2 if reason == "input_too_large" else 1)
                self.assertTrue(report.exists())
                lines = report.read_text().splitlines()
                self.assertEqual(len(lines), 1)
                row = json.loads(lines[0])
                self.assertEqual(row["reasons"], [reason])
                self.assertEqual(row["status"], "not_evaluated")
                self.assertNotIn("SYNTHETIC_SECRET", result.stderr + report.read_text())
                self.assertNotIn("Traceback", result.stderr)
        with tempfile.TemporaryDirectory() as directory:
            source, report = Path(directory) / "source.jsonl", Path(directory) / "report.jsonl"
            for mode in ("missing", "empty", "report_directory"):
                if mode != "missing":
                    source.write_text("" if mode == "empty" else FIXTURE.read_text())
                target = directory if mode == "report_directory" else str(report)
                result = subprocess.run([sys.executable, str(SCRIPT), "--input", str(source),
                                         "--report", target], env=env, capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 2)
                self.assertNotIn(directory, result.stderr)
                self.assertNotIn("Traceback", result.stderr)

    def test_missing_key_writes_honest_not_evaluated_report(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / "report.jsonl"
            env = {k: v for k, v in os.environ.items()
                   if k not in {"TYPESAFE_API_KEY", "ANTHROPIC_API_KEY", "DATABASE_URL"}}
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--input", str(FIXTURE), "--report", str(report)],
                capture_output=True, text=True, env=env, timeout=10,
            )
            self.assertEqual(result.returncode, 1, result.stderr)
            row = json.loads(report.read_text())
            self.assertEqual(row["status"], "not_evaluated")
            self.assertEqual(row["recommendation"], "review_candidate")
            self.assertEqual(row["reasons"], ["missing_api_key"])
            self.assertTrue(row["shadow_only"])
            self.assertNotIn("SYNTHETIC TEST FIXTURE", report.read_text())


STYLES = ("muay_thai", "kickboxing", "dutch_kickboxing", "mma", "bjj", "boxing", "wrestling", "judo")


def fixture_choice(selected, options):
    """Synthetic deterministic data, NOT an observed model answer."""
    return {"type": "choice", "choice": selected, "confidence": 0.85,
            "probabilities": {option: 0.98 if option == selected else 0.01 for option in options}}


def fixture_response():
    answers = {
        "gym": fixture_choice("combat_gym", ["combat_gym", "not_combat_gym", "unknown"]),
        "location": fixture_choice("single", ["single", "chain", "unknown"]),
        "evidence": fixture_choice("sufficient", ["sufficient", "insufficient", "unknown"]),
    }
    for style in STYLES:
        answers[style] = fixture_choice("evidenced" if style == "boxing" else "unknown",
                                        ["evidenced", "absent", "unknown"])
    return {"model": "jev-1.13.0", "answers": answers,
            "usage": {"input_tokens": 123, "output_tokens": 42}}


class HTTPBoundary(unittest.TestCase):
    def evaluate_fixture(self, body=None, record=None, **kwargs):
        body = fixture_response() if body is None else body
        record = json.loads(FIXTURE.read_text()) if record is None else record
        with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=body))) as client:
            return triage.evaluate(record, api_key="synthetic-key", client=client, **kwargs)

    def test_conservative_policy_keeps_rejects_or_reviews_not_publishes(self):
        cases = [
            ("gym", "unknown", "review_candidate", "unknown_gym"),
            ("location", "chain", "review_candidate", "location_not_single"),
            ("location", "unknown", "review_candidate", "unknown_location"),
            ("evidence", "unknown", "review_candidate", "unknown_evidence"),
            ("evidence", "insufficient", "review_candidate", "insufficient_evidence"),
            ("gym", "not_combat_gym", "reject_candidate", "explicit_non_gym"),
            ("boxing", "unknown", "review_candidate", "no_evidenced_discipline"),
        ]
        for key, selected, decision, reason in cases:
            with self.subTest(key=key, selected=selected):
                body = fixture_response()
                body["answers"][key] = fixture_choice(selected, body["answers"][key]["probabilities"])
                row = self.evaluate_fixture(body)
                self.assertEqual(row["recommendation"], decision)
                self.assertIn(reason, row["reasons"])
                self.assertTrue(row["shadow_only"])
        for key in ("gym", "location", "evidence", "boxing"):
            for field in ("confidence", "probabilities"):
                with self.subTest(key=key, field=field):
                    body = fixture_response()
                    answer = body["answers"][key]
                    if field == "confidence":
                        answer[field] = 0.49  # independent of selected probability
                    else:
                        answer[field] = {k: 0.79 if k == answer["choice"] else 0.105
                                         for k in answer[field]}
                    self.assertEqual(self.evaluate_fixture(body)["recommendation"], "review_candidate")
        body = fixture_response()
        body["answers"]["gym"] = fixture_choice("not_combat_gym", body["answers"]["gym"]["probabilities"])
        body["answers"]["gym"]["confidence"] = 0.79
        self.assertEqual(self.evaluate_fixture(body)["recommendation"], "review_candidate")

    def test_malformed_provider_data_never_becomes_a_decision(self):
        mutations = [
            lambda b: b["answers"]["gym"].update(type="noul"),
            lambda b: b["answers"]["gym"].update(choice="invented"),
            lambda b: b["answers"]["gym"].pop("confidence"),
            lambda b: b["answers"]["gym"].update(confidence=float("nan")),
            lambda b: b["answers"]["gym"].update(confidence=float("inf")),
            lambda b: b["answers"]["gym"].update(confidence=True),
            lambda b: b["answers"]["gym"].update(confidence=-0.1),
            lambda b: b["answers"]["gym"].update(confidence=1.1),
            lambda b: b["answers"]["gym"].update(confidence="0.9"),
            lambda b: b["answers"]["gym"].update(probabilities={"combat_gym": 1}),
            lambda b: b["answers"]["gym"]["probabilities"].update(combat_gym=0.5),
            lambda b: b["answers"]["gym"]["probabilities"].update(combat_gym=float("nan")),
            lambda b: b["answers"]["gym"]["probabilities"].update(combat_gym=True),
            lambda b: b["answers"]["gym"]["probabilities"].update(combat_gym=-1),
            lambda b: b["answers"].pop("judo"),
            lambda b: b.update(answers=[]),
            lambda b: b["answers"].update(gym=[]),
            lambda b: b.pop("model"),
            lambda b: b.update(model="SYNTHETIC_PROVIDER_SECRET"),
            lambda b: b["usage"].update(input_tokens=-1),
            lambda b: b["usage"].update(output_tokens=True),
            lambda b: b["usage"].pop("output_tokens"),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(mutation=index):
                body = fixture_response()
                mutate(body)
                with httpx.Client(transport=httpx.MockTransport(
                    lambda req: httpx.Response(200, content=json.dumps(body))
                )) as client:
                    row = triage.evaluate(json.loads(FIXTURE.read_text()), api_key="synthetic-key", client=client)
                self.assertEqual(row["status"], "not_evaluated")
                self.assertEqual(row["recommendation"], "review_candidate")
                self.assertEqual(row["reasons"], ["invalid_response"])
                self.assertIsNone(row["answers"])
                self.assertNotIn("SYNTHETIC_PROVIDER_SECRET", json.dumps(row))

    def test_transport_failures_are_bounded_redacted_and_not_retried(self):
        cases = [(401, "http_error"), (429, "http_error"), (500, "http_error"),
                 (302, "http_error"), ("timeout", "timeout"), ("connection", "network_error"),
                 ("not_json", "invalid_response"), ("oversize", "response_too_large")]
        for failure, reason in cases:
            with self.subTest(failure=failure):
                requests = []
                def respond(request):
                    requests.append(request)
                    if failure == "timeout":
                        raise httpx.ReadTimeout("SYNTHETIC_PROVIDER_SECRET", request=request)
                    if failure == "connection":
                        raise httpx.ConnectError("SYNTHETIC_PROVIDER_SECRET", request=request)
                    if failure == "not_json":
                        return httpx.Response(200, text="SYNTHETIC_PROVIDER_SECRET")
                    if failure == "oversize":
                        return httpx.Response(200, text="x" * 65_537)
                    return httpx.Response(failure, json=fixture_response(),
                                          headers={"Location": "https://never-follow.example/"})
                with httpx.Client(transport=httpx.MockTransport(respond), follow_redirects=True) as client:
                    row = triage.evaluate(json.loads(FIXTURE.read_text()), api_key="synthetic-key", client=client)
                self.assertEqual(row["status"], "not_evaluated")
                self.assertEqual(row["reasons"], [reason])
                self.assertEqual(len(requests), 1)
                self.assertEqual(requests[0].extensions["timeout"],
                                 {"connect": 15.0, "read": 15.0, "write": 15.0, "pool": 15.0})
                self.assertGreaterEqual(row["latency_ms"], 0)
                self.assertNotIn("SYNTHETIC_PROVIDER_SECRET", json.dumps(row))

    def test_selected_choice_must_have_max_probability_ties_allowed(self):
        body = fixture_response()
        body["answers"]["gym"]["choice"] = "not_combat_gym"
        self.assertEqual(self.evaluate_fixture(body)["reasons"], ["invalid_response"])
        body["answers"]["gym"]["probabilities"] = {"combat_gym": 0.5, "not_combat_gym": 0.5, "unknown": 0}
        self.assertEqual(self.evaluate_fixture(body)["status"], "evaluated")

    def test_nonpublic_malformed_or_sensitive_input_is_never_sent(self):
        not_public = json.loads(FIXTURE.read_text())
        not_public["public_content"] = False
        invalid = [not_public, None, {}, {"public_content": False, "pages": []},
                   {"public_content": 1, "pages": []}, {"public_content": True, "pages": []},
                   {"public_content": True, "pages": [{"url": "https://gym.example/", "text": 3}]}]
        urls = ["ftp://gym.example/", "http://localhost/", "http://printer/", "http://gym.internal/",
                "http://127.0.0.1/", "http://10.0.0.1/", "http://169.254.169.254/",
                "http://[::1]/", "http://[fc00::1]/", "http://2130706433/", "http://127.1/",
                "https://user:secret@gym.example/", "https://gym.example/?token=SYNTHETIC_SECRET",
                "https://gym.example/#SYNTHETIC_SECRET", "https://gym.example:9999/",
                "https://gym.example/account/private", "https://gym.example/\\nsecret"]
        for url in urls:
            invalid.append({"public_content": True, "pages": [{"url": url, "text": "synthetic"}]})
        for text in ("Bearer SYNTHETIC_SECRET", "password=SYNTHETIC_SECRET", "synthetic-key",
                     "-----BEGIN PRIVATE KEY-----", "patient record: SYNTHETIC_SECRET", "123-45-6789"):
            record = json.loads(FIXTURE.read_text())
            record["pages"][0]["text"] = text
            invalid.append(record)
        for index, record in enumerate(invalid):
            with self.subTest(case=index):
                def never_send(request):
                    self.fail("Unsafe input crossed the HTTP boundary")
                with httpx.Client(transport=httpx.MockTransport(never_send)) as client:
                    row = triage.evaluate(record, api_key="synthetic-key", client=client)
                self.assertEqual(row["status"], "not_evaluated")
                self.assertEqual(row["recommendation"], "review_candidate")
                self.assertEqual(row["source_urls"], [])
                self.assertNotIn("SYNTHETIC_SECRET", json.dumps(row))

    def test_bounded_subset_is_flagged_and_can_only_recommend_review(self):
        for pages in ([{"url": "https://gym.example/", "text": "synthetic " * 3_000}],
                      [{"url": f"https://gym.example/page-{i}", "text": "synthetic"} for i in range(8)]):
            for gym_choice in ("combat_gym", "not_combat_gym"):
                with self.subTest(pages=len(pages), gym=gym_choice):
                    sent = []
                    body = fixture_response()
                    body["answers"]["gym"] = fixture_choice(gym_choice, body["answers"]["gym"]["probabilities"])
                    def respond(request):
                        sent.append(json.loads(request.content)["state"])
                        return httpx.Response(200, json=body)
                    record = {"public_content": True, "pages": copy.deepcopy(pages)}
                    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
                        row = triage.evaluate(record, api_key="synthetic-key", client=client)
                    self.assertLessEqual(len(sent[0]["pages"]), 6)
                    self.assertLessEqual(len(triage.canonical(sent[0])), 20_000)
                    self.assertTrue(row["truncated"])
                    self.assertEqual(row["recommendation"], "review_candidate")
                    self.assertIn("input_truncated", row["reasons"])
                    self.assertEqual(row["source_pages"], len(pages))
                    self.assertEqual(row["sent_pages"], len(sent[0]["pages"]))
                    self.assertEqual(row["omitted_pages"], len(pages) - row["sent_pages"])
                    self.assertEqual(row["input_hash"], hashlib.sha256(triage.canonical(sent[0]).encode()).hexdigest())
                    self.assertEqual(record["pages"], pages)

    def test_model_override_records_requested_and_resolved_versions(self):
        requests = []
        def respond(request):
            requests.append(json.loads(request.content))
            return httpx.Response(200, json=fixture_response())
        with httpx.Client(transport=httpx.MockTransport(respond)) as client:
            with patch.dict(os.environ, {"TYPESAFE_MODEL": "jev-1.12.0"}):
                row = triage.evaluate(json.loads(FIXTURE.read_text()), api_key="synthetic-key", client=client)
            self.assertEqual(requests[-1]["model"], "jev-1.12.0")
            self.assertEqual(row["requested_model"], "jev-1.12.0")
            self.assertEqual(row["response_model"], "jev-1.13.0")
            row = triage.evaluate(json.loads(FIXTURE.read_text()), api_key="synthetic-key", client=client,
                                  model="jev-1.11.0")
            self.assertEqual(requests[-1]["model"], "jev-1.11.0")
            row = triage.evaluate(json.loads(FIXTURE.read_text()), api_key="synthetic-key", client=client,
                                  model="SYNTHETIC_SECRET")
            self.assertEqual(len(requests), 2)
            self.assertEqual(row["reasons"], ["invalid_model"])
            self.assertIsNone(row["requested_model"])

    def test_extreme_invalid_responses_return_sanitized_failure(self):
        body = fixture_response()
        body["answers"]["gym"]["confidence"] = 10 ** 1000
        for content in (json.dumps(body), "[" * 20_000 + "]" * 20_000):
            with self.subTest(length=len(content)), httpx.Client(transport=httpx.MockTransport(
                lambda req: httpx.Response(200, content=content)
            )) as client:
                try:
                    row = triage.evaluate(json.loads(FIXTURE.read_text()), api_key="synthetic-key", client=client)
                except Exception as error:
                    self.fail(f"Malformed response escaped: {type(error).__name__}")
                self.assertEqual(row["reasons"], ["invalid_response"])
                self.assertEqual(row["status"], "not_evaluated")

    def test_embedded_credentials_and_invalid_unicode_do_not_cross_boundary(self):
        texts = ['{"password": "SYNTHETIC_SECRET"}', "https://user:pass@gym.example/",
                 "https://gym.example/?token=SYNTHETIC_SECRET", "Authorization: Basic U1lOVEhFVElD",
                 "https://gym.example/synthetic%2Dkey", "synthetic \ud800"]
        for text in texts:
            record = json.loads(FIXTURE.read_text())
            record["pages"][0]["text"] = text
            with self.subTest(text=ascii(text)), httpx.Client(transport=httpx.MockTransport(
                lambda req: self.fail("Sensitive/invalid input crossed HTTP boundary")
            )) as client:
                try:
                    row = triage.evaluate(record, api_key="synthetic-key", client=client)
                except Exception as error:
                    self.fail(f"Invalid input escaped: {type(error).__name__}")
                self.assertEqual(row["status"], "not_evaluated")
                self.assertEqual(row["source_urls"], [])
                self.assertNotIn("SYNTHETIC_SECRET", json.dumps(row))

    def test_synthetic_success_uses_typed_api_and_auditable_report(self):
        import inspect
        self.assertIn("client", inspect.signature(triage.evaluate).parameters,
                      "Triage needs an injectable HTTP boundary")
        record = json.loads(FIXTURE.read_text())
        original = copy.deepcopy(record)
        requests = []

        def respond(request):
            requests.append(request)
            self.assertEqual(str(request.url), "https://api.typesafe.ai/v1/systemone")
            self.assertEqual(request.method, "POST")
            self.assertEqual(request.headers["Authorization"], "Bearer synthetic-key")
            payload = json.loads(request.content)
            self.assertEqual(payload["model"], "jev-1.13.0")
            self.assertEqual(payload["state"], {"pages": record["pages"]})
            self.assertEqual(set(payload["questions"]), set(fixture_response()["answers"]))
            for question in payload["questions"].values():
                self.assertEqual(question["type"], "choice")
                self.assertIn("unknown", question["criteria"])
                self.assertIn("untrusted", question["instructions"])
            return httpx.Response(200, json=fixture_response())

        with httpx.Client(transport=httpx.MockTransport(respond)) as client:
            row = triage.evaluate(record, api_key="synthetic-key", client=client)
        self.assertEqual(len(requests), 1)
        self.assertEqual(record, original)
        self.assertEqual(row["status"], "evaluated")
        self.assertEqual(row["recommendation"], "keep_candidate")
        self.assertTrue(row["shadow_only"])
        self.assertEqual(row["evidenced_disciplines"], ["boxing"])
        self.assertEqual(row["answers"]["gym"]["confidence"], 0.85)
        self.assertEqual(row["answers"]["gym"]["probabilities"]["combat_gym"], 0.98)
        self.assertEqual(row["requested_model"], "jev-1.13.0")
        self.assertEqual(row["response_model"], "jev-1.13.0")
        self.assertEqual(row["usage"], {"input_tokens": 123, "output_tokens": 42})
        self.assertEqual(row["schema_version"], "1")
        self.assertEqual(row["rubric_version"], "fightgyms-triage-1")
        self.assertEqual(row["policy_version"], "shadow-1")
        self.assertEqual(row["source_urls"], [record["pages"][0]["url"]])
        canonical = json.dumps({"pages": record["pages"]}, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        self.assertEqual(row["input_hash"], hashlib.sha256(canonical.encode()).hexdigest())
        self.assertIsNotNone(datetime.fromisoformat(row["timestamp"]).tzinfo)
        self.assertGreaterEqual(row["latency_ms"], 0)
        self.assertFalse(row["truncated"])
        self.assertNotIn("SYNTHETIC TEST FIXTURE", json.dumps(row))
        self.assertNotIn("synthetic-key", json.dumps(row))


if __name__ == "__main__":
    unittest.main()

"""Synthetic integration fixtures; crawl, Anthropic, and DB boundaries are replaced."""
import copy
import inspect
import json
import tempfile
import unittest
from contextlib import ExitStack, redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import httpx

from scrapers import extract_site, jev_triage
from scrapers.tests.test_jev_triage import fixture_choice, fixture_response


class ScraperShadow(unittest.TestCase):
    def run_process(self, *, pages=None, shadow_report=None, source_provenance=None, **kwargs):
        pages = pages if pages is not None else {"https://synthetic-gym.example/": "Synthetic boxing, monthly $100."}
        out = {"prices": [{"kind": "monthly", "amount_usd": 100, "source_url": next(iter(pages)),
                           "quote": "monthly $100"}], "classes": [], "coaches": [],
               "styles": ["boxing"], "tags": []}
        gym = {"id": "synthetic-id", "slug": "synthetic-gym", "website": next(iter(pages))}
        def crawl(base, *, provenance=None):
            if provenance is not None:
                provenance.update({url: [url] for url in pages}
                                  if source_provenance is None else source_provenance)
            return pages, "synthetic-widget"
        with ExitStack() as stack:
            stdout, stderr = StringIO(), StringIO()
            stack.enter_context(redirect_stdout(stdout))
            stack.enter_context(redirect_stderr(stderr))
            stack.enter_context(patch.object(extract_site, "crawl", side_effect=crawl))
            extract = stack.enter_context(patch.object(extract_site, "extract", return_value=copy.deepcopy(out)))
            db = stack.enter_context(patch.object(extract_site, "conn"))
            add_source = stack.enter_context(patch.object(extract_site, "add_source", return_value="synthetic-source"))
            insert = stack.enter_context(patch.object(extract_site, "insert_price"))
            replace = stack.enter_context(patch.object(extract_site, "replace_classes"))
            arguments = {} if shadow_report is None else {"shadow_report": shadow_report}
            extract_site.process(gym, dry_run=False, **arguments, **kwargs)
            extract.assert_called_once_with(pages)
            self.assertIs(extract.call_args.args[0], pages)
            db.assert_called_once()
            return {"source": add_source.call_args.args[1:], "price": insert.call_args.args[1:],
                    "classes": replace.call_args.args[1:], "db_calls": db.mock_calls,
                    "stdout": stdout.getvalue(), "stderr": stderr.getvalue()}

    def run_redirect_process(self, chain, *, shadow):
        """Exercise the real crawler with synthetic redirects; no network or DB."""
        text = "Synthetic internal dashboard: boxing, monthly $100."
        pages = {chain[0]: text}
        gym = {"id": "synthetic-id", "slug": "synthetic-gym", "website": chain[0]}
        fetched, sent = [], []
        def respond(request):
            if request.method == "POST":
                self.assertEqual(str(request.url), jev_triage.ENDPOINT)
                sent.append(json.loads(request.content))
                return httpx.Response(200, json=fixture_response())
            url = str(request.url)
            fetched.append(url)
            index = chain.index(url)
            if index < len(chain) - 1:
                return httpx.Response(302, headers={"Location": chain[index + 1]})
            return httpx.Response(200, text=f"<html><body>{text}</body></html>",
                                  headers={"Content-Type": "text/html"})
        client_class = httpx.Client
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            report = Path(directory) / "report.jsonl"
            stdout = stack.enter_context(redirect_stdout(StringIO()))
            stderr = stack.enter_context(redirect_stderr(StringIO()))
            stack.enter_context(patch.dict("os.environ", {"TYPESAFE_API_KEY": "synthetic-key"}))
            stack.enter_context(patch.object(httpx, "Client", side_effect=lambda **kw: client_class(
                transport=httpx.MockTransport(respond), **kw)))
            stack.enter_context(patch.object(extract_site.trafilatura, "extract", return_value=text))
            crawl = stack.enter_context(patch.object(extract_site, "crawl", wraps=extract_site.crawl))
            extract = stack.enter_context(patch.object(extract_site, "extract", return_value={
                "prices": [{"kind": "monthly", "amount_usd": 100, "source_url": chain[0],
                            "quote": "monthly $100"}], "classes": [], "coaches": [],
                "styles": ["boxing"], "tags": []}))
            db = stack.enter_context(patch.object(extract_site, "conn"))
            extract_site.process(gym, dry_run=True, **({"shadow_report": report} if shadow else {}))
            extract.assert_called_once_with(pages)
            db.assert_not_called()
            self.assertEqual(fetched, chain)
            if shadow:
                self.assertEqual(crawl.call_args.kwargs, {"provenance": {chain[0]: chain}})
            else:
                crawl.assert_called_once_with(chain[0])
            return stdout.getvalue(), stderr.getvalue(), sent, json.loads(report.read_text()) if shadow else {}

    def test_public_redirect_uses_final_shadow_source_without_changing_extraction(self):
        chain = ["https://gym.example/", "https://www.gym.example/", "https://gym.example/classes"]
        baseline = self.run_redirect_process(chain, shadow=False)
        stdout, stderr, sent, row = self.run_redirect_process(chain, shadow=True)
        self.assertEqual((stdout, stderr), baseline[:2])
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]["state"]["pages"], [{
            "url": chain[-1], "text": "Synthetic internal dashboard: boxing, monthly $100."}])
        self.assertEqual(row["status"], "evaluated")
        self.assertEqual(row["source_urls"], [chain[-1]])

    def test_private_redirect_never_sends_text_but_preserves_extraction(self):
        chain = ["https://gym.example/", "http://127.0.0.1/internal-dashboard"]
        baseline = self.run_redirect_process(chain, shadow=False)
        stdout, stderr, sent, row = self.run_redirect_process(chain, shadow=True)
        self.assertEqual((stdout, stderr), baseline[:2])
        self.assertEqual(sent, [], "Private-source text must never reach TypeSafe")
        self.assertEqual(row["status"], "not_evaluated")
        self.assertEqual(row["reasons"], ["unsafe_or_unknown_provenance"])
        self.assertEqual(row["source_urls"], [])
        self.assertNotIn("127.0.0.1", json.dumps(row))
        self.assertNotIn("Synthetic internal dashboard", json.dumps(row))

    def test_unsafe_intermediate_redirect_never_sends_text(self):
        for intermediate in ("http://127.0.0.1/internal-dashboard", "http://10.0.0.1/",
                             "https://gym.example/account", "https://gym.example/?token=SYNTHETIC_SECRET"):
            with self.subTest(intermediate=intermediate):
                chain = ["https://gym.example/", intermediate, "https://public-gym.example/classes"]
                baseline = self.run_redirect_process(chain, shadow=False)
                stdout, stderr, sent, row = self.run_redirect_process(chain, shadow=True)
                self.assertEqual((stdout, stderr), baseline[:2])
                self.assertEqual(len(sent), 0)
                self.assertEqual(row["reasons"], ["unsafe_or_unknown_provenance"])
                self.assertEqual(row["source_urls"], [])
                self.assertNotIn("SYNTHETIC_SECRET", json.dumps(row))

    def test_unknown_provenance_never_auto_attests_crawled_text(self):
        url = "https://synthetic-gym.example/"
        for provenance in ({}, {url: []}, {url: None}, {url: [None]}, {url: url}):
            with self.subTest(provenance=provenance), tempfile.TemporaryDirectory() as directory:
                report = Path(directory) / "report.jsonl"
                baseline = self.run_process()
                requests = []
                client_class = httpx.Client
                def respond(request):
                    requests.append(request)
                    return httpx.Response(200, json=fixture_response())
                with patch.dict("os.environ", {"TYPESAFE_API_KEY": "synthetic-key"}), \
                        patch.object(httpx, "Client", side_effect=lambda **kw: client_class(
                            transport=httpx.MockTransport(respond), **kw)):
                    actual = self.run_process(shadow_report=report, source_provenance=provenance)
                self.assertEqual(actual, baseline)
                self.assertEqual(len(requests), 0)
                row = json.loads(report.read_text())
                self.assertEqual(row["status"], "not_evaluated")
                self.assertEqual(row["reasons"], ["unsafe_or_unknown_provenance"])
                self.assertEqual(row["source_urls"], [])

    def test_shadow_reject_does_not_gate_or_change_extractor_or_db_writes(self):
        self.assertIn("shadow_report", inspect.signature(extract_site.process).parameters)
        baseline = self.run_process()
        body = fixture_response()
        body["answers"]["gym"] = fixture_choice("not_combat_gym", body["answers"]["gym"]["probabilities"])
        original_client = httpx.Client
        with tempfile.TemporaryDirectory() as directory, patch.dict("os.environ", {"TYPESAFE_API_KEY": "synthetic-key"}):
            report = Path(directory) / "report.jsonl"
            with patch.object(jev_triage.httpx, "Client", side_effect=lambda **kw: original_client(
                transport=httpx.MockTransport(lambda req: httpx.Response(200, json=body))
            )):
                actual = self.run_process(shadow_report=report)
            self.assertEqual(actual, baseline)
            row = json.loads(report.read_text())
            self.assertEqual(row["recommendation"], "reject_candidate")
            self.assertTrue(row["shadow_only"])

    def test_shadow_failures_and_truncation_never_gate_the_original_path(self):
        for mode in ("exception", "write_error", "missing_key", "http_error", "truncated", "unsafe"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                pages = {"https://synthetic-gym.example/": "Synthetic boxing, monthly $100."}
                if mode == "truncated":
                    pages[next(iter(pages))] += " synthetic" * 3_000
                if mode == "unsafe":
                    pages[next(iter(pages))] += " password=SYNTHETIC_SECRET"
                before = copy.deepcopy(pages)
                baseline = self.run_process(pages=pages)
                report = Path(directory) if mode == "write_error" else Path(directory) / "report.jsonl"
                client_class = httpx.Client
                with ExitStack() as stack:
                    stack.enter_context(patch.dict("os.environ", {"TYPESAFE_API_KEY": "" if mode == "missing_key" else "synthetic-key"}))
                    stack.enter_context(patch.object(jev_triage.httpx, "Client", side_effect=lambda **kw: client_class(
                        transport=httpx.MockTransport(lambda req: httpx.Response(
                            500 if mode == "http_error" else 200, json=fixture_response())))))
                    if mode == "exception":
                        stack.enter_context(patch.object(jev_triage, "evaluate", side_effect=RuntimeError("SYNTHETIC_SECRET")))
                    try:
                        actual = self.run_process(pages=pages, shadow_report=report)
                    except Exception as error:
                        self.fail(f"Shadow failure escaped into extraction: {type(error).__name__}")
                self.assertNotIn("SYNTHETIC_SECRET", actual["stderr"])
                actual.pop("stderr")
                baseline.pop("stderr")
                self.assertEqual(actual, baseline)
                self.assertEqual(pages, before)
                if mode not in ("exception", "write_error"):
                    row = json.loads(report.read_text())
                    self.assertEqual(row["recommendation"], "review_candidate")
                    self.assertEqual(row["status"], "evaluated" if mode == "truncated" else "not_evaluated")

    def test_scraper_cli_limits_only_shadow_not_existing_extraction(self):
        gyms = [{"id": str(i), "slug": f"synthetic-{i}", "website": "https://synthetic-gym.example/"}
                for i in range(12)]
        for flags, expected_shadow in (([], 0), (["--shadow-report", "synthetic-report.jsonl"], 10),
                (["--shadow-report", "synthetic-report.jsonl", "--shadow-limit", "1",
                  "--shadow-model", "jev-1.12.0"], 1)):
            with self.subTest(flags=flags), patch("sys.argv", ["extract_site.py", "--dry-run", *flags]), \
                    patch.object(extract_site, "conn") as conn, \
                    patch.object(extract_site, "process") as process, redirect_stderr(StringIO()):
                conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value.fetchall.return_value = gyms
                try:
                    extract_site.main()
                except SystemExit as error:
                    self.fail(f"Shadow CLI flags are not supported: exit {error.code}")
                self.assertEqual(process.call_count, 12)
                enabled = [call for call in process.call_args_list if call.kwargs.get("shadow_report")]
                self.assertEqual(len(enabled), expected_shadow)
                for index, call in enumerate(process.call_args_list):
                    self.assertEqual(call.args, (gyms[index], True))
                if expected_shadow == 1:
                    self.assertEqual(enabled[0].kwargs["shadow_model"], "jev-1.12.0")
        with patch("sys.argv", ["extract_site.py", "--shadow-report", "synthetic-report.jsonl", "--shadow-limit", "11"]), \
                patch.object(extract_site, "conn") as conn, redirect_stderr(StringIO()):
            with self.assertRaises(SystemExit) as error:
                extract_site.main()
            self.assertEqual(error.exception.code, 2)
            conn.assert_not_called()

    def test_disabled_mode_never_evaluates(self):
        with patch.object(jev_triage, "evaluate", side_effect=AssertionError("disabled")) as evaluate:
            self.run_process()
            evaluate.assert_not_called()


if __name__ == "__main__":
    unittest.main()

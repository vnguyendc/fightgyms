"""Offline synthetic evidence tests; never make API calls or database connections."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from contextlib import redirect_stdout
from io import StringIO
from types import SimpleNamespace
from unittest.mock import patch

import httpx

from scrapers.audit_sites import Budget, coverage, extract, load_manifest, restore_source_ids, source_clock, validate, messages
from scrapers.common import site_evidence as ev


def fixture():
    source = {'id': 's1', 'url': 'https://gym.example/pricing', 'mode': 'html',
              'text': 'Adult monthly unlimited $169.99. Free trial. Monday Boxing 6:00 PM to 7:00 PM.', 'captured_at': '2026-11-02'}
    price = {'source_id': 's1', 'quote': 'Adult monthly unlimited $169.99.', 'plan': 'Unlimited',
             'amount_usd': 169.99, 'period': 'month', 'audience': 'adult', 'location': None}
    cls = {'source_id': 's1', 'quote': 'Monday Boxing 6:00 PM to 7:00 PM.', 'name': 'Boxing', 'dow': 1,
           'day_text': 'Monday', 'start': '18:00', 'start_text': '6:00 PM', 'end': '19:00', 'end_text': '7:00 PM'}
    return source, price, cls


class ValidationTests(unittest.TestCase):
    def test_exact_cents_quote_and_time_are_required(self):
        source, price, cls = fixture()
        good = validate({'prices': [price], 'classes': [cls]}, [source], {'slug': 'synthetic'})
        self.assertEqual(len(good['facts']), 2)
        for changes in ({'amount_usd': 169.42}, {'quote': 'fabricated $169.99 monthly'}, {'amount_usd': True}, {'amount_usd': float('nan')}):
            with self.subTest(changes=changes):
                out = validate({'prices': [{**price, **changes}]}, [source], {'slug': 'synthetic'})
                self.assertEqual(len(out['facts']), 0)
        for changes in ({'start': '99:99'}, {'start': '06:00'}, {'dow': 2}, {'end': '18:30'}, {'name': 'Wrestling'}):
            with self.subTest(changes=changes):
                self.assertFalse(validate({'classes': [{**cls, **changes}]}, [source], {'slug': 'synthetic'})['facts'])

    def test_four_week_and_youth_rates_never_become_adult_monthly(self):
        source, price, _ = fixture()
        for text in ('Kids $169.99 monthly.', 'Adult $169.99 every four weeks.'):
            source['text'] = text
            price['quote'] = text
            self.assertFalse(validate({'prices': [price]}, [source], {'slug': 'synthetic'})['facts'])
        price.update(period='4 weeks', audience='adult')
        self.assertTrue(validate({'prices': [price]}, [source], {'slug': 'synthetic'})['facts'])

    def test_inferred_audience_and_dates_do_not_become_verified_fields(self):
        source, price, cls = fixture()
        source['text'] = 'Unlimited monthly $169.99. Monday Boxing 6:00 PM to 7:00 PM.'
        price['quote'] = 'Unlimited monthly $169.99.'
        row = validate({'prices': [price]}, [source], {'slug': 'synthetic'})['facts'][0]
        self.assertEqual(row['audience'], 'unknown')
        for field in ({'timezone': 'America/New_York'}, {'effective_dates': 'ages 5-13'}):
            self.assertFalse(validate({'classes': [{**cls, **field}]}, [source], {'slug': 'synthetic'})['facts'])

    def test_dated_sessions_old_offers_and_ambiguous_package_totals_are_held(self):
        source, price, cls = fixture()
        for text, change in [('Monday, November 02 Boxing 6:00 PM to 7:00 PM.', {}), ('Monday Boxing 6:00 PM to 7:00 PM every other week.', {})]:
            source['text'] = text
            self.assertFalse(validate({'classes': [{**cls, 'quote': text, **change}]}, [source], {'slug': 'synthetic'})['facts'])
        source['text'] = '2025 Summer Camp total $200.'
        price.update(quote=source['text'], plan='2025 Summer Camp', amount_usd=200, period='package')
        self.assertFalse(validate({'prices': [price]}, [source], {'slug': 'synthetic'})['facts'])
        source['text'] = 'Basic $85 5 sessions.'
        price.update(quote=source['text'], plan='Basic', amount_usd=85, period='package')
        self.assertFalse(validate({'prices': [price]}, [source], {'slug': 'synthetic'})['facts'])

    def test_free_uniform_does_not_establish_a_free_trial(self):
        source, price, _ = fixture()
        source['text'] = 'Free uniform with membership.'
        price.update(amount_usd=0, period='trial', quote=source['text'], plan='Trial')
        self.assertFalse(validate({'prices': [price]}, [source], {'slug': 'synthetic'})['facts'])

    def test_lower_bound_and_introductory_prices_keep_qualifiers(self):
        source, price, _ = fixture()
        for text, changes, expected in [('Starting at $169.99/month.', {}, 'starting_at'), ('$169.99 first month.', {'promotion': 'First month offer'}, 'introductory')]:
            source['text'] = text
            row = validate({'prices': [{**price, **changes, 'quote': text}]}, [source], {'slug': 'synthetic'})['facts'][0]
            self.assertEqual(row['price_qualifier'], expected)

    def test_class_quote_recovery_binds_name_to_the_actual_time_row(self):
        source, _, cls = fixture()
        source['text'] = 'Monday\n6:00 PM Fundamentals Boxing\n7:00 PM Advanced Boxing\nTuesday\n6:00 PM Wrestling'
        good = {**cls, 'name': 'Advanced Boxing', 'start': '19:00', 'start_text': '7:00 PM', 'end': None, 'end_text': None, 'quote': 'Monday 7:00 PM Advanced Boxing'}
        row = validate({'classes': [good]}, [source], {'slug': 'synthetic'})['facts'][0]
        self.assertTrue(row['quote_recovered_from_source'])
        self.assertIn(row['quote'], source['text'])
        wrong = {**good, 'start': '18:00', 'start_text': '6:00 PM', 'quote': 'Monday 6:00 PM Advanced Boxing'}
        self.assertFalse(validate({'classes': [wrong]}, [source], {'slug': 'synthetic'})['facts'])

    def test_class_quote_recovery_does_not_turn_end_time_into_start(self):
        source, _, cls = fixture()
        source['text'] = 'Monday\n5:30 PM - 7:30 PM Open Mat\nTuesday\n6:00 PM Boxing'
        wrong = {**cls, 'name': 'Open Mat', 'start': '19:30', 'start_text': '7:30 PM', 'end': None, 'end_text': None, 'quote': 'Monday 7:30 PM Open Mat'}
        self.assertFalse(validate({'classes': [wrong]}, [source], {'slug': 'synthetic'})['facts'])
        correct = {**wrong, 'start': '17:30', 'start_text': '5:30 PM', 'end': '19:30', 'end_text': '7:30 PM', 'quote': 'Monday 5:30 PM - 7:30 PM Open Mat'}
        self.assertTrue(validate({'classes': [correct]}, [source], {'slug': 'synthetic'})['facts'])

    def test_visual_sources_require_human_review(self):
        source, price, _ = fixture()
        source['mode'] = 'image'
        self.assertIn('visual_verification_required', validate({'prices': [price]}, [source], {'slug': 'synthetic'})['held'][0]['review_reasons'])

    def test_branch_unknown_and_empty_period_are_held(self):
        source, price, _ = fixture()
        self.assertFalse(validate({'prices': [price]}, [source], {'slug': 'synthetic', 'shared_site': True})['facts'])
        price['period'] = 'unknown'
        self.assertFalse(validate({'prices': [price]}, [source], {'slug': 'synthetic'})['facts'])

    def test_free_trial_is_zero_and_plan_tiers_survive(self):
        source, price, _ = fixture()
        free = {**price, 'amount_usd': 0, 'quote': 'Free trial.', 'period': 'class', 'plan': 'Trial'}
        self.assertEqual(len(validate({'prices': [price, free]}, [source], {'slug': 'synthetic'})['facts']), 2)

    def test_clock_requires_am_pm_or_valid_24h(self):
        self.assertEqual(source_clock('12:30 AM'), '00:30')
        self.assertEqual(source_clock('6 PM'), '18:00')
        self.assertIsNone(source_clock('6:00'))
        self.assertIsNone(source_clock('13 PM'))


class RunSafety(unittest.TestCase):
    def test_budget_reserves_before_call_and_unknown_cost_is_retained(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'usage.json'
            budget = Budget(path, '1')
            row = budget.reserve('synthetic', 1000)
            reserve = budget.total()
            self.assertGreater(reserve, 0)
            self.assertEqual(Budget(path, '1').total(), reserve)
            with self.assertRaisesRegex(ValueError, 'budget_deferred'):
                budget.reserve('synthetic', 1000000)
            budget.settle(row, SimpleNamespace(input_tokens=1000, output_tokens=1000))
            self.assertLess(budget.total(), reserve)
            with self.assertRaises(ValueError):
                Budget(path, 11)

    def test_paid_resume_reuses_response_and_failed_call_retains_reservation(self):
        with tempfile.TemporaryDirectory() as directory:
            run = Path(directory)
            (run / 'extractions').mkdir()
            source, price, _ = fixture()
            bundle = {'gym': {'slug': 'synthetic'}, 'sources': [source]}
            calls = []
            def create(**kwargs):
                calls.append(kwargs)
                return SimpleNamespace(usage=SimpleNamespace(input_tokens=500, output_tokens=500),
                                       stop_reason='tool_use', content=[SimpleNamespace(type='tool_use', name='record_review', input={'prices': [price], 'classes': []})])
            api = SimpleNamespace(messages=SimpleNamespace(count_tokens=lambda **kwargs: SimpleNamespace(input_tokens=500), create=create))
            budget = Budget(run / 'usage.json', '1')
            self.assertEqual(extract(bundle, run, budget, api), extract(bundle, run, budget, api))
            self.assertEqual(len(calls), 1)
            self.assertEqual(len(budget.rows), 1)
            bundle['sources'][0]['text'] += ' changed'
            api.messages.create = lambda **kwargs: (_ for _ in ()).throw(TimeoutError())
            before = budget.total()
            with self.assertRaises(TimeoutError):
                extract(bundle, run, budget, api)
            self.assertGreater(budget.total(), before)
            self.assertEqual(budget.rows[-1]['status'], 'reserved_unknown_outcome')

    def test_json_encoded_arrays_are_parsed_without_guessing_fields(self):
        source, price, _ = fixture()
        raw = {'prices': json.dumps([{**price, 'source_id': 'E1'}]), 'classes': []}
        restore_source_ids(raw, {'sources': [source]})
        self.assertEqual(raw['prices'][0]['source_id'], 's1')
        self.assertEqual(raw['prices'][0]['amount_usd'], 169.99)
        with self.assertRaises(ValueError):
            restore_source_ids({'prices': 'not JSON', 'classes': []}, {'sources': [source]})

    def test_image_mime_comes_from_bytes_not_extension_or_http_header(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'mislabelled.jpg'
            Image.new('RGB', (2, 2)).save(path, format='PNG')
            bundle = {'gym': {'slug': 'synthetic'}, 'sources': [{'id': 's', 'url': 'https://gym.example/a.jpg', 'mode': 'image', 'content_type': 'image/jpeg', 'body': str(path)}]}
            part = messages(bundle)[0]['content'][-1]
            self.assertEqual(part['source']['media_type'], 'image/png')

    def test_manifest_drops_private_contact_fields_and_rejects_duplicates(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'input.json'
            row = {'slug': 'synthetic', 'name': 'Synthetic', 'website': None, 'emails': {'private@example.com': []}}
            path.write_text(json.dumps([row]))
            self.assertNotIn('emails', load_manifest(path)[0])
            path.write_text(json.dumps([row, row]))
            with self.assertRaises(ValueError):
                load_manifest(path)

    def test_real_cli_no_site_runs_without_key_or_database(self):
        from scrapers.audit_sites import main
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / 'input.json'
            manifest.write_text(json.dumps([{'slug': 'synthetic-no-site', 'name': 'Synthetic', 'website': None}]))
            argv = ['audit_sites', '--manifest', str(manifest), '--run-dir', str(root / 'out')]
            with patch.object(sys, 'argv', argv), patch.dict('os.environ', {}, clear=True), patch.dict(sys.modules, {'scrapers.common.db': None}), redirect_stdout(StringIO()):
                self.assertEqual(main(), 0)
            summary = json.loads((root / 'out' / 'summary.json').read_text())
            self.assertEqual(summary['pricing_coverage'], {'no_website': 1})
            self.assertFalse((root / 'out' / 'usage.json').exists())

    def test_failures_and_deferred_are_not_empty_success(self):
        bundle = {'gym': {'slug': 'synthetic', 'name': 'Synthetic', 'website': 'https://gym.example'}, 'sources': [], 'gaps': [{'reason': 'robots_blocked'}], 'fallbacks': []}
        self.assertEqual(coverage(bundle, None, None)['prices_coverage'], 'blocked')
        self.assertEqual(coverage(bundle, None, 'budget_deferred')['classes_coverage'], 'budget_deferred')


class CollectionTests(unittest.TestCase):
    def test_link_text_query_fragment_and_assets_are_discovered(self):
        links = ev.discover('<a href="/p?id=2">Membership</a><a href="#schedule">Classes</a><img src="/rates.png" alt="Pricing"><iframe src="https://embed.example/x"></iframe>', 'https://gym.example/')
        self.assertIn('https://gym.example/p?id=2', [x['url'] for x in links])
        self.assertIn('https://gym.example/#schedule', [x['url'] for x in links])
        self.assertTrue(any(x['asset'] for x in links))

    def test_private_target_and_redirect_are_blocked_before_request(self):
        with self.assertRaises(ValueError):
            ev.public_url('http://127.0.0.1/')
        with tempfile.TemporaryDirectory() as directory:
            fetcher = ev.Fetcher(Path(directory))
            calls = []
            def response(request):
                calls.append(str(request.url))
                return httpx.Response(302, headers={'location': 'http://127.0.0.1/secret'})
            fetcher.client.close()
            fetcher.client = httpx.Client(transport=httpx.MockTransport(response))
            ev.REQUEST_CONTEXT.attempts = 0
            with patch.object(fetcher, 'allowed', return_value=True), patch.object(ev.socket, 'getaddrinfo', return_value=[(2,1,6,'',('93.184.216.34',443))]):
                with self.assertRaises(ValueError):
                    fetcher.get('https://gym.example/')
            self.assertEqual(len(calls), 1)
            fetcher.close()

    def test_pinned_transport_preserves_tls_name_and_rejects_rebinding(self):
        transport = ev.PublicTransport()
        transport.inner.close()
        sent = []
        transport.inner = httpx.MockTransport(lambda req: (sent.append(req) or httpx.Response(200)))
        request = httpx.Request('GET', 'https://gym.example/schedule')
        with patch.object(ev.socket, 'getaddrinfo', return_value=[(2,1,6,'',('93.184.216.34',443))]):
            transport.handle_request(request)
        self.assertEqual(sent[0].url.host, '93.184.216.34')
        self.assertEqual(sent[0].headers['host'], 'gym.example')
        self.assertEqual(sent[0].extensions['sni_hostname'], 'gym.example')
        with patch.object(ev.socket, 'getaddrinfo', return_value=[(2,1,6,'',('127.0.0.1',443))]):
            with self.assertRaisesRegex(ValueError, 'non_public_address'):
                transport.handle_request(request)
        self.assertEqual(len(sent), 1)
        transport.close()

    def test_oversize_response_is_rejected_without_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fetcher = ev.Fetcher(root)
            fetcher.client.close()
            fetcher.client = httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(200, content=b'x' * 10_000_001)))
            ev.REQUEST_CONTEXT.attempts = 0
            ev.REQUEST_CONTEXT.deadline = float('inf')
            with patch.object(fetcher, 'allowed', return_value=True), patch.object(ev.socket, 'getaddrinfo', return_value=[(2,1,6,'',('93.184.216.34',443))]):
                with self.assertRaisesRegex(ValueError, 'document_byte_limit'):
                    fetcher.get('https://gym.example/')
            self.assertFalse(list(root.glob('*.json')))
            fetcher.close()

    def test_request_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            fetcher = ev.Fetcher(Path(directory))
            ev.REQUEST_CONTEXT.attempts = 30
            with patch.object(fetcher, 'allowed', return_value=True), patch.object(ev.socket, 'getaddrinfo', return_value=[(2,1,6,'',('93.184.216.34',443))]):
                with self.assertRaisesRegex(ValueError, 'request_limit'):
                    fetcher.get('https://gym.example/')
            ev.REQUEST_CONTEXT.attempts = 0
            fetcher.close()


if __name__ == '__main__':
    unittest.main()

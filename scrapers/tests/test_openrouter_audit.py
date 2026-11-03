"""Synthetic OpenRouter protocol tests; all HTTP responses are local fixtures."""
import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from pathlib import Path

import httpx

from scrapers.audit_sites import Budget
from scrapers.common.openrouter_audit import complete, preflight


class OpenRouterAudit(unittest.TestCase):
    def api(self, handler):
        return httpx.Client(base_url='https://openrouter.ai/api/v1/', transport=httpx.MockTransport(handler))

    def test_native_files_pinned_route_and_real_cost(self):
        calls = []
        def respond(request):
            calls.append(json.loads(request.content))
            return httpx.Response(200, json={'id': 'synthetic-generation', 'usage': {'prompt_tokens': 20, 'completion_tokens': 30, 'cost': .001}, 'choices': [{'finish_reason': 'tool_calls', 'message': {'tool_calls': [{'function': {'name': 'record_review', 'arguments': '{"prices":[],"classes":[]}'}}]}}]})
        with tempfile.TemporaryDirectory() as d, self.api(respond) as client:
            budget = Budget(Path(d) / 'usage.json', 1)
            budget.provider = 'openrouter'
            content = [{'role': 'user', 'content': [{'type': 'text', 'text': 'Synthetic source'}, {'type': 'document', 'source': {'media_type': 'application/pdf', 'data': 'AA=='}}, {'type': 'image', 'source': {'media_type': 'image/png', 'data': 'AA=='}}]}]
            self.assertEqual(complete(client, content, 'system', {}, 100, budget, 'synthetic'), {'prices': [], 'classes': []})
            self.assertEqual(budget.total(), Decimal('.001'))
            self.assertEqual(calls[0]['plugins'][0]['pdf']['engine'], 'native')
            self.assertFalse(calls[0]['provider']['allow_fallbacks'])
            self.assertEqual(calls[0]['provider']['only'], ['anthropic'])
            self.assertEqual(calls[0]['messages'][1]['content'][1]['type'], 'file')
            self.assertEqual(calls[0]['messages'][1]['content'][2]['type'], 'image_url')

    def test_missing_usage_cost_stops_and_retains_reservation(self):
        with tempfile.TemporaryDirectory() as d, self.api(lambda request: httpx.Response(200, json={'usage': {}})) as client:
            budget = Budget(Path(d) / 'usage.json', 1)
            with self.assertRaisesRegex(RuntimeError, 'omitted usage cost'):
                complete(client, [{'content': []}], 'system', {}, 100, budget, 'synthetic')
            self.assertGreater(budget.total(), 0)
            self.assertEqual(budget.rows[0]['status'], 'reserved_unknown_outcome')

    def test_price_increase_prevents_completion(self):
        model = {'id': 'anthropic/claude-haiku-4.5', 'context_length': 200000, 'pricing': {'prompt': '.000002', 'completion': '.000005'}, 'architecture': {'input_modalities': ['text', 'image', 'file']}}
        with self.api(lambda request: httpx.Response(200, json={'data': [model]})) as client:
            with self.assertRaisesRegex(ValueError, 'pricing exceeds'):
                preflight(client)

    def test_concurrent_reservations_cannot_overbook(self):
        with tempfile.TemporaryDirectory() as d:
            budget = Budget(Path(d) / 'usage.json', '.6')
            def reserve(i):
                try:
                    budget.reserve('synthetic-' + str(i), 0)
                    return True
                except ValueError:
                    return False
            with ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(reserve, range(4)))
            self.assertEqual(sum(results), 2)
            self.assertLessEqual(budget.total(), Decimal('.6'))
            self.assertEqual(len(json.loads(budget.path.read_text())), 2)

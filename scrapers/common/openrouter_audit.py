"""OpenRouter transport for the same review schema, with no automatic retries."""
from __future__ import annotations

import json
from decimal import Decimal

from scrapers.common.site_evidence import save_json

MODEL = 'anthropic/claude-haiku-4.5'


def preflight(client):
    """Read-only model metadata; refuse silently changed rates or input capabilities."""
    response = client.get('models')
    response.raise_for_status()
    model = next((m for m in response.json()['data'] if m['id'] == MODEL), None)
    if not model or model['context_length'] > 200_000:
        raise ValueError('OpenRouter model context unavailable or changed')
    if Decimal(model['pricing']['prompt']) > Decimal('.000001') or Decimal(model['pricing']['completion']) > Decimal('.000005'):
        raise ValueError('OpenRouter pricing exceeds reviewed bounds')
    if any(Decimal(model['pricing'].get(key, '0')) > Decimal('.000002') for key in ('input_cache_read', 'input_cache_write', 'input_cache_write_1h')) or Decimal(model['pricing'].get('request', '0')) > 0:
        raise ValueError('OpenRouter cache or request pricing exceeds reviewed bounds')
    if not {'text', 'image', 'file'}.issubset(model['architecture']['input_modalities']):
        raise ValueError('OpenRouter model missing required input capabilities')


def complete(client, content, system, schema, max_output, budget, slug):
    parts = []
    for part in content[0]['content']:
        if part['type'] == 'text':
            parts.append(part)
        else:
            source = part['source']
            data = 'data:' + source['media_type'] + ';base64,' + source['data']
            if part['type'] == 'document':
                parts.append({'type': 'file', 'file': {'filename': 'public-gym-evidence.pdf', 'file_data': data}})
            else:
                parts.append({'type': 'image_url', 'image_url': {'url': data}})
    request = {'model': MODEL, 'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': parts}],
               'max_tokens': max_output, 'temperature': 0, 'usage': {'include': True}, 'plugins': [],
               'tools': [{'type': 'function', 'function': {'name': 'record_review', 'description': 'Record gym facts for review', 'parameters': schema}}],
               'tool_choice': {'type': 'function', 'function': {'name': 'record_review'}},
               'provider': {'only': ['anthropic'], 'allow_fallbacks': False, 'require_parameters': True,
                            'max_price': {'prompt': 1, 'completion': 5}}}
    if any(p['type'] == 'file' for p in parts):
        request['plugins'] = [{'id': 'file-parser', 'pdf': {'engine': 'native'}}]
    # No token-estimate endpoint required: Budget reserves all 200k input tokens.
    row = budget.reserve(slug, 0)
    response = client.post('chat/completions', json=request)
    response.raise_for_status()
    result = response.json()
    if result.get('error'):
        raise ValueError('openrouter_response_error')
    usage = result.get('usage') or {}
    cost = usage.get('cost')
    if cost is None:
        raise RuntimeError('OpenRouter omitted usage cost; retain reservation and stop')
    actual = Decimal(str(cost))
    if not actual.is_finite() or actual < 0:
        raise RuntimeError('OpenRouter returned invalid usage cost; retain reservation and stop')
    with budget.lock:
        row.update(input_tokens=usage.get('prompt_tokens'), output_tokens=usage.get('completion_tokens'),
                   generation_id=result.get('id'), observed_cost_usd=str(actual), charged_usd=str(actual),
                   status='completed' if actual <= Decimal(row['reserved_usd']) else 'reservation_exceeded_stop')
        save_json(budget.path, budget.rows)
    if actual > Decimal(row['reserved_usd']):
        raise RuntimeError('OpenRouter cost exceeded reservation; stop paid requests')
    choice = result['choices'][0]
    if choice.get('finish_reason') == 'length':
        raise ValueError('extraction_truncated')
    calls = choice['message'].get('tool_calls') or []
    call = next((c['function'] for c in calls if c['function']['name'] == 'record_review'), None)
    if call is None:
        raise ValueError('missing_structured_output')
    raw = json.loads(call['arguments'])
    if not isinstance(raw, dict):
        raise ValueError('missing_structured_output')
    return raw

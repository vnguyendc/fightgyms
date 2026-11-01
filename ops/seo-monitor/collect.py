#!/usr/bin/env python3
"""Read-only FightGyms search/traffic collection; missing sources stay unavailable."""
import argparse
import datetime as dt
import json
import math
from pathlib import Path
import subprocess
import sys
import urllib.request
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

ORIGIN = 'https://www.findfightgyms.com'
PROPERTY = 'sc-domain:findfightgyms.com'
HOME = Path.home()
DATA = HOME / '.local/share/fightgyms/seo-monitor'
VAULT = HOME / 'Documents/VinhVault-AI'
SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'


def capture(fn):
    try:
        return {'data': fn()}
    except Exception as exc:
        # Keep credentials, raw provider error payloads and request headers out of artifacts.
        return {'error': type(exc).__name__, 'status': getattr(getattr(exc, 'resp', None), 'status', getattr(exc, 'code', None)), 'reason': {'FileNotFoundError': 'required file or CLI is missing', 'TimeoutError': 'source timed out', 'TimeoutExpired': 'CLI timed out', 'CalledProcessError': 'Vercel CLI request failed; check login and metric access', 'HttpError': 'Google API request failed; check HTTP status and property access', 'URLError': 'network or DNS request failed', 'ValueError': 'source response failed validation'}.get(type(exc).__name__, 'source request failed')}


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'FightGymsSEO/1.0'})
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.status, response.read()


def sitemap_urls():
    _, raw = fetch(ORIGIN + '/sitemap.xml')
    root = ET.fromstring(raw)
    urls = sorted({node.text for node in root.findall('{*}url/{*}loc') if node.text})
    if not urls or any(not url.startswith(ORIGIN + '/') and url != ORIGIN for url in urls):
        raise ValueError('invalid sitemap')
    return urls


def fixed_sample(urls, historical):
    allowed = set(urls)
    result = [url for url in (ORIGIN, ORIGIN + '/gyms') if url in allowed]
    for row in sorted(historical, key=lambda row: row.get('impressions', 0), reverse=True):
        url = row['keys'][0]
        if url in allowed and url not in result:
            result.append(url)
        if len(result) == 5:
            break
    groups = [([u for u in urls if '/gym/' in u], 10),
              ([u for u in urls if len(u.removeprefix(ORIGIN).strip('/').split('/')) == 3 and '/gyms/' in u], 10),
              ([u for u in urls if len(u.removeprefix(ORIGIN).strip('/').split('/')) == 4 and '/gyms/' in u], 5)]
    for group, quota in groups:
        available = [u for u in group if u not in result]
        count = min(quota, len(available))
        result.extend(available[math.floor(i * len(available) / count)] for i in range(count))
    for url in urls:
        if len(result) >= 30:
            break
        if url not in result:
            result.append(url)
    return result[:30]


def configured_key():
    config = HOME / '.config/claude-seo/google-api.json'
    if config.exists():
        return Path(json.loads(config.read_text()).get('service_account_path', HOME / '.config/claude-seo/service-account.json')).expanduser()
    return HOME / '.config/claude-seo/service-account.json'


def service(key):
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build
    from google_auth_httplib2 import AuthorizedHttp
    import httplib2
    creds = Credentials.from_service_account_file(str(key), scopes=[SCOPE])
    return build('searchconsole', 'v1', http=AuthorizedHttp(creds, http=httplib2.Http(timeout=30)), cache_discovery=False)


def search(api, start, end, dimensions, limit=25000):
    rows = []
    while True:
        page = api.searchanalytics().query(siteUrl=PROPERTY, body={
            'startDate': start.isoformat(), 'endDate': end.isoformat(), 'dimensions': dimensions,
            'rowLimit': limit, 'startRow': len(rows), 'dataState': 'final',
        }).execute().get('rows', [])
        rows.extend(page)
        if len(page) < limit:
            return rows


def metrics(metric, start, end, group=None, aggregation=None):
    cmd = ['vercel', 'metrics', metric, '--project', 'fightgyms', '--scope', 'vinh-nguyens-projects-4454b12d',
           '--since', start.isoformat() + 'T00:00:00Z', '--until', (end + dt.timedelta(days=1)).isoformat() + 'T00:00:00Z',
           '--granularity', '1d', '--format', 'json',
           '--filter', "environment eq 'production' and (request_hostname eq 'www.findfightgyms.com' or request_hostname eq 'findfightgyms.com')"]
    if group:
        cmd += ['--group-by', group, '--limit', '100']
    if aggregation:
        cmd += ['--aggregation', aggregation]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=120, check=True)
    value = json.loads(out.stdout)
    if not isinstance(value.get('data'), list) or 'summary' not in value:
        raise ValueError('invalid Vercel response')
    return value


def daily_totals(rows, end):
    days = {row['keys'][0]: row for row in rows}
    result = []
    for offset in range(6, -1, -1):
        day = (end - dt.timedelta(days=offset)).isoformat()
        # GSC omits zero-activity dates from a successful query; no source success means no totals.
        result.append({'date': day, 'impressions': days.get(day, {}).get('impressions', 0), 'clicks': days.get(day, {}).get('clicks', 0)})
    return result


def alerts(bundle, prior=None):
    warnings = []
    sources = bundle['sources']
    for name, value in sources.items():
        if 'error' in value:
            warnings.append(f'{name}: unavailable ({value["error"]}: {value.get("reason", "source request failed")})')
    home = sources.get('homepage', {}).get('data')
    if home and home['status'] != 200:
        warnings.append(f'homepage HTTP {home["status"]}')
    daily = sources.get('gsc_daily', {}).get('data')
    if daily is not None:
        end = dt.date.fromisoformat(bundle['period_end'])
        current = sum(r['impressions'] for r in daily_totals(daily, end))
        previous = sum(r['impressions'] for r in daily_totals(daily, end - dt.timedelta(days=7)))
        if previous > 0 and current <= previous * .5:
            warnings.append(f'7-day impressions down {100 * (1 - current / previous):.0f}% ({previous:g} → {current:g})')
    maps = sources.get('gsc_sitemaps', {}).get('data', [])
    now = dt.datetime.fromisoformat(bundle['collected_at'])
    if not maps and 'data' in sources.get('gsc_sitemaps', {}):
        warnings.append('no sitemap registered in Search Console')
    for item in maps:
        if int(item.get('errors', 0)) > 0:
            warnings.append(f'sitemap errors: {item["errors"]}')
        read = item.get('lastDownloaded')
        if not read or (now - dt.datetime.fromisoformat(read.replace('Z', '+00:00'))).days >= 14:
            warnings.append('sitemap has not been read in 14 days')
    old = (prior or {}).get('sources', {}).get('inspections', {}).get('data', {})
    for url, entry in sources.get('inspections', {}).get('data', {}).items():
        if 'error' in entry:
            warnings.append(f'URL inspection unavailable: {url}')
        elif old.get(url, {}).get('coverageState') == 'Submitted and indexed' and entry.get('coverageState') != 'Submitted and indexed':
            warnings.append(f'URL left Submitted and indexed: {url}')
    return warnings


def render_note(bundle, previous_date=None):
    sources = bundle['sources']
    lines = [f'# FightGyms SEO weekly · {bundle["local_date"]}', '',
             f'Collected: {bundle["collected_at"]}. Finalized Search Console data through {bundle["period_end"]}; the newest three days are excluded for reporting lag.', '',
             f'Bundle: `{bundle["bundle_path"]}`', '']
    if previous_date:
        lines += [f'Previous: [[FightGyms SEO Weekly {previous_date}]]', '']
    lines += ['## Alerts', ''] + [f'- {warning}' for warning in (bundle['alerts'] or ['No configured alert fired.'])] + ['']
    rows = sources.get('gsc_daily', {}).get('data')
    if rows is not None:
        end = dt.date.fromisoformat(bundle['period_end'])
        current = daily_totals(rows, end)
        prior = daily_totals(rows, end - dt.timedelta(days=7))
        lines += [f'Last 7 days: {sum(r["clicks"] for r in current):g} clicks, {sum(r["impressions"] for r in current):g} impressions. Prior 7: {sum(r["clicks"] for r in prior):g} clicks, {sum(r["impressions"] for r in prior):g} impressions.', '',
                  '```mermaid', 'xychart-beta', '  title "Daily search impressions"',
                  '  x-axis [' + ', '.join('"' + r['date'][5:] + '"' for r in current) + ']',
                  '  y-axis "Impressions" 0 --> ' + str(max(1, math.ceil(max(r['impressions'] for r in current)))),
                  '  bar [' + ', '.join(str(r['impressions']) for r in current) + ']', '```', '']
        for label, days in [('Current 28 days', 0), ('Prior 28 days', 28)]:
            finish = end - dt.timedelta(days=days)
            start = finish - dt.timedelta(days=27)
            subset = [r for r in rows if start.isoformat() <= r['keys'][0] <= finish.isoformat()]
            lines += [f'{label}: {sum(r["clicks"] for r in subset):g} clicks, {sum(r["impressions"] for r in subset):g} impressions.', '']
    else:
        lines += ['Search performance unavailable; no zero or retained value substituted.', '']
    for source in ('gsc_pages_current', 'gsc_pages_previous', 'gsc_queries_current', 'gsc_queries_previous'):
        result = sources.get(source, {})
        lines += [f'## {source}', '']
        lines += [f'- {json.dumps(r["keys"], ensure_ascii=False)}: {r["clicks"]:g} clicks, {r["impressions"]:g} impressions' for r in result.get('data', [])[:10]] or ['Unavailable.' if 'error' in result else 'No recorded rows.']
        lines += ['']
    for source in ('vercel_daily', 'vercel_referrers', 'vercel_lcp', 'gsc_sitemaps', 'inspections'):
        result = sources.get(source, {})
        data = result.get('data')
        if data is None:
            display = 'Unavailable.'
        elif source == 'inspections':
            display = f'{len(data)} sampled; {sum(r.get("coverageState") == "Submitted and indexed" for r in data.values())} Submitted and indexed.'
        elif source.startswith('vercel_'):
            display = json.dumps(data['summary'], ensure_ascii=False) if data['summary'] else 'No recorded measurement.'
        else:
            display = json.dumps(data, ensure_ascii=False)
        lines += [f'## {source}', '', display, '']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=DATA)
    parser.add_argument('--vault', type=Path, default=VAULT)
    parser.add_argument('--key', type=Path, default=None)
    parser.add_argument('--no-notify', action='store_true')
    args = parser.parse_args()
    now = dt.datetime.now(dt.timezone.utc)
    today = now.astimezone(ZoneInfo('America/New_York')).date()
    end = today - dt.timedelta(days=3)
    folder = args.output / now.strftime('%Y-%m-%dT%H%M%S%fZ')
    previous = None
    previous_files = sorted(args.output.glob('*/bundle.json'))
    if previous_files:
        try:
            previous = json.loads(previous_files[-1].read_text())
        except (ValueError, OSError):
            previous = None
    print('Collecting public site health and sitemap', file=sys.stderr, flush=True)
    sources = {'homepage': capture(lambda: {'status': fetch(ORIGIN)[0]}), 'sitemap': capture(sitemap_urls)}
    sample = (previous or {}).get('sample', [])
    api_result = capture(lambda: service(args.key or configured_key()))
    if 'error' in api_result:
        for name in ('gsc_daily', 'gsc_pages_current', 'gsc_pages_previous', 'gsc_queries_current', 'gsc_queries_previous', 'gsc_sitemaps', 'inspections'):
            sources[name] = dict(api_result)
    else:
        api = api_result['data']
        print('Collecting Search Console performance', file=sys.stderr, flush=True)
        sources['gsc_daily'] = capture(lambda: search(api, end - dt.timedelta(days=55), end, ['date']))
        for dimension in ('page', 'query'):
            for label, offset in [('current', 0), ('previous', 7)]:
                finish = end - dt.timedelta(days=offset)
                sources[f'gsc_{"pages" if dimension == "page" else "queries"}_{label}'] = capture(lambda: search(api, finish - dt.timedelta(days=6), finish, [dimension], 25000))
        print('Collecting Search Console sitemap status', file=sys.stderr, flush=True)
        sources['gsc_sitemaps'] = capture(lambda: api.sitemaps().list(siteUrl=PROPERTY).execute().get('sitemap', []))
        old_sample = (previous or {}).get('sample', [])
        if old_sample:
            sample = old_sample
        elif 'data' in sources['sitemap']:
            historical = capture(lambda: search(api, dt.date(2026, 9, 26), dt.date(2026, 10, 12), ['page']))
            sample = fixed_sample(sources['sitemap']['data'], historical.get('data', []))
        else:
            sample = []
        print(f'Inspecting {len(sample)} fixed sample URLs', file=sys.stderr, flush=True)
        def inspections():
            if not sample:
                raise ValueError('sample unavailable')
            result = {}
            failures = 0
            for url in sample:
                if failures >= 3:
                    result[url] = {'error': 'Unavailable', 'reason': 'inspection source failed three times; remaining sample deferred'}
                    continue
                entry = capture(lambda: api.urlInspection().index().inspect(body={'inspectionUrl': url, 'siteUrl': PROPERTY}).execute()['inspectionResult']['indexStatusResult'])
                print(f'URL inspection {len(result) + 1}/{len(sample)}: {"unavailable" if "error" in entry else "received"}', file=sys.stderr, flush=True)
                result[url] = entry.get('data', entry)
                failures = failures + 1 if 'error' in entry else 0
            return result
        sources['inspections'] = capture(inspections)
    for name, metric, group, aggregate in [('vercel_daily', 'vercel.analytics_pageview.count', None, None),
                                            ('vercel_referrers', 'vercel.analytics_pageview.count', 'referrer_hostname', None),
                                            ('vercel_lcp', 'vercel.speed_insights.lcp_ms', None, 'p75')]:
        print(f'Collecting {name}', file=sys.stderr, flush=True)
        sources[name] = capture(lambda: metrics(metric, end - dt.timedelta(days=27), end, group, aggregate))
    previous_date = (previous or {}).get('local_date')
    if previous_date == str(today):
        previous_date = (previous or {}).get('previous_report_date')
    bundle = {'version': 1, 'previous_report_date': previous_date, 'collected_at': now.isoformat(), 'local_date': today.isoformat(), 'period_end': end.isoformat(),
              'bundle_path': str(folder / 'bundle.json'), 'sample': sample, 'sources': sources}
    bundle['alerts'] = alerts(bundle, previous)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'bundle.json').write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + '\n')
    if not (args.vault / 'SEO Reports').is_dir():
        raise RuntimeError('real vault SEO Reports folder is required; bundle saved, note not written')
    note = args.vault / 'SEO Reports' / f'FightGyms SEO Weekly {today}.md'
    note.write_text(render_note(bundle, previous_date))
    changed_alerts = set(bundle['alerts']) != set((previous or {}).get('alerts', []))
    if not args.no_notify and (previous is None or changed_alerts):
        message = f'FightGyms SEO: {len(bundle["alerts"])} alerts. Weekly note saved.'
        subprocess.run(['osascript', '-e', f'display notification "{message}" with title "FightGyms SEO"'], check=True)
    print(json.dumps({'bundle': str(folder / 'bundle.json'), 'note': str(note), 'alerts': bundle['alerts']}))
    return 1 if bundle['alerts'] else 0


if __name__ == '__main__':
    sys.exit(main())

"""Bounded public-site collection for review; no database or model dependencies."""
from __future__ import annotations

import hashlib
import ipaddress
import json
import re
import socket
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urldefrag, urljoin, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

import httpx
import trafilatura
from lxml import html as lhtml

UA = 'FightGymsResearch/1.0 (+https://www.findfightgyms.com)'
RELEVANT = re.compile(r'pric|cost|fee|member|rate|schedule|class|timetable|trial|faq|frequently|program|calendar|tuition', re.I)
ASSET = re.compile(r'\.(pdf|png|jpe?g|webp)(?:[?#]|$)', re.I)
PROVIDERS = ('gymdesk.com', 'mindbodyonline.com', 'zenplanner.com', 'glofox.com', 'wodify.com',
             'pushpress.com', 'kicksite.net', 'clubready.com', 'marianatek.com', 'sparkmembership.com')
PRIVATE_PATH = re.compile(r'/(login|signin|sign-in|checkout|cart|account|register|signup|sign-up)(/|$)', re.I)
LOCK = threading.Lock()
HOST_LOCKS: dict[str, threading.Lock] = {}
URL_LOCKS: dict[str, threading.RLock] = {}
REQUEST_CONTEXT = threading.local()
LAST: dict[str, float] = {}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def digest(value: bytes | str) -> str:
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def save_json(path: Path, value) -> None:
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False))
    temp.replace(path)


def public_url(url: str, *, resolve=True) -> str:
    p = urlsplit(url)
    if p.scheme not in ('https', 'http') or not p.hostname or p.username or p.password or p.port not in (None, 80, 443):
        raise ValueError('non_public_url')
    host = p.hostname.lower().rstrip('.')
    if host in ('localhost',) or '.' not in host or host.endswith(('.local', '.localhost', '.internal')):
        raise ValueError('non_public_host')
    try:
        ips = [ipaddress.ip_address(host)]
    except ValueError:
        ips = [ipaddress.ip_address(x[4][0]) for x in socket.getaddrinfo(host, p.port or (443 if p.scheme == 'https' else 80), type=socket.SOCK_STREAM)] if resolve else []
    if any(not ip.is_global for ip in ips):
        raise ValueError('non_public_address')
    return urlunsplit((p.scheme, p.netloc.lower(), p.path or '/', p.query, p.fragment))


def host(url: str) -> str:
    return (urlsplit(url).hostname or '').lower().removeprefix('www.')


def provider(url: str) -> bool:
    return any(host(url) == h or host(url).endswith('.' + h) for h in PROVIDERS)


class PublicTransport(httpx.BaseTransport):
    """Pin validated addresses while preserving Host and TLS certificate/SNI name."""
    def __init__(self):
        # No cross-host connection reuse when sites share a CDN IP.
        self.inner = httpx.HTTPTransport(trust_env=False, limits=httpx.Limits(max_connections=4, max_keepalive_connections=0))

    def handle_request(self, request):
        public_url(str(request.url), resolve=False)
        addresses = {ipaddress.ip_address(r[4][0]) for r in socket.getaddrinfo(
            request.url.host, request.url.port or (443 if request.url.scheme == 'https' else 80), type=socket.SOCK_STREAM)}
        if not addresses or any(not ip.is_global for ip in addresses):
            raise ValueError('non_public_address')
        address = sorted(addresses, key=lambda ip: (ip.version, str(ip)))[0]
        pinned = httpx.Request(request.method, request.url.copy_with(host=str(address)),
                               headers=request.headers, stream=request.stream,
                               extensions={**request.extensions, 'sni_hostname': request.url.host})
        return self.inner.handle_request(pinned)

    def close(self):
        self.inner.close()


class Fetcher:
    """Cache HTTP bytes by request URL. Each redirect is checked before following.

    A pinned transport closes the DNS validation-to-connection race. This is a
    local research collector, not a public URL-fetch service.
    """
    def __init__(self, root: Path):
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        self.client = httpx.Client(headers={'User-Agent': UA}, timeout=20, follow_redirects=False,
                                   trust_env=False, transport=PublicTransport())
        self.robots: dict[str, RobotFileParser] = {}

    def close(self):
        self.client.close()

    def get(self, url: str, *, robot=False) -> dict:
        with LOCK:
            gate = URL_LOCKS.setdefault(urldefrag(url)[0], threading.RLock())
        with gate:
            return self._get(url, robot=robot)

    def _get(self, url: str, *, robot=False) -> dict:
        key = digest(urldefrag(url)[0])
        meta = self.root / (key + '.json')
        if meta.exists():
            return json.loads(meta.read_text())
        requested = url
        chain = []
        for _ in range(6):
            url = public_url(url)
            if not robot and not self.allowed(url):
                raise ValueError('robots_blocked')
            if getattr(REQUEST_CONTEXT, 'attempts', 0) >= 30:
                raise ValueError('request_limit')
            if time.monotonic() > getattr(REQUEST_CONTEXT, 'deadline', float('inf')):
                raise ValueError('gym_time_limit')
            REQUEST_CONTEXT.attempts = getattr(REQUEST_CONTEXT, 'attempts', 0) + 1
            with LOCK:
                gate = HOST_LOCKS.setdefault(host(url), threading.Lock())
            with gate:
                time.sleep(max(0, .4 - (time.monotonic() - LAST.get(host(url), 0))))
                with self.client.stream('GET', urldefrag(url)[0]) as response:
                    chain.append({'url': url, 'status': response.status_code})
                    if response.is_redirect:
                        url = urljoin(str(response.url), response.headers['location'])
                        LAST[host(str(response.url))] = time.monotonic()
                        continue
                    data = bytearray()
                    for block in response.iter_bytes():
                        data.extend(block)
                        if len(data) > 10_000_000:
                            raise ValueError('document_byte_limit')
                    LAST[host(url)] = time.monotonic()
                    body = self.root / (key + '.bin')
                    body.write_bytes(data)
                    result = {'requested_url': requested, 'url': str(response.url), 'redirects': chain,
                              'status': response.status_code, 'content_type': response.headers.get('content-type', '').split(';')[0],
                              'captured_at': now(), 'hash': digest(bytes(data)), 'body': str(body)}
                    save_json(meta, result)
                    return result
        raise ValueError('redirect_limit')

    def allowed(self, url: str) -> bool:
        p = urlsplit(url)
        origin = f'{p.scheme}://{p.netloc}'
        if origin not in self.robots:
            response = self.get(origin + '/robots.txt', robot=True)
            robot = RobotFileParser()
            # Fail closed for server errors/forbidden; absent robots is permissive.
            if response['status'] == 200:
                robot.parse(Path(response['body']).read_text(errors='replace').splitlines())
            elif response['status'] in (404, 410):
                robot.parse([])
            else:
                robot.parse(['User-agent: *', 'Disallow: /'])
            self.robots[origin] = robot
        return self.robots[origin].can_fetch(UA, url)


def discover(html: str, base: str) -> list[dict]:
    try:
        tree = lhtml.fromstring(html, base_url=base)
    except lhtml.etree.ParserError:
        return []
    found = {}
    for node in tree.xpath('//a[@href] | //iframe[@src] | //img[@src]'):
        value = node.get('href') or node.get('src') or ''
        label = ' '.join(node.itertext()) + ' ' + (node.get('alt') or '') + ' ' + (node.get('title') or '')
        url = urljoin(base, value)
        if not url.startswith(('http://', 'https://')):
            continue
        if PRIVATE_PATH.search(urlsplit(url).path):
            continue
        asset = bool(ASSET.search(url))
        relevant = bool(RELEVANT.search(label + ' ' + urlsplit(url).path + ' ' + urlsplit(url).fragment))
        if asset and not re.search(r'pric|rates|tuition|schedul|timetable|calendar|member', label + ' ' + url, re.I):
            continue
        if relevant or node.tag == 'iframe' or provider(url):
            found[url] = {'url': url, 'label': label.strip()[:200], 'asset': asset,
                          'iframe': node.tag == 'iframe', 'parent_url': base}
    return sorted(found.values(), key=lambda x: (not bool(RELEVANT.search(x['label'] + x['url'])), not x['asset'], x['url']))


def collect(gym: dict, fetcher: Fetcher) -> dict:
    result = {'gym': gym, 'sources': [], 'gaps': [], 'fallbacks': [], 'captured_at': now()}
    base = gym.get('website')
    if not base:
        result['gaps'].append({'reason': 'no_website'})
        return result
    queue = [{'url': base, 'parent_url': None, 'asset': False, 'label': 'official gym website'}]
    seen = set()
    origin = None
    text_chars = assets = 0
    started = time.monotonic()
    REQUEST_CONTEXT.attempts = 0
    REQUEST_CONTEXT.deadline = started + 180
    while queue and len(seen) < 30 and len([x for x in result['sources'] if x['mode'] == 'html']) < 12:
        link = queue.pop(0)
        url = link['url']
        if url in seen:
            continue
        seen.add(url)
        try:
            if time.monotonic() - started > 180:
                raise ValueError('gym_time_limit')
            public_url(url)
            if not fetcher.allowed(url):
                result['gaps'].append({'url': url, 'reason': 'robots_blocked'})
                continue
            response = fetcher.get(url)
            if response['status'] != 200:
                result['gaps'].append({'url': url, 'reason': 'http_' + str(response['status'])})
                continue
            final = response['url']
            if final != url and final in seen:
                continue
            seen.add(final)
            origin = origin or host(final)
            source = {**response, 'id': response['hash'][:20] + '-' + digest(final)[:8],
                      'parent_url': link['parent_url'], 'label': link['label'], 'mode': 'html', 'text': ''}
            if host(final) != host(base) and host(final) != origin:
                result['gaps'].append({'url': final, 'reason': 'cross_host_redirect_review'})
            body_start = Path(response['body']).read_bytes()[:300].lower()
            if 'text/html' in response['content_type'] or (response['content_type'].startswith('text/') and (b'<!doctype html' in body_start or b'<html' in body_start)):
                html = Path(response['body']).read_text(errors='replace')
                text = trafilatura.extract(html, include_tables=True, include_links=False, favor_recall=True) or ''
                source['text'] = text[:min(30_000, max(0, 200_000 - text_chars))]
                text_chars += len(source['text'])
                source['truncated'] = len(source['text']) < len(text)
                if source['truncated']:
                    result['gaps'].append({'url': final, 'reason': 'text_limit'})
                if len(text) < 200:
                    result['fallbacks'].append({'url': final, 'reason': 'rendered_content_needed', 'parent_url': link['parent_url']})
                for child in discover(html, final):
                    u = child['url']
                    if child['iframe'] or urlsplit(u).fragment or (host(u) != origin and provider(u)):
                        result['fallbacks'].append({**child, 'reason': 'linked_widget_or_fragment'})
                    if child['asset']:
                        if assets < 5:
                            assets += 1
                            queue.append(child)
                        else:
                            result['gaps'].append({'url': u, 'reason': 'asset_limit'})
                    elif host(u) == origin and not child['iframe'] and u not in seen and not urlsplit(u).fragment:
                        queue.append(child)
            elif response['content_type'] == 'application/pdf' or response['content_type'] in ('image/png', 'image/jpeg', 'image/webp'):
                source['mode'] = 'pdf' if response['content_type'] == 'application/pdf' else 'image'
            else:
                result['gaps'].append({'url': final, 'reason': 'unsupported_content_type'})
                if not link['asset']:
                    result['fallbacks'].append({'url': final, 'reason': 'browser_render_needed', 'parent_url': link['parent_url']})
                continue
            if not any(s['id'] == source['id'] for s in result['sources']):
                result['sources'].append(source)
        except (ValueError, httpx.HTTPError, OSError, socket.gaierror) as error:
            result['gaps'].append({'url': url, 'reason': type(error).__name__, 'detail': str(error)[:160]})
    if queue:
        result['gaps'].append({'reason': 'crawl_limit', 'remaining': len(queue)})
    # Redirected sites are evidence, but location/rebrand equivalence requires review.
    if origin and origin != host(base):
        result['gaps'].append({'reason': 'redirected_domain_identity_review', 'from': host(base), 'to': origin})
    result['fallbacks'] = list({x['url']: x for x in result['fallbacks']}.values())
    return result

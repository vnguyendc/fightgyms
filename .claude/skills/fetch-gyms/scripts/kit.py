"""Evidence kit for scrapers/public_candidates.py. Every command takes --run NAME (a private run dir).

  kit.py --run R init --states NY,NJ --city-file NY=nyc.txt --city-file NJ=nj.txt
        create the run (run.json, captures/, leads/) and export the live gyms for dedupe (read-only)
  kit.py --run R existing                  refresh existing_gyms.txt (name | city, ST | host)
  kit.py --run R brief --region nyc --areas "Manhattan (...), Brooklyn (...)"
        print the discovery brief for one region agent, paths filled in
  kit.py --run R capture URL               fetch ONE official page (robots.txt honoured, redirects
                                           recorded, real timestamps) -> captures/<host>/<slug>.json
  kit.py --run R find CAPTURE "words"      exact lines of a capture containing all the words
  kit.py --run R propose --region nyc CAP [CAP ...] --name "Gym" [--address A --city C --state ST]
        [--styles muay_thai,kickboxing] [--note "..."]
        build a v1 candidate, pick exact quotes, run the real validator, log to leads/<region>.jsonl
  kit.py --run R skip --region nyc --name "Gym" --url URL --reason REASON [--city C --state ST]

Captured text is <title>, meta description, visible body text (block elements on their own line,
<br> as a space), then address-bearing JSON-LD verbatim. Nothing is paraphrased or edited.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import tempfile
import time
import urllib.robotparser
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urljoin, urlsplit

import httpx
import lxml.html
from lxml import etree

from common import PY, config, listed_cities, pc, read_only, run_dir

UA = "Mozilla/5.0 (compatible; fightgyms-bot/0.1; +https://findfightgyms.com)"
UA_TOKEN = "fightgyms-bot"
BLOCK = {"address", "article", "aside", "blockquote", "dd", "div", "dl", "dt", "fieldset", "figcaption", "figure",
         "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p",
         "pre", "section", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul", "option", "button", "label"}
DROP = ("script", "style", "noscript", "template", "svg", "iframe", "canvas", "video", "audio", "select", "head")
OFFER = re.compile(r"\b(?:offer|offers|teach|teaches|classes|training|lessons)\b", re.I)
STYLE_WORDS = {"muay_thai": "muay thai", "kickboxing": "kickboxing", "dutch_kickboxing": "dutch kickboxing"}
FOLLOW = re.compile(r"contact|location|visit|about|find|direction|schedule|class|muay|kickbox|program|hours", re.I)
US_STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan",
    "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas",
    "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming"}
STREET = re.compile(r"(?<![\w\-#(.])(?!\d{3}[-.]\d{4}\b)\d+(?:-\d+)?(?:-?[A-Za-z](?![A-Za-z]))?\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9]")
TAIL = re.compile(r"^(?:,?\s*|\n)(?:United States(?: of America)?|USA|U\.S\.A\.|US)\b")
ROBOTS: dict[str, object] = {}
RUN: Path
TARGET: set[str] = set()
STATE_ZIP = STATE_NOZIP = None
STATE_CODES: dict[str, str] = {}


def setup(run: Path) -> None:
    """Address anchors for the run's states only: "City, NJ 07310", "City, New Jersey 07310", "City, NJ"."""
    global RUN, TARGET, STATE_ZIP, STATE_NOZIP, STATE_CODES
    RUN, TARGET = run, set(config(run).get("states", []))
    codes = sorted(TARGET) or ["NY"]
    names = sorted((US_STATES[c] for c in codes), key=len, reverse=True)
    alt = "|".join(codes + [re.escape(n) for n in names])
    dc = r"|D\.C\." if "DC" in codes else ""
    STATE_ZIP = re.compile(rf"(?<!West )\b((?i:{'|'.join(codes)})|{'|'.join(re.escape(n) for n in names)}{dc})"
                           r"\.?,?\s*(\d{5})(?:-\d{4})?\b")
    STATE_NOZIP = re.compile(rf"(?<=[A-Za-z.]),?\s+((?:{alt})\b{dc})\.?(?!\s*,?\s*\d)"
                             rf"(?!\s*,?\s*(?:{'|'.join(codes)})\b)(?=\s*(?:$|\n|[,;|•·(]|\s[A-Z(]))")
    STATE_CODES = {US_STATES[c]: c for c in codes} | ({"D.C.": "DC"} if "DC" in codes else {})


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def host_of(url: str) -> str:
    return (urlsplit(url).hostname or "").lower().removeprefix("www.")


# ---------- capture ----------

def robots_allows(client: httpx.Client, url: str) -> tuple[bool, float]:
    p = urlsplit(url)
    root = f"{p.scheme}://{p.netloc}"
    if root not in ROBOTS:
        rp = urllib.robotparser.RobotFileParser()
        try:
            r = client.get(root + "/robots.txt", follow_redirects=True, timeout=15)
            if r.status_code in (401, 403) or r.status_code >= 500:
                rp.disallow_all = True
            elif r.status_code >= 400:
                rp.allow_all = True
            else:
                rp.parse(r.text.splitlines())
        except httpx.ConnectError:
            ROBOTS[root] = "unreachable"  # dns failure or refused: the site is down, not blocking us
            return False, 0
        except httpx.HTTPError:
            rp = None  # robots.txt timed out or broke mid-transfer: treat as blocked, never bypass
        ROBOTS[root] = rp
    rp = ROBOTS[root]
    if rp is None or rp == "unreachable":
        return False, 0
    return rp.can_fetch(UA_TOKEN, url), float(rp.crawl_delay(UA_TOKEN) or 0)


def render(html: str | bytes) -> tuple[str, dict]:
    try:
        doc = lxml.html.fromstring(html)
    except ValueError:  # str with an xml encoding declaration
        doc = lxml.html.fromstring(html.encode("utf-8") if isinstance(html, str) else html)
    meta = {"title": (doc.findtext(".//title") or "").strip(), "description": "", "site_name": ""}
    for m in doc.iter("meta"):
        key = (m.get("name") or m.get("property") or "").lower()
        if key in ("description", "og:description") and not meta["description"]:
            meta["description"] = (m.get("content") or "").strip()
        if key == "og:site_name":
            meta["site_name"] = (m.get("content") or "").strip()
    jsonld = [(s.text or "").strip() for s in doc.iter("script") if (s.get("type") or "").lower() == "application/ld+json"]
    body = doc.find("body") if doc.find("body") is not None else doc
    etree.strip_elements(body, *DROP, with_tail=False)
    for c in body.iter(etree.Comment):
        c.text = ""
    out: list[str] = []

    def walk(el):
        tag = el.tag if isinstance(el.tag, str) else ""
        if tag == "br":
            out.append(" ")
        elif tag in BLOCK:
            out.append("\n")
        if el.text and tag:
            out.append(el.text)
        for child in el:
            walk(child)
        if tag in BLOCK:
            out.append("\n")
        if el.tail:
            out.append(el.tail)

    walk(body)
    lines = [re.sub(r"[ \t ​\r\f\v]+", " ", ln).strip() for ln in "".join(out).split("\n")]
    visible_text = "\n".join(ln for ln in lines if ln)
    head = [x for x in (meta["title"], meta["description"]) if x]
    # address-bearing json-ld only; blocks that trip the sensitive guard (firebase ?token= image urls) poison a page
    keep = [j[:12000] for j in jsonld if re.search(r"address|PostalAddress|LocalBusiness|SportsActivityLocation|"
                                                    r"ExerciseGym|HealthClub", j) and not pc.SENSITIVE.search(j)][:3]
    budget = 50_000 - sum(len(x) + 1 for x in head + keep) - 1
    text = "\n".join(head + [visible_text[:max(budget, 0)]] + keep)
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", " ", text).encode("utf-8", "ignore").decode("utf-8")
    return text, {**meta, "jsonld": keep}


def capture(url: str) -> dict:
    chain = [url]
    with httpx.Client(headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml"}, timeout=25) as client:
        current = url
        for _ in range(6):
            ok, delay = robots_allows(client, current)
            if not ok:
                root = f"{urlsplit(current).scheme}://{urlsplit(current).netloc}"
                why = "unreachable" if ROBOTS.get(root) == "unreachable" else "robots_disallowed"
                return {"error": why, "url": current, "redirect_chain": chain}
            time.sleep(max(delay, 1.0))
            r = client.get(current, follow_redirects=False)
            if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                current = urljoin(current, r.headers["location"])
                chain.append(current)
                if len(chain) > 5:
                    return {"error": "too_many_redirects", "redirect_chain": chain}
                continue
            fetched_at = now_iso()
            break
        else:
            return {"error": "too_many_redirects", "redirect_chain": chain}
    if r.status_code != 200:
        return {"error": f"http_{r.status_code}", "url": current, "redirect_chain": chain}
    if "html" not in r.headers.get("content-type", ""):
        return {"error": "not_html", "url": current, "redirect_chain": chain}
    try:
        text, meta = render(r.text)
    except (etree.ParserError, ValueError):
        return {"error": "unparseable_html", "url": current, "redirect_chain": chain}
    if len(text) < 200:
        return {"error": "too_little_text_maybe_js_only", "url": current, "redirect_chain": chain}
    links = []
    for href in re.findall(r'href=["\']([^"\'#]+)', r.text):
        u = urljoin(current, href.strip())
        if (host_of(u) == host_of(current) and FOLLOW.search(urlsplit(u).path) and "?" not in u and u not in links
                and not re.search(r"\.(?:png|jpe?g|gif|webp|svg|ico|pdf|css|js|xml|mp4)$", urlsplit(u).path, re.I)):
            links.append(u)
    return {"url": current, "redirect_chain": chain, "fetched_at": fetched_at, "text": text,
            "meta": meta, "links": links[:25], "sha256": hashlib.sha256(r.content).hexdigest()}


# ---------- quotes ----------

def quote_ok(body: str, q: str, lines: int = 1) -> bool:
    """Mirror of the validator's per-quote rules, so proposals only offer passable quotes."""
    if not q or len(q) > 800 or q.count("\n") >= lines or q not in body:
        return False
    if any(not ln or ln != ln.strip() or re.search(r"[\x00-\x1f\x7f]", ln) for ln in q.split("\n")):
        return False
    if pc.UNCERTAIN.search(q):
        return False
    matches = list(re.finditer(re.escape(q), body))
    for s in re.finditer(r"[^.!?]+[.!?]*", body):
        if any(m.start() < s.end() and m.end() > s.start() for m in matches) and pc.UNCERTAIN.search(s.group()):
            return False
    return True


def visible(page: dict) -> str:
    """Title, description and body text; the JSON-LD tail is for addresses only."""
    blocks = [j for j in page.get("meta", {}).get("jsonld", []) if j and j in page["text"]]
    cut = min((page["text"].index(j) for j in blocks), default=len(page["text"]))
    return page["text"][:cut]


def fragments(body: str):
    """Candidate quotes: whole lines, and sentence pieces within lines."""
    for line in body.split("\n"):
        line = line.strip()
        if not line:
            continue
        yield line
        for s in re.finditer(r"[^.!?]+[.!?]*", line):
            piece = s.group().strip()
            if piece and piece != line:
                yield piece


def style_quotes(pages: list[dict], style: str, name: str | None = None) -> list[tuple[str, str]]:
    """Passable offering quotes, best first: the style named outside the gym's own name, an offer verb, short."""
    words = STYLE_WORDS[style]
    found = []
    for p in pages:
        for q in fragments(visible(p)):
            if len(q) <= 800 and pc.supports(words, q) and OFFER.search(q) and quote_ok(p["text"], q):
                if style == "kickboxing" and re.search(r"cardio|fitness kickboxing", q, re.I):
                    continue
                rest = pc.normalized(q).replace(pc.normalized(name), " ") if name else pc.normalized(q)
                verb = bool(re.search(r"\b(?:offer|offers|teach|teaches|classes|lessons)\b", q, re.I))
                found.append(((not pc.supports(words, rest), not verb, len(q)), p["url"], q))
    found.sort(key=lambda x: x[0])
    seen, out = set(), []
    for _, u, q in found:
        if q not in seen:
            seen.add(q)
            out.append((u, q))
    return out


def name_quotes(pages: list[dict], name: str) -> list[tuple[str, str]]:
    found = [(p["url"], q) for p in pages for q in fragments(visible(p))
             if len(q) <= 300 and pc.supports(name, q) and quote_ok(p["text"], q)]
    return sorted(found, key=lambda x: len(x[1]))


def name_options(pages: list[dict]) -> list[str]:
    names = []
    for p in pages:
        meta = p.get("meta", {})
        for j in meta.get("jsonld", []):
            names += re.findall(r'"name"\s*:\s*"([^"]{3,80})"', j)
        if meta.get("site_name"):
            names.append(meta["site_name"])
        names += [part.strip() for part in re.split(r"\s+[|\-–—:]\s+", meta.get("title", "")) if 3 <= len(part) <= 80]
    seen, out = set(), []
    for n in names:
        if n.lower() not in seen:
            seen.add(n.lower())
            out.append(n)
    return out[:8]


# ---------- addresses ----------

def jsonld_address_spans(text: str) -> list[str]:
    spans = []
    for m in re.finditer(r'"(?:streetAddress|PostalAddress)"', text):
        start = text.rfind("{", 0, m.start())
        if start < 0:
            continue
        depth, end = 0, None
        for i in range(start, min(len(text), start + 1200)):
            depth += {"{": 1, "}": -1}.get(text[i], 0)
            if text[i] == "}" and depth == 0:
                end = i + 1
                break
        if end and text[start:end] not in spans:
            spans.append(text[start:end])
    return spans


def parse_jsonld_address(span: str) -> dict | None:
    try:
        obj = json.loads(span)
    except ValueError:
        return None
    if not isinstance(obj, dict):
        return None
    return {"address": obj.get("streetAddress"), "city": obj.get("addressLocality"),
            "state": obj.get("addressRegion"), "zip": obj.get("postalCode")}


def text_address_blocks(body: str) -> list[tuple[str, dict]]:
    """Street ... City, ST 12345 [, USA] spans, on one line or wrapped over up to three lines."""
    out = []
    anchors = [(m, m.group(1), m.group(2)) for m in STATE_ZIP.finditer(body)]
    anchors += [(m, m.group(1), None) for m in STATE_NOZIP.finditer(body)]
    cities = listed_cities()
    for m, state_text, zip_code in anchors:
        end = m.end()
        tail = TAIL.match(body[end:end + 40])
        if tail:
            end += tail.end()
        window_start = max(0, m.start(1) - 200)
        nl = [i for i in range(m.start(1) - 1, window_start - 1, -1) if body[i] == "\n"]
        floor = nl[2] + 1 if len(nl) > 2 else window_start  # at most two line breaks above the state line
        code = STATE_CODES.get(state_text, state_text.upper())
        for s in reversed(list(STREET.finditer(body, floor, m.start(1)))):  # nearest house number first
            span = body[s.start():end].strip()
            if span.count("\n") > 2 or len(span) > 300:
                continue
            pre = body[s.start():m.start(1)].rstrip(" ,.\n")
            parts = [x.strip() for x in re.split(r"[,\n]", pre) if x.strip()]
            street, city = (parts[0], parts[-1]) if len(parts) >= 2 else (pre, None)
            if len(parts) >= 2:
                city = {c.lower(): c for c, st in cities if st == code}.get(city.lower(), city)
            else:  # "3487 Kennedy Blvd. Jersey City": split on a listed city name at the end
                known = sorted((c for c, st in cities if st == code), key=len, reverse=True)
                hit = next((c for c in known if pre.lower().endswith(" " + c.lower())), None)
                if hit:
                    street, city = pre[: -len(hit)].rstrip(" ,."), hit
                elif ". " in pre:
                    street, city = pre.rsplit(". ", 1)[0] + ".", pre.rsplit(". ", 1)[1]
            if not re.match(r"\d+(?:-\d+)?[A-Za-z-]*\s+\S+", street or ""):
                continue  # "3A" from "Ste 3A Jersey City" is a suite, not a house number
            out.append((span, {"address": street, "city": city, "state": code, "zip": zip_code}))
    return out


def full_address(quote: str, street: str) -> str | None:
    """The printed address from the house number through the zip, lines joined with commas, country dropped."""
    num = re.match(r"\d+(?:-\d+)?", street or "")
    m = num and re.search(r"(?<![\w-])" + re.escape(num.group()) + r"(?![\d-])", quote)
    if not m:
        return None
    s = re.sub(r",?\s*(?:United States(?: of America)?|USA|U\.S\.A\.|US)\.?$", "", quote[m.start():].strip())
    s = re.sub(r",\s*,", ",", re.sub(r"\s{2,}", " ", re.sub(r"[ \t]*\n[ \t]*", ", ", s).strip(" ,")))
    return s if pc.supports(street, s) and len(s) <= 240 else None


def location_options(pages: list[dict], address=None, city=None, state=None) -> list[dict]:
    """Quotes the validator can accept: visible text before JSON-LD, complete (zip) before zip-less, short first."""
    opts = []
    for p in pages:
        opts += [{"url": p["url"], "quote": s, "parsed": parsed, "kind": "jsonld"}
                 for s in jsonld_address_spans(p["text"]) if (parsed := parse_jsonld_address(s)) and parsed.get("address")]
        opts += [{"url": p["url"], "quote": s, "parsed": parsed, "kind": "text"} for s, parsed in text_address_blocks(p["text"])]
    good = []
    for o in opts:
        body = next(p["text"] for p in pages if p["url"] == o["url"])
        a, c, st = address or o["parsed"].get("address"), city or o["parsed"].get("city"), state or o["parsed"].get("state")
        if not all(isinstance(v, str) and v for v in (a, c, st)):
            continue
        if all(pc.supports(v, o["quote"]) for v in (a, c)) and pc.supports_state(st.upper(), o["quote"]) \
                and quote_ok(body, o["quote"], lines=3):
            o["basis"] = "jsonld" if o["kind"] == "jsonld" else ("wrapped" if "\n" in o["quote"] else "line")
            good.append(o)
    # "78 Reade St New York" (a city read as a state) must not beat "78 Reade St New York, NY 10007"
    good.sort(key=lambda o: (o["kind"] == "jsonld", not o["parsed"].get("zip") and o["kind"] == "text",
                             o["quote"].count("\n"), len(o["quote"])))
    return good


# ---------- proposals ----------

def validate_scoped(record: dict) -> dict:
    """Real validator; a city not yet on a region list passes through a temporary list copy (lists grow by review)."""
    key = (record.get("city"), record.get("state"))
    if key in listed_cities() or record.get("state") not in TARGET:
        return pc.validate(record)
    with tempfile.TemporaryDirectory() as tmp:
        for f in pc.CITIES.glob("*.txt"):
            (Path(tmp) / f.name).write_text(f.read_text())
        (Path(tmp) / "zz-pending.txt").write_text(f"{key[0]}, {key[1]}\n")
        with patch.object(pc, "CITIES", Path(tmp)):
            return pc.validate(record)


def propose(captures: list[str], *, name=None, address=None, city=None, state=None, styles=None,
            name_quote=None, location_quote=None) -> tuple[dict, dict | None]:
    caps = [json.loads(Path(c).read_text()) for c in captures]
    if len({host_of(c["url"]) for c in caps}) != 1:
        return {"status": "rejected", "reason": "mixed_hosts"}, None
    for c in caps:  # older captures may carry json-ld that trips the sensitive guard: leave it out
        bad = [j for j in c.get("meta", {}).get("jsonld", []) if pc.SENSITIVE.search(j)]
        for j in bad:
            c["text"] = c["text"].replace("\n" + j, "").replace(j, "")
        if bad:
            c["meta"]["jsonld"] = [j for j in c["meta"]["jsonld"] if j not in bad]
    pages = [{"url": c["url"], "text": c["text"], "fetched_at": c["fetched_at"], "redirect_chain": c["redirect_chain"],
              "meta": c.get("meta", {})} for c in caps]
    problems = []
    locs = location_options(pages, address, city, state)
    if location_quote:
        locs = [o for o in locs if o["quote"] == location_quote]
    if not locs:
        problems.append("no_location_quote")
    name = name or (name_options(pages) or [None])[0]
    nq = (next(((p["url"], name_quote) for p in pages if name_quote in p["text"]), None) if name_quote
          else (name_quotes(pages, name) or [None])[0] if name else None)
    if not nq:
        problems.append("no_name_quote")
    wanted = styles.split(",") if styles else [s for s in ("muay_thai", "kickboxing") if style_quotes(pages, s, name)]
    squotes = {}
    for s in wanted:
        q = (style_quotes(pages, s, name) or [None])[0]
        if q:
            squotes[s] = q
        else:
            problems.append(f"no_quote_for_{s}")
    if not squotes:
        problems.append("no_style")
    base = {"name": name, "styles": sorted(squotes), "official_url": pages[0]["url"],
            "quotes": {"name": nq[1] if nq else None, **{s: q for s, (_, q) in squotes.items()}}}
    if problems:
        return {"status": "incomplete", "problems": problems, **base, "address": address, "city": city, "state": state}, None
    last = None
    for loc in locs:
        street = address or loc["parsed"]["address"]
        record = {
            "schema_version": 1, "synthetic": False, "public_content": True, "official_site": True,
            "single_location": True, "official_url": pages[0]["url"], "name": name,
            "address": (full_address(loc["quote"], street) if loc["kind"] == "text" else None) or street,
            "city": city or loc["parsed"]["city"], "state": (state or loc["parsed"]["state"]).upper(), "country": "US",
            "styles": sorted(squotes), "discovered_at": min(p["fetched_at"] for p in pages),
            "pages": [{k: p[k] for k in ("url", "text", "fetched_at", "redirect_chain")} for p in pages],
            "evidence": {"name": {"url": nq[0], "quote": nq[1]},
                         "location": {"url": loc["url"], "quote": loc["quote"]},
                         "styles": {s: {"url": u, "quote": q} for s, (u, q) in squotes.items()}},
        }
        summary = {**base, "address": record["address"], "city": record["city"], "state": record["state"],
                   "location_basis": loc["basis"], "location_quote": loc["quote"][:300]}
        try:
            item = validate_scoped(record)
        except pc.Rejected as e:
            last = {"status": "rejected", "reason": str(e), **summary}
            continue
        if (record["city"], record["state"]) not in listed_cities():
            summary["new_city"] = f'{record["city"]}, {record["state"]}'
        return {"status": "valid", "id": item["id"][:12], **summary}, record
    return last or {"status": "rejected", "reason": "no_location_quote", **base}, None


# ---------- commands ----------

def cmd_init(args) -> None:
    states = sorted(s.strip().upper() for s in args.states.split(",") if s.strip())
    unknown = [s for s in states if s not in US_STATES]
    if unknown:
        raise SystemExit(f"unknown states: {unknown}")
    files = dict(pair.split("=", 1) for pair in args.city_file or [])
    missing = [s for s in states if s not in files]
    if missing:
        raise SystemExit(f"--city-file STATE=file.txt needed for {missing} (region list each new city joins)")
    for sub in ("captures", "leads", "final"):
        (RUN / sub).mkdir(mode=0o700, exist_ok=True)
    (RUN / "run.json").write_text(json.dumps({"name": RUN.name, "states": states, "city_files": files,
                                               "created": now_iso()}, indent=1))
    if not (RUN / "holds.json").exists():
        (RUN / "holds.json").write_text(json.dumps({"hosts": {}, "urls": {}}, indent=1))
    cmd_existing(args)
    print(json.dumps({"run": str(RUN), "states": states, "city_files": files}))


def cmd_existing(_args) -> None:
    rows = read_only("select g.name, p.city, p.state, g.website from gyms g left join places p on p.id = g.place_id "
                     "where not g.is_sample order by p.state, p.city, g.name")
    lines = [f"{r['name']} | {r['city']}, {r['state']} | {host_of(r['website'] or '')}" for r in rows]
    (RUN / "existing_gyms.txt").write_text("\n".join(lines) + "\n")
    print(f"{len(lines)} existing gyms -> {RUN / 'existing_gyms.txt'}")


def cmd_brief(args) -> None:
    template = (Path(__file__).parents[1] / "references/agent-brief.md").read_text()
    print(template.format(PY=PY, KIT=Path(__file__).resolve(), RUN=RUN, REGION=args.region, AREAS=args.areas,
                          LEADS=RUN / "leads" / f"{args.region}.jsonl", EXISTING=RUN / "existing_gyms.txt",
                          STATES=", ".join(sorted(TARGET))))


def cmd_capture(args) -> None:
    try:
        pc.public_url(args.url)
        cap = capture(args.url)
    except pc.Rejected as e:
        cap = {"error": str(e), "url": args.url}
    except httpx.HTTPError as e:
        cap = {"error": type(e).__name__, "url": args.url}
    if "error" in cap:
        print(json.dumps(cap))
        return
    slug = re.sub(r"[^a-z0-9]+", "-", urlsplit(cap["url"]).path.lower()).strip("-") or "home"
    out, n = RUN / "captures" / host_of(cap["url"]) / f"{slug}.json", 2
    while out.exists():  # never overwrite: a lead may already cite that capture
        out, n = out.with_name(f"{slug}-{n}.json"), n + 1
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(cap, ensure_ascii=False))
    pages = [cap]
    print(json.dumps({
        "capture": str(out), "url": cap["url"], "redirect_chain": cap["redirect_chain"], "chars": len(cap["text"]),
        "title": cap["meta"]["title"][:120], "name_options": name_options(pages),
        "locations": [{"basis": o["basis"], "quote": o["quote"][:300], "parsed": o["parsed"]} for o in location_options(pages)][:4],
        "styles": {s: [q for _, q in style_quotes(pages, s)[:2]] for s in STYLE_WORDS},
        "mentions": {k: len(re.findall(w, cap["text"], re.I)) for k, w in (
            ("muay_thai", r"muay[\s-]*thai"), ("kickboxing", r"kick[\s-]*box"), ("cardio", r"cardio|fitness kickboxing"),
            ("karate_tkd", r"karate|taekwondo|tae kwon do"), ("kids", r"\bkids?\b|children|youth"))},
        "follow_links": [u for u in cap["links"] if u.rstrip("/") != cap["url"].rstrip("/")][:10],
    }, ensure_ascii=False, indent=1))


def cmd_find(args) -> None:
    words = args.words.lower().split()
    for line in json.loads(Path(args.capture).read_text())["text"].split("\n"):
        if all(w in line.lower() for w in words):
            print(repr(line[:400]))


def cmd_propose(args) -> None:
    opts = {k: getattr(args, k) for k in ("name", "address", "city", "state", "styles", "name_quote", "location_quote")}
    result, _record = propose(args.captures, **opts)
    lead = {"kind": "proposal", "at": now_iso(), "captures": [str(Path(c).resolve()) for c in args.captures],
            "overrides": {k: v for k, v in opts.items() if v}, "note": args.note, "result": result}
    with (RUN / "leads" / f"{args.region}.jsonl").open("a") as fh:
        fh.write(json.dumps(lead, ensure_ascii=False) + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=1))


def cmd_skip(args) -> None:
    lead = {"kind": "skip", "at": now_iso(), "name": args.name, "url": args.url, "city": args.city,
            "state": args.state, "reason": args.reason}
    with (RUN / "leads" / f"{args.region}.jsonl").open("a") as fh:
        fh.write(json.dumps(lead, ensure_ascii=False) + "\n")
    print(json.dumps({"status": "skipped", **lead}))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", required=True, help="run name under ~/.local/share/fightgyms/runs, or a path")
    sub = ap.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("init")
    i.add_argument("--states", required=True)
    i.add_argument("--city-file", action="append", help="STATE=file.txt in scrapers/cities (repeat)")
    sub.add_parser("existing")
    b = sub.add_parser("brief")
    b.add_argument("--region", required=True)
    b.add_argument("--areas", required=True)
    c = sub.add_parser("capture")
    c.add_argument("url")
    f = sub.add_parser("find")
    f.add_argument("capture")
    f.add_argument("words")
    p = sub.add_parser("propose")
    p.add_argument("captures", nargs="+")
    p.add_argument("--region", required=True)
    for opt in ("--name", "--address", "--city", "--state", "--styles", "--location-quote", "--name-quote", "--note"):
        p.add_argument(opt)
    k = sub.add_parser("skip")
    for opt in ("--region", "--name", "--url", "--reason"):
        k.add_argument(opt, required=True)
    for opt in ("--city", "--state"):
        k.add_argument(opt)
    args = ap.parse_args()
    setup(run_dir(args.run))
    {"init": cmd_init, "existing": cmd_existing, "brief": cmd_brief, "capture": cmd_capture, "find": cmd_find,
     "propose": cmd_propose, "skip": cmd_skip}[args.cmd](args)


if __name__ == "__main__":
    main()

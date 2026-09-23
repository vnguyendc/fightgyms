"""Stage 3 — crawl a gym's website and extract prices / schedule / coaches with an LLM.

Usage:
  ANTHROPIC_API_KEY=... DATABASE_URL=... python extract_site.py            # all gyms with a website, none extracted in 30d
  python extract_site.py --gym-slug some-gym-arlington-va --dry-run       # one gym, print JSON only

Pipeline per gym:
  1. fetch homepage + up to MAX_PAGES internal pages whose URL matches PRIORITY (pricing, schedule, team ...)
  2. html -> text (trafilatura)
  3. one structured-output call with a strict JSON schema, temperature 0
  4. every number must carry a source_url + verbatim quote, else it is dropped
  5. range-check, then write prices (append, verified_by=website) and classes (replace)
Raw text and the model output are stored in `sources` for reprocessing.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urljoin, urlparse

import anthropic
import httpx
import trafilatura

sys.path.insert(0, str(Path(__file__).parent))
from common.db import add_source, conn, insert_price, replace_classes  # noqa: E402

MAX_PAGES = 12
PAGE_CHARS = 20_000     # per page; schedules on long homepages were getting cut at 15k
CORPUS_CHARS = 200_000  # ~50k tokens; pages are ordered money/schedule first so the tail is bios
PRIORITY = re.compile(r"pric|cost|fee|member|rate|schedule|class|timetable|team|staff|coach|trainer|instructor|about|trial", re.I)
# fetch order within the page budget: money + schedule pages first, individual staff bios last
TIER1 = re.compile(r"pric|cost|fee|member|rate|schedule|class|timetable|trial", re.I)
TIER3 = re.compile(r"/staff/|/coach/|/trainer/|/team/[^/]+", re.I)


def _score(u: str) -> int:
    return 0 if TIER1.search(u) else 2 if TIER3.search(u) else 1
UA = "Mozilla/5.0 (compatible; fightgyms-bot/0.1; +https://fightgyms.io/bot)"
MODEL = os.environ.get("EXTRACT_MODEL", "claude-haiku-4-5")

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "prices": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["kind", "amount_usd", "source_url", "quote"],
                "properties": {
                    "kind": {"enum": ["drop_in", "monthly", "fighter", "trial", "private", "class_pack"]},
                    "amount_usd": {"type": "number"},
                    "contract_months": {"type": ["integer", "null"]},
                    "free_trial": {"type": ["boolean", "null"]},
                    "notes": {"type": ["string", "null"]},
                    "source_url": {"type": "string"},
                    "quote": {"type": "string", "description": "verbatim text the price came from"},
                },
            },
        },
        "classes": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["dow", "start", "name", "source_url"],
                "properties": {
                    "dow": {"type": "integer", "description": "0=Sunday ... 6=Saturday"},  # strict mode forbids min/max; validate() range-checks
                    "start": {"type": "string", "pattern": "^\\d{2}:\\d{2}$"},
                    "end": {"type": ["string", "null"]},
                    "name": {"type": "string"},
                    "level": {"enum": ["beginner", "all", "advanced", "fighters", "kids", None]},
                    "style": {"enum": ["muay_thai", "kickboxing", "mma", "bjj", "boxing", "wrestling", "sc", "other", None]},
                    "source_url": {"type": "string"},
                },
            },
        },
        "coaches": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name"],
                "properties": {
                    "name": {"type": "string"},
                    "is_thai": {"type": ["boolean", "null"]},
                    "lineage": {"type": ["string", "null"]},
                    "pro_record": {"type": ["string", "null"]},
                },
            },
        },
        "styles": {"type": "array", "items": {"enum": ["muay_thai", "kickboxing", "dutch_kickboxing", "mma", "bjj", "boxing", "wrestling", "judo"]}},
        "tags": {"type": "array", "items": {"enum": ["beginner_friendly", "fighter_gym", "kids", "womens", "open_mat", "thai_trainers"]}},
        "founded_year": {"type": ["integer", "null"]},
        "instagram": {"type": ["string", "null"]},
    },
    "required": ["prices", "classes", "coaches", "styles", "tags"],
}

SYSTEM = """You extract structured facts about a combat sports gym from its website text.
Rules:
- Only report what the text states. Never guess a price or a class time.
- Every price and class MUST include source_url (the page it came from) and, for prices, a verbatim quote.
- Prices in USD. "drop_in" = single class walk-in. "monthly" = standard unlimited adult membership (lowest tier if several). "fighter" = fight team rate. "trial" = intro offer. "class_pack" = N-class pack (note the count in notes).
- Class dow: 0=Sunday ... 6=Saturday. Times 24h HH:MM.
- tags: beginner_friendly if beginner/fundamentals classes exist; fighter_gym if a fight team or competitive fighters are mentioned; thai_trainers if a coach is from Thailand.
- If nothing is found for a field, return an empty array or null."""


def _key(u: str) -> str:
    """http/https and www. variants of a page are the same page."""
    x = urlparse(u)
    return x.netloc.lower().removeprefix("www.") + x.path.rstrip("/")


WIDGETS = ("mindbody", "zenplanner", "glofox", "wodify", "pushpress", "gymdesk", "kicksite", "clubready", "mariana tek", "marianatek")


def crawl(base: str, *, provenance: dict[str, list[str]] | None = None) -> tuple[dict[str, str], str | None]:
    """Return ({url: text}, schedule_widget) for the homepage plus priority internal pages.

    Same-site is judged on the host *after* redirects (www.foo.com -> foo.com is common) and
    ignores www., otherwise every absolute nav link on the homepage gets dropped and we extract
    from one page. Links are harvested from every crawled page, bounded by MAX_PAGES.

    Optional provenance maps each original page URL to response.history URLs followed
    by the final response URL. It never changes page keys or the two-value return."""
    pages: dict[str, str] = {}
    seen: set[str] = set()
    origin: str | None = None
    widget: str | None = None
    queue = [base]
    with httpx.Client(headers={"User-Agent": UA}, follow_redirects=True, timeout=20) as client:
        while queue and len(pages) < MAX_PAGES:
            url = queue.pop(0)
            if _key(url) in seen:
                continue
            seen.add(_key(url))
            try:
                r = client.get(url)
                if r.status_code != 200 or "text/html" not in r.headers.get("content-type", ""):
                    continue
            except httpx.HTTPError:
                continue
            if origin is None:
                origin = urlparse(str(r.url)).netloc.lower().removeprefix("www.")
            html = r.text
            widget = widget or next((w for w in WIDGETS if w in html.lower()), None)
            text = trafilatura.extract(html, include_links=False, include_tables=True) or ""
            pages[url] = text[:PAGE_CHARS]
            if provenance is not None:
                provenance[url] = [str(response.url) for response in [*r.history, r]]
            for href in re.findall(r'href=["\']([^"\'#?]+)', html):
                u = urljoin(str(r.url), href)
                if urlparse(u).netloc.lower().removeprefix("www.") == origin and PRIORITY.search(u) and _key(u) not in seen:
                    queue.append(u)
            queue.sort(key=_score)
    return pages, widget


def extract(pages: dict[str, str]) -> dict:
    client = anthropic.Anthropic()
    corpus = "\n\n".join(f"### {u}\n{t}" for u, t in pages.items())
    if len(corpus) > CORPUS_CHARS:
        print(f"  corpus {len(corpus)} chars, truncating to {CORPUS_CHARS}", file=sys.stderr)
    resp = client.messages.create(
        model=MODEL,
        max_tokens=16000,
        # SDK 1.x dropped temperature from the signature; haiku-4-5 still honours it. drop this if EXTRACT_MODEL moves to a 4.7+ model.
        extra_body={"temperature": 0},
        system=SYSTEM,
        # strict: the api validates tool input against SCHEMA, so no more "<UNKNOWN>" times or prices-as-a-string
        tools=[{"name": "record_gym", "description": "Record extracted gym facts", "input_schema": SCHEMA, "strict": True}],
        tool_choice={"type": "tool", "name": "record_gym"},
        messages=[{"role": "user", "content": corpus[:CORPUS_CHARS]}],
    )
    if resp.stop_reason == "max_tokens":
        raise RuntimeError("extraction truncated at max_tokens; not writing a partial schedule")
    for block in resp.content:
        if block.type == "tool_use":
            return block.input
    return {"prices": [], "classes": [], "coaches": [], "styles": [], "tags": []}


HHMM = re.compile(r"^\d{2}:\d{2}$")
KIDS = re.compile(r"\b(kid|kids|youth|child|children|teen|junior|family)\b", re.I)
RANGES = {"drop_in": (10, 80), "monthly": (60, 400), "fighter": (0, 400), "trial": (0, 200), "private": (30, 300), "class_pack": (40, 1000)}


def _items(out: dict, key: str) -> list[dict]:
    """haiku's tool output is not schema-enforced: lists come back as dicts, items as strings,
    times as "<UNKNOWN>". anything that isn't a dict is dropped here so the db never sees it."""
    v = out.get(key)
    if isinstance(v, dict):
        v = list(v.values())
    return [x for x in (v or []) if isinstance(x, dict)]


def validate(out: dict, pages: dict[str, str]) -> dict:
    """Drop anything that can't be audited, is malformed, or is out of range."""
    good_prices = []
    for p in _items(out, "prices"):
        amt, kind = p.get("amount_usd"), p.get("kind")
        if not isinstance(amt, (int, float)) or kind not in RANGES or not isinstance(p.get("source_url"), str):
            continue
        lo, hi = RANGES[kind]
        page = pages.get(p["source_url"], "")
        if lo <= amt <= hi and str(int(amt)) in re.sub(r"[^\d]", " ", page):
            p["contract_months"] = p.get("contract_months") if isinstance(p.get("contract_months"), int) else None
            p["free_trial"] = p.get("free_trial") if isinstance(p.get("free_trial"), bool) else None
            p["notes"] = p.get("notes") if isinstance(p.get("notes"), str) else None
            good_prices.append(p)
    # kids/youth tiers are not the adult price, and the model reports them as "monthly" anyway.
    # then keep one row per kind (the lowest) so gym_current_prices never has to break a tie.
    best: dict[str, dict] = {}
    for p in good_prices:
        if KIDS.search(f"{p.get('quote', '')} {p.get('notes') or ''}"):
            continue
        if p["kind"] not in best or p["amount_usd"] < best[p["kind"]]["amount_usd"]:
            best[p["kind"]] = p
    out["prices"] = list(best.values())

    classes = []
    for c in _items(out, "classes"):
        if c.get("source_url") not in pages or not isinstance(c.get("dow"), int) or not 0 <= c["dow"] <= 6:
            continue
        if not isinstance(c.get("start"), str) or not HHMM.match(c["start"]):
            continue
        c["end"] = c["end"] if isinstance(c.get("end"), str) and HHMM.match(c["end"]) else None
        c["name"] = c.get("name") if isinstance(c.get("name"), str) else None
        c["level"] = c.get("level") if c.get("level") in ("beginner", "all", "advanced", "fighters", "kids") else None
        c["style"] = c.get("style") if isinstance(c.get("style"), str) else None
        classes.append(c)
    out["classes"] = classes
    out["coaches"] = [c for c in _items(out, "coaches") if isinstance(c.get("name"), str) and "unknown" not in c["name"].lower()]
    out["styles"] = [x for x in (out.get("styles") or []) if isinstance(x, str)] if isinstance(out.get("styles"), list) else []
    out["tags"] = [x for x in (out.get("tags") or []) if isinstance(x, str)] if isinstance(out.get("tags"), list) else []
    out["founded_year"] = out.get("founded_year") if isinstance(out.get("founded_year"), int) and 1900 < out["founded_year"] < 2100 else None
    out["instagram"] = out.get("instagram") if isinstance(out.get("instagram"), str) else None
    return out


def process(gym: dict, dry_run: bool, *, shadow_report: str | Path | None = None,
            shadow_model: str | None = None) -> None:
    provenance: dict[str, list[str]] = {}
    pages, widget = (crawl(gym["website"]) if shadow_report is None
                     else crawl(gym["website"], provenance=provenance))
    if shadow_report is not None:
        try:
            if __package__:
                from . import jev_triage
            else:
                import jev_triage
            # Check every page before bounding; original keys cannot attest redirected text.
            # URL guardrails only, not DNS-rebinding/SSRF protection for the existing crawler.
            safe_provenance = bool(pages) and all(
                jev_triage.public_url(url) and isinstance(provenance.get(url), list)
                and bool(provenance[url]) and all(jev_triage.public_url(source) for source in provenance[url])
                for url in pages
            )
            # A detached copy: shadow recommendations never filter the extractor's pages.
            record = {"public_content": safe_provenance,
                      "pages": [{"url": provenance[url][-1], "text": text} for url, text in pages.items()]
                      if safe_provenance else []}
            row = jev_triage.evaluate(record, model=shadow_model)
            if not safe_provenance:
                row["reasons"] = ["unsafe_or_unknown_provenance"]
            with Path(shadow_report).open("a", encoding="utf-8") as report:
                report.write(json.dumps(row, allow_nan=False) + "\n")
        except Exception:  # Shadow is advisory; even report I/O failure must not gate extraction.
            print("  shadow_report_failed", file=sys.stderr)
    if not pages:
        print(f"  no pages for {gym['slug']}", file=sys.stderr)
        return
    out = validate(extract(pages), pages)
    out["_schedule_widget"] = widget
    if dry_run:
        print(json.dumps(out, indent=2))
        return
    with conn() as c, c.cursor() as cur:
        sid = add_source(cur, "website", gym["website"], {"pages": list(pages), "extracted": out})
        for p in out["prices"]:
            insert_price(cur, gym["id"], {**p, "amount_cents": int(round(p["amount_usd"] * 100))}, sid, "website")
        replace_classes(cur, gym["id"], out["classes"], sid)
        cur.execute(
            """
            update gyms set
              styles = coalesce((select array_agg(distinct s) from unnest(styles || %s::text[]) s), '{}'),
              tags   = coalesce((select array_agg(distinct t) from unnest(tags   || %s::text[]) t), '{}'),
              founded_year = coalesce(founded_year, %s),
              instagram    = coalesce(instagram, %s)
            where id = %s
            """,
            (out.get("styles", []), out.get("tags", []), out.get("founded_year"), out.get("instagram"), gym["id"]),
        )
        c.commit()
    print(f"  {gym['slug']}: {len(out['prices'])} prices, {len(out['classes'])} classes, widget={widget}", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gym-slug")
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--shadow-report", help="Opt-in Jev recommendation JSONL (never gates extraction)")
    ap.add_argument("--shadow-limit", type=int, default=10, help="Shadow at most 1-10 gyms; extraction limit is unchanged")
    ap.add_argument("--shadow-model", help="Pinned Jev version override; otherwise TYPESAFE_MODEL/default")
    args = ap.parse_args()
    if args.shadow_report and not 1 <= args.shadow_limit <= 10:
        ap.error("shadow-limit must be between 1 and 10")
    with conn() as c, c.cursor() as cur:
        if args.gym_slug:
            cur.execute("select id, slug, website from gyms where slug = %s", (args.gym_slug,))
        else:
            cur.execute(
                """
                select g.id, g.slug, g.website from gyms g
                where g.website is not null and g.is_active
                  and not exists (
                    select 1 from sources s where s.kind = 'website' and s.url = g.website
                      and s.fetched_at > now() - interval '30 days')
                order by ('muay_thai' = any(g.styles) or 'kickboxing' = any(g.styles)) desc, g.google_reviews desc nulls last
                limit %s
                """,
                (args.limit,),
            )
        gyms = cur.fetchall()
    for index, g in enumerate(gyms):
        print(g["slug"], file=sys.stderr)
        try:
            if args.shadow_report and index < args.shadow_limit:
                process(g, args.dry_run, shadow_report=args.shadow_report, shadow_model=args.shadow_model)
            else:
                if args.shadow_report and index == args.shadow_limit:
                    print("  shadow_limit_reached; extraction continues", file=sys.stderr)
                process(g, args.dry_run)
        except Exception as e:  # noqa: BLE001
            print(f"  failed: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()

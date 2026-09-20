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
PRIORITY = re.compile(r"pric|cost|fee|member|rate|schedule|class|timetable|team|staff|coach|trainer|instructor|about|trial", re.I)
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
                    "dow": {"type": "integer", "minimum": 0, "maximum": 6, "description": "0=Sunday"},
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


def crawl(base: str) -> dict[str, str]:
    """Return {url: text} for the homepage plus priority internal pages."""
    pages: dict[str, str] = {}
    origin = urlparse(base).netloc
    queue = [base]
    with httpx.Client(headers={"User-Agent": UA}, follow_redirects=True, timeout=20) as client:
        while queue and len(pages) < MAX_PAGES:
            url = queue.pop(0)
            if url in pages:
                continue
            try:
                r = client.get(url)
                if r.status_code != 200 or "text/html" not in r.headers.get("content-type", ""):
                    continue
            except httpx.HTTPError:
                continue
            html = r.text
            text = trafilatura.extract(html, include_links=False, include_tables=True) or ""
            pages[url] = text[:15000]
            if url == base:
                links = re.findall(r'href=["\']([^"\'#?]+)', html)
                for href in links:
                    u = urljoin(base, href)
                    if urlparse(u).netloc == origin and PRIORITY.search(u) and u not in pages:
                        queue.append(u)
    return pages


def detect_schedule_widget(html_pages: dict[str, str]) -> str | None:
    blob = " ".join(html_pages.values()).lower()
    for w in ("mindbody", "zenplanner", "glofox", "wodify", "pushpress", "gymdesk"):
        if w in blob:
            return w
    return None


def extract(pages: dict[str, str]) -> dict:
    client = anthropic.Anthropic()
    corpus = "\n\n".join(f"### {u}\n{t}" for u, t in pages.items())
    resp = client.messages.create(
        model=MODEL,
        max_tokens=4000,
        temperature=0,
        system=SYSTEM,
        tools=[{"name": "record_gym", "description": "Record extracted gym facts", "input_schema": SCHEMA}],
        tool_choice={"type": "tool", "name": "record_gym"},
        messages=[{"role": "user", "content": corpus[:120000]}],
    )
    for block in resp.content:
        if block.type == "tool_use":
            return block.input
    return {"prices": [], "classes": [], "coaches": [], "styles": [], "tags": []}


def validate(out: dict, pages: dict[str, str]) -> dict:
    """Drop anything that can't be audited or is out of range."""
    ranges = {"drop_in": (10, 80), "monthly": (60, 400), "fighter": (0, 400), "trial": (0, 200), "private": (30, 300), "class_pack": (40, 1000)}
    good_prices = []
    for p in out.get("prices", []):
        lo, hi = ranges.get(p["kind"], (0, 10_000))
        page = pages.get(p["source_url"], "")
        digits = re.sub(r"[^\d]", "", str(int(p["amount_usd"])))
        if lo <= p["amount_usd"] <= hi and digits in re.sub(r"[^\d]", " ", page):
            good_prices.append(p)
        else:
            p["_dropped"] = "range" if not (lo <= p["amount_usd"] <= hi) else "not_in_source"
    out["prices"] = good_prices
    out["classes"] = [c for c in out.get("classes", []) if c["source_url"] in pages]
    return out


def process(gym: dict, dry_run: bool) -> None:
    pages = crawl(gym["website"])
    if not pages:
        print(f"  no pages for {gym['slug']}", file=sys.stderr)
        return
    widget = detect_schedule_widget(pages)
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
              styles = (select array_agg(distinct s) from unnest(styles || %s::text[]) s),
              tags   = (select array_agg(distinct t) from unnest(tags   || %s::text[]) t),
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
    args = ap.parse_args()
    with conn() as c, c.cursor() as cur:
        if args.gym_slug:
            cur.execute("select id, slug, website from gyms where slug = %s", (args.gym_slug,))
        else:
            cur.execute(
                """
                select g.id, g.slug, g.website from gyms g
                where g.website is not null and g.is_active
                  and not exists (
                    select 1 from gym_prices p where p.gym_id = g.id and p.verified_by = 'website'
                      and p.verified_at > current_date - 30)
                limit %s
                """,
                (args.limit,),
            )
        gyms = cur.fetchall()
    for g in gyms:
        print(g["slug"], file=sys.stderr)
        try:
            process(g, args.dry_run)
        except Exception as e:  # noqa: BLE001
            print(f"  failed: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()

"""Stage 2b — pull photos from each gym's website into Supabase Storage.

Usage:
  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... ANTHROPIC_API_KEY=... DATABASE_URL=... \\
    python fetch_photos.py --limit 50            # gyms with a website and no active photos
  python fetch_photos.py --gym-slug some-gym-va  # one gym
  python fetch_photos.py --url https://somegym.com --dry-run   # any site, print verdicts, write nothing
  python fetch_photos.py --refresh               # include gyms that already have photos; adds new ones only

Pipeline per gym:
  1. fetch homepage + one gallery/photos/facility/tour page
  2. collect og:image, twitter:image, <img>/<source> (largest srcset entry), lazy-load attrs
  3. skip logos/icons/svg by url; same-origin first; download; drop < MIN_WIDTH px or extreme aspect; dedupe by hash
  4. Claude vision classifies each candidate; keep gym_space / training / team (portraits, logos, stock dropped)
  5. resize to MAX_EDGE, webp, upload to storage bucket gym-photos under <gym_id>/<hash>.webp
  6. insert gym_photos rows (credit=website) with a sources row holding every candidate + verdict
Photos credited gym_claim are never touched.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

import anthropic
import httpx
from PIL import Image, ImageOps

sys.path.insert(0, str(Path(__file__).parent))
from common import storage  # noqa: E402
from common.db import add_source, conn  # noqa: E402

UA = "Mozilla/5.0 (compatible; fightgyms-bot/0.1; +https://fightgyms.io/bot)"
MODEL = os.environ.get("EXTRACT_MODEL", "claude-haiku-4-5")
MIN_WIDTH = 600
MAX_EDGE = 1600
MAX_DOWNLOADS = 30    # candidate urls fetched per gym
MAX_CLASSIFY = 10     # vision calls per gym (only images that pass the size filter)
MAX_KEEP = 6
MAX_BYTES = 10 * 1024 * 1024
GALLERY = re.compile(r"gallery|photos|facility|facilities|tour|our-gym|the-gym", re.I)
NOISE = re.compile(r"logo|icon|sprite|favicon|badge|pixel|tracking|avatar|placeholder|spacer|blank\.|\.svg($|\?)|\.gif($|\?)", re.I)
FILENAME_ALT = re.compile(r"\.(png|jpe?g|webp|gif|svg)$|^[\w-]+$", re.I)  # "gym2 3.png", "IMG_4021", "hero-1"
KEEP = {"gym_space", "training", "team"}
LIVE_STYLES = ["muay_thai", "kickboxing"]  # mirror of web/src/lib/types.ts LIVE_STYLES; public gyms go first
PRIMARY_ORDER = ["gym_space", "training", "team"]  # a portrait never leads a listing

CLASSIFY_TOOL = {
    "name": "classify_photo",
    "description": "Classify a candidate photo from a combat sports gym website",
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["category", "alt"],
        "properties": {
            "category": {
                "enum": ["gym_space", "training", "team", "portrait", "logo_graphic", "stock", "other"],
                "description": (
                    "gym_space: interior/exterior of the actual gym (ring, mats, bags, cage). "
                    "training: people training or sparring in a gym. "
                    "team: coaches, fighters or a group photographed inside the gym or in fight gear. "
                    "portrait: headshot, selfie or testimonial photo of a person with no gym context. "
                    "logo_graphic: logo, text banner, promo graphic, screenshot, flyer. "
                    "stock: generic stock photography not clearly of this gym. "
                    "other: anything else (merch, food, unrelated)."
                ),
            },
            "alt": {"type": "string", "description": "short literal description for alt text, under 12 words"},
        },
    },
}


# ---------------------------------------------------------------------------
# html -> candidate urls
# ---------------------------------------------------------------------------

def _best_srcset(srcset: str) -> str | None:
    best, best_w = None, -1.0
    for part in srcset.split(","):
        bits = part.strip().split()
        if not bits:
            continue
        url, w = bits[0], 0.0
        if len(bits) > 1:
            m = re.match(r"([\d.]+)[wx]", bits[1])
            if m:
                w = float(m.group(1))
        if w > best_w:
            best, best_w = url, w
    return best


class _Collector(HTMLParser):
    def __init__(self, base: str):
        super().__init__()
        self.base = base
        self.meta: list[str] = []
        self.body: list[dict] = []
        self.links: list[str] = []
        self._picture: list[str] | None = None

    def _abs(self, u: str) -> str:
        return urljoin(self.base, u.strip())

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta":
            key = (a.get("property") or a.get("name") or "").lower()
            if key in ("og:image", "og:image:secure_url", "twitter:image", "twitter:image:src") and a.get("content"):
                self.meta.append(self._abs(a["content"]))
        elif tag == "a" and a.get("href"):
            self.links.append(self._abs(a["href"]))
        elif tag == "picture":
            self._picture = []
        elif tag == "source" and self._picture is not None:
            ss = a.get("srcset") or a.get("data-srcset")
            if ss and (u := _best_srcset(ss)):
                self._picture.append(self._abs(u))
        elif tag == "img":
            try:
                w, h = int(a.get("width") or 0), int(a.get("height") or 0)
            except ValueError:
                w = h = 0
            if w and h and w < 300 and h < 300:
                return
            alt = (a.get("alt") or "").strip() or None
            if self._picture:
                self.body.append({"url": self._picture[0], "alt": alt})
                self._picture = []
                return
            ss = a.get("srcset") or a.get("data-srcset")
            u = _best_srcset(ss) if ss else None
            u = u or a.get("data-src") or a.get("data-lazy-src") or a.get("data-original") or a.get("src")
            if u:
                self.body.append({"url": self._abs(u), "alt": alt})

    def handle_endtag(self, tag):
        if tag == "picture":
            self._picture = None


def _ok_url(u: str) -> bool:
    return u.startswith(("http://", "https://")) and not NOISE.search(u)


def extract_candidates(html: str, base_url: str) -> list[dict]:
    """og/twitter images, then same-origin body images, then third-party ones. Deduped, noise removed."""
    p = _Collector(base_url)
    p.feed(html)
    origin = urlparse(base_url).netloc
    same = [c for c in p.body if urlparse(c["url"]).netloc == origin]
    other = [c for c in p.body if urlparse(c["url"]).netloc != origin]
    out: list[dict] = []
    seen: set[str] = set()
    for c in [{"url": u, "alt": None} for u in p.meta] + same + other:
        u = c["url"]
        if u in seen or not _ok_url(u):
            continue
        seen.add(u)
        out.append(c)
    return out


def find_gallery_url(html: str, base_url: str) -> str | None:
    p = _Collector(base_url)
    p.feed(html)
    origin = urlparse(base_url).netloc
    for u in p.links:
        pu = urlparse(u)
        if pu.netloc == origin and GALLERY.search(pu.path) and pu.path.rstrip("/") != urlparse(base_url).path.rstrip("/"):
            return u
    return None


# ---------------------------------------------------------------------------
# download / prepare / classify
# ---------------------------------------------------------------------------

def fetch_html(client: httpx.Client, url: str) -> str | None:
    try:
        r = client.get(url)
    except httpx.HTTPError:
        return None
    if r.status_code != 200 or "text/html" not in r.headers.get("content-type", ""):
        return None
    return r.text


def download(client: httpx.Client, url: str) -> bytes | None:
    try:
        with client.stream("GET", url) as r:
            if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/"):
                return None
            buf = bytearray()
            for chunk in r.iter_bytes():
                buf.extend(chunk)
                if len(buf) > MAX_BYTES:
                    return None
            return bytes(buf)
    except httpx.HTTPError:
        return None


def prepare(data: bytes) -> tuple[bytes, int, int] | None:
    """Validate size/aspect, downscale to MAX_EDGE, encode webp. None if unusable."""
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception:  # noqa: BLE001 — any decode failure means skip
        return None
    img = ImageOps.exif_transpose(img)
    w, h = img.size
    if w < MIN_WIDTH or not (0.5 <= w / h <= 3.0):
        return None
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    img.thumbnail((MAX_EDGE, MAX_EDGE))
    out = io.BytesIO()
    img.save(out, format="WEBP", quality=82, method=4)
    return out.getvalue(), img.size[0], img.size[1]


def classify(client: anthropic.Anthropic, webp: bytes) -> dict:
    resp = client.messages.create(
        model=MODEL,
        max_tokens=256,
        # sdk 1.x dropped temperature from the signature; haiku-4-5 still honours it (see extract_site.py)
        extra_body={"temperature": 0},
        tools=[{**CLASSIFY_TOOL, "strict": True}],
        tool_choice={"type": "tool", "name": "classify_photo"},
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/webp", "data": base64.b64encode(webp).decode()}},
                {"type": "text", "text": "This image was found on a combat sports gym's website. Classify it."},
            ],
        }],
    )
    for block in resp.content:
        if block.type == "tool_use":
            return dict(block.input)
    return {"category": "other", "alt": ""}


# ---------------------------------------------------------------------------
# per-site pipeline
# ---------------------------------------------------------------------------

def collect_site(website: str) -> tuple[list[dict], list[str]]:
    """Return (candidates, pages fetched)."""
    pages: list[str] = []
    cands: list[dict] = []
    with httpx.Client(headers={"User-Agent": UA}, follow_redirects=True, timeout=20) as client:
        html = fetch_html(client, website)
        if html is None:
            return [], []
        pages.append(website)
        cands.extend(extract_candidates(html, website))
        gallery = find_gallery_url(html, website)
        if gallery:
            ghtml = fetch_html(client, gallery)
            if ghtml is not None:
                pages.append(gallery)
                seen = {c["url"] for c in cands}
                cands.extend(c for c in extract_candidates(ghtml, gallery) if c["url"] not in seen)
    return cands[:MAX_DOWNLOADS], pages


def process_site(website: str, gym_name: str = "") -> tuple[list[dict], list[dict], list[str]]:
    """Download, filter, classify. Returns (kept, all_verdicts, pages).
    kept items carry webp bytes under 'data'; verdicts are json-safe."""
    cands, pages = collect_site(website)
    llm = anthropic.Anthropic()
    kept: list[dict] = []
    verdicts: list[dict] = []
    seen_hash: set[str] = set()
    classified = 0
    with httpx.Client(headers={"User-Agent": UA}, follow_redirects=True, timeout=30) as client:
        for c in cands:
            v = {"url": c["url"], "alt": c["alt"]}
            raw = download(client, c["url"])
            if raw is None:
                v["dropped"] = "download"
                verdicts.append(v)
                continue
            prepped = prepare(raw)
            if prepped is None:
                v["dropped"] = "size_or_aspect"
                verdicts.append(v)
                continue
            data, w, h = prepped
            digest = hashlib.sha1(data).hexdigest()[:16]
            if digest in seen_hash:
                v["dropped"] = "duplicate"
                verdicts.append(v)
                continue
            seen_hash.add(digest)
            if classified >= MAX_CLASSIFY:
                v["dropped"] = "max_classify"
                verdicts.append(v)
                continue
            classified += 1
            cls = classify(llm, data)
            v.update({"category": cls.get("category"), "model_alt": cls.get("alt"), "width": w, "height": h})
            if cls.get("category") in KEEP and len(kept) < MAX_KEEP:
                site_alt = c["alt"] if c["alt"] and not FILENAME_ALT.search(c["alt"].strip()) else None
                kept.append({**v, "hash": digest, "data": data, "alt_text": site_alt or cls.get("alt") or gym_name or None})
            else:
                v["dropped"] = "category" if cls.get("category") not in KEEP else "max_keep"
            verdicts.append(v)
    kept.sort(key=lambda k: PRIMARY_ORDER.index(k["category"]))
    return kept, verdicts, pages


def write_photos(gym_id: str, website: str, kept: list[dict], verdicts: list[dict], pages: list[str]) -> int:
    with conn() as c, c.cursor() as cur:
        sid = add_source(cur, "website", website, {"pages": pages, "candidates": verdicts})
        cur.execute("select count(*) n from gym_photos where gym_id = %s and is_active", (gym_id,))
        existing = cur.fetchone()["n"]
        n = 0
        for i, k in enumerate(kept):
            path = f"{gym_id}/{k['hash']}.webp"
            storage.upload(path, k["data"])
            cur.execute(
                """
                insert into gym_photos (gym_id, storage_path, width, height, alt, credit, source_url, source_id, is_primary, sort_order)
                values (%s, %s, %s, %s, %s, 'website', %s, %s, %s, %s)
                on conflict (storage_path) do nothing
                """,
                (gym_id, path, k["width"], k["height"], k["alt_text"], k["url"], sid, existing == 0 and i == 0, existing + i),
            )
            n += cur.rowcount
        c.commit()
    return n


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gym-slug")
    ap.add_argument("--url", help="run against any site; implies --dry-run")
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--refresh", action="store_true", help="include gyms that already have photos")
    ap.add_argument("--public-only", action="store_true", help="only gyms with a live discipline (listed on the site)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    dry = args.dry_run or bool(args.url)

    if args.url:
        gyms = [{"id": None, "slug": urlparse(args.url).netloc, "website": args.url, "name": ""}]
    else:
        with conn() as c, c.cursor() as cur:
            if args.gym_slug:
                cur.execute("select id, slug, name, website from gyms where slug = %s", (args.gym_slug,))
            else:
                cur.execute(
                    """
                    select g.id, g.slug, g.name, g.website from gyms g
                    where g.website is not null and g.is_active and not g.is_sample
                      and (%s or g.styles && %s::text[])
                      and (%s or not exists (select 1 from gym_photos p where p.gym_id = g.id and p.is_active))
                      -- skip sites attempted in the last 30 days, even if they yielded nothing
                      and not exists (
                        select 1 from sources s where s.kind = 'website' and s.url = g.website
                          and s.raw ? 'candidates' and s.fetched_at > now() - interval '30 days')
                    order by (g.styles && %s::text[]) desc, g.created_at
                    limit %s
                    """,
                    (not args.public_only, LIVE_STYLES, args.refresh, LIVE_STYLES, args.limit),
                )
            gyms = cur.fetchall()

    if not dry and not storage.configured():
        sys.exit("SUPABASE_URL and SUPABASE_SERVICE_KEY required (or use --dry-run)")

    for g in gyms:
        if not g["website"]:
            continue
        print(g["slug"], file=sys.stderr)
        try:
            kept, verdicts, pages = process_site(g["website"], g["name"])
            if dry:
                print(json.dumps({"pages": pages, "kept": [k["url"] for k in kept], "candidates": verdicts}, indent=2))
                continue
            n = write_photos(g["id"], g["website"], kept, verdicts, pages)
        except Exception as e:  # noqa: BLE001 — one bad site or upload must not stop the batch
            print(f"  failed: {type(e).__name__}: {e}", file=sys.stderr)
            continue
        print(f"  {len(verdicts)} candidates -> {len(kept)} kept, {n} new", file=sys.stderr)


if __name__ == "__main__":
    main()

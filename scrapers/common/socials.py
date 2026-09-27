"""Social profile links found on a gym's own website. Pure: no network, no database.

parse(url)              -> {"platform", "url", "handle"} for a profile / page / channel url, else None.
harvest(html, base_url) -> every profile a page links to, from <a href> and JSON-LD sameAs, with a weight.
rank(found, website, name, city) -> one entry per profile with a count, best first per platform.
pick(ranked)            -> the best profile per platform.
Posts, videos, share buttons, feature pages and the accounts of the platforms, site builders
and feed widgets themselves are all None: linking a gym to someone else's profile is worse than
linking nothing.
"""
from __future__ import annotations

import json
import os
import re
from html.parser import HTMLParser
from urllib.parse import parse_qs, urljoin, urlsplit

PLATFORMS = ("instagram", "facebook", "tiktok", "youtube", "x")

_HOSTS = {
    "instagram.com": "instagram",
    "facebook.com": "facebook", "fb.com": "facebook",
    "tiktok.com": "tiktok",
    "youtube.com": "youtube",
    "twitter.com": "x", "x.com": "x",
}
_SUBDOMAINS = ("www.", "m.", "mobile.", "web.", "business.")

# first path segments that are site features, not accounts
_RESERVED = {
    "instagram": {"p", "reel", "reels", "explore", "accounts", "stories", "tv", "direct", "about", "legal", "developer",
                  "press", "api", "share", "s", "oauth", "static", "ar", "web", "challenge", "emails", "invites", "terms",
                  "privacy", "blog", "locations", "topics", "lite", "nametag", "igtv", "guide", "guides", "live"},
    "facebook": {"sharer", "share", "dialog", "plugins", "login", "groups", "events", "photo", "photos", "video", "videos",
                 "watch", "hashtag", "help", "policies", "policy", "privacy", "about", "legal", "terms", "settings",
                 "marketplace", "gaming", "stories", "reel", "reels", "media", "ads", "business", "careers", "developers",
                 "tr", "notes", "search", "messages", "friends", "bookmarks", "recover", "security", "checkpoint", "flx",
                 "campaign", "ad_campaign", "n", "posts", "pages", "people", "pg", "profile.php"},
    "x": {"i", "intent", "share", "home", "hashtag", "search", "login", "signup", "explore", "settings", "messages",
          "notifications", "compose", "tos", "privacy", "about", "download", "help", "jobs", "who_to_follow", "account",
          "oauth", "en", "terms", "rules", "logout"},
}
_HANDLE = {
    "instagram": re.compile(r"^[A-Za-z0-9._]{1,30}$"),
    "facebook": re.compile(r"^[A-Za-z0-9.\-]{2,}$"),
    "tiktok": re.compile(r"^[A-Za-z0-9._]{1,24}$"),
    "youtube": re.compile(r"^[A-Za-z0-9._\-]{3,30}$"),
    "x": re.compile(r"^[A-Za-z0-9_]{1,15}$"),
}
_CHANNEL_ID = re.compile(r"^UC[\w-]{22}$")
_DOMAIN_LIKE = re.compile(r"\.(com|net|org|co|us|io|info|biz)$", re.I)  # "instagram.com/example.com": a broken link, not a handle
# the platforms themselves, site builders and feed widgets: their accounts are linked from thousands of gym sites
_VENDORS = frozenset("""instagram facebook meta tiktok youtube twitter x google wix wixcom squarespace godaddy wordpress
wordpressdotcom weebly shopify webflow duda jimdo site123 strikingly mindbody mindbodyonline zenplanner glofox pushpress
wodify kicksite clubready marianatek gymdesk elfsight smashballoon lightwidget snapwidget powr powrio taggbox juicer
juicerio embedsocial sociablekit linktree""".split())


def _norm(handle: str) -> str:
    return re.sub(r"[._\-]", "", handle.lower())


def _account(platform: str, name: str, url: str) -> dict | None:
    """A named account on `platform`, unless the name is a feature path, malformed, or a vendor."""
    if (name in _RESERVED.get(platform, ()) or name.endswith(".php") or _DOMAIN_LIKE.search(name)
            or not _HANDLE[platform].match(name) or _norm(name) in _VENDORS):
        return None
    return {"platform": platform, "url": url, "handle": name}


def parse(url: str) -> dict | None:
    """Canonical profile for a social url, or None for posts, share buttons, feature pages and non-social urls."""
    if not url:
        return None
    s = urlsplit(url.strip())
    host = s.hostname or ""
    for prefix in _SUBDOMAINS:
        host = host.removeprefix(prefix)
    platform = _HOSTS.get(host)
    if platform is None:
        return None
    seg = [x for x in s.path.split("/") if x]
    if not seg:
        return None
    head = seg[0]

    if platform == "instagram":
        return _account(platform, head, f"https://www.instagram.com/{head}")

    if platform == "facebook":
        if head == "profile.php":
            pid = parse_qs(s.query).get("id", [""])[0]
            return {"platform": platform, "url": f"https://www.facebook.com/profile.php?id={pid}", "handle": None} if pid.isdigit() else None
        if head in ("pages", "people"):
            keep = 4 if len(seg) > 1 and seg[1] == "category" else 3
            return {"platform": platform, "url": "https://www.facebook.com/" + "/".join(seg[:keep]), "handle": None} if len(seg) >= keep else None
        if head == "pg":
            return _account(platform, seg[1], f"https://www.facebook.com/{seg[1]}") if len(seg) > 1 else None
        return _account(platform, head, f"https://www.facebook.com/{head}")

    if platform == "tiktok":
        return _account(platform, head[1:], f"https://www.tiktok.com/{head}") if head.startswith("@") else None

    if platform == "youtube":
        if head.startswith("@"):
            return _account(platform, head[1:], f"https://www.youtube.com/{head}")
        if head == "channel" and len(seg) > 1 and _CHANNEL_ID.match(seg[1]):
            return {"platform": platform, "url": f"https://www.youtube.com/channel/{seg[1]}", "handle": None}
        if head in ("c", "user") and len(seg) > 1:
            return _account(platform, seg[1], f"https://www.youtube.com/{head}/{seg[1]}")
        return None

    return _account(platform, head, f"https://x.com/{head}")


class _Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hrefs: list[str] = []
        self.ld: list[str] = []
        self._in_ld = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "a" and a.get("href"):
            self.hrefs.append(a["href"])
        elif tag == "script" and (a.get("type") or "").strip().lower() == "application/ld+json":
            self._in_ld = True
            self.ld.append("")

    def handle_data(self, data):
        if self._in_ld:
            self.ld[-1] += data

    def handle_endtag(self, tag):
        if tag == "script":
            self._in_ld = False


def _same_as(node) -> list[str]:
    """Every sameAs string anywhere in a JSON-LD document (@graph, nested entities)."""
    out: list[str] = []
    if isinstance(node, dict):
        v = node.get("sameAs")
        out.extend([v] if isinstance(v, str) else [x for x in v if isinstance(x, str)] if isinstance(v, list) else [])
        for k, child in node.items():
            if k != "sameAs":
                out.extend(_same_as(child))
    elif isinstance(node, list):
        for child in node:
            out.extend(_same_as(child))
    return out


def _json(blob: str):
    try:
        return json.loads(blob)
    except ValueError:
        return None


def harvest(html: str, base_url: str) -> list[dict]:
    """Profiles linked from one page, anchors first in document order, then JSON-LD sameAs.
    sameAs is the site declaring its own identity, so it weighs 2; an anchor weighs 1."""
    p = _Links()
    p.feed(html)
    out: list[dict] = []
    for href, weight in [(h, 1) for h in p.hrefs] + [(u, 2) for blob in p.ld for u in _same_as(_json(blob))]:
        s = parse(urljoin(base_url, href.strip()))
        if s:
            out.append({**s, "source_url": base_url, "weight": weight})
    return out


_SECOND_LEVEL = {"co", "com", "org", "net", "ac", "gov", "edu"}


def _label(website: str) -> str:
    """The site's own name in its domain: siamstrike for www.siamstrike.com or siam-strike.co.uk."""
    parts = (urlsplit(website).hostname or "").removeprefix("www.").split(".")
    if len(parts) >= 3 and parts[-2] in _SECOND_LEVEL:
        return parts[-3]
    return parts[-2] if len(parts) >= 2 else parts[0]


def _similar(handle: str | None, label: str, name: str = "") -> bool:
    """The handle looks like the site's own: it contains / is contained in the domain label, or shares a 6+
    character prefix with the domain label or the gym name (a sub-brand page on the parent company's domain)."""
    h = _norm(handle or "")
    if len(h) < 4:
        return False
    lab, nm = _norm(label), re.sub(r"[^a-z0-9]", "", name.lower())
    if len(lab) >= 4 and (h in lab or lab in h):
        return True
    return any(len(os.path.commonprefix([h, x])) >= 6 for x in (lab, nm) if x)


def rank(found: list[dict], website: str, name: str = "", city: str = "") -> list[dict]:
    """One entry per profile with count = sum of weights, best first within each platform: a handle that
    resembles the site's own domain or the gym's name and also names the gym's city (a location's own account
    on a multi-location brand's site), then one that merely resembles them, then the most linked, then first
    seen. A coach's personal account is usually linked once from a bio; the gym's is in the header, the footer
    and its sameAs."""
    label = _label(website)
    city_norm = re.sub(r"[^a-z0-9]", "", city.lower())
    agg: dict[tuple[str, str], dict] = {}
    for f in found:
        key = (f["platform"], f["url"].lower())  # handles are case-insensitive on every platform here
        if key not in agg:
            similar = _similar(f["handle"], label, name)
            local = bool(city_norm) and len(city_norm) >= 3 and city_norm in _norm(f["handle"] or "")
            agg[key] = {"platform": f["platform"], "url": f["url"], "handle": f["handle"], "source_url": f["source_url"],
                        "count": 0, "similar": similar, "local": similar and local}
        agg[key]["count"] += f.get("weight", 1)
    # stable sort keeps first-seen order among ties
    return sorted(agg.values(), key=lambda r: (PLATFORMS.index(r["platform"]), not r["local"], not r["similar"], -r["count"]))


def pick(ranked: list[dict]) -> list[dict]:
    """The best profile per platform, in PLATFORMS order."""
    best: dict[str, dict] = {}
    for r in ranked:
        best.setdefault(r["platform"], r)
    return [best[p] for p in PLATFORMS if p in best]

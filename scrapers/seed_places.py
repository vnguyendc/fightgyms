"""Stage 1 — seed gyms from Google Places (New) Text Search.

Usage:
  GOOGLE_PLACES_KEY=... DATABASE_URL=... python seed_places.py --cities cities/dmv.txt
  python seed_places.py --cities cities/dmv.txt --dry-run   # print, don't write

cities file: one "City, ST" per line.

For each city we run several queries ("muay thai", "kickboxing gym", "mma gym"),
dedupe on place id, and keep only places whose name / summary / types look like a
combat sports gym. Every raw Places response is stored in `sources`.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import httpx

sys.path.insert(0, str(Path(__file__).parent))
from common.db import add_source, conn, upsert_gym, upsert_place  # noqa: E402

API = "https://places.googleapis.com/v1/places:searchText"
KEY = os.environ.get("GOOGLE_PLACES_KEY", "")
FIELDS = ",".join(
    [
        "places.id", "places.displayName", "places.formattedAddress", "places.location",
        "places.rating", "places.userRatingCount", "places.websiteUri",
        "places.nationalPhoneNumber", "places.types", "places.editorialSummary",
        "places.addressComponents",
    ]
)
QUERIES = ["muay thai", "kickboxing gym", "mma gym", "boxing gym"]

STYLE_PATTERNS = {
    "muay_thai": r"muay\s*thai|nak\s*muay|thai\s*box",
    "kickboxing": r"kick\s*box",
    "mma": r"\bmma\b|mixed martial",
    "boxing": r"\bboxing\b",
    "bjj": r"\bbjj\b|jiu.?jitsu|gracie",
    "wrestling": r"wrestling",
}
NOISE = r"karate|taekwondo|tae kwon do|krav|self.?defen[cs]e only|fitness kickboxing|9round|ilovekickboxing|cardio|rehab|physical therap|physiotherap"


def detect_styles(text: str) -> list[str]:
    t = text.lower()
    return [s for s, pat in STYLE_PATTERNS.items() if re.search(pat, t)]


def locality(p: dict, fallback_city: str, fallback_state: str) -> tuple[str, str] | None:
    """Real city/state from Google's address components. Text search for "X in Arlington"
    happily returns gyms in Falls Church, Alexandria and DC; we must not file them under Arlington."""
    city = state = country = None
    for c in p.get("addressComponents", []):
        t = c.get("types", [])
        if "locality" in t and not city:
            city = c.get("longText")
        elif "administrative_area_level_1" in t:
            state = c.get("shortText")
        elif "country" in t:
            country = c.get("shortText")
    # "alexandria, va" also matches alexandria, egypt. only US 2-letter states fit places.state char(2).
    if (country and country != "US") or (state and not re.fullmatch(r"[A-Z]{2}", state)):
        return None
    return city or fallback_city, state or fallback_state


def clean_url(u: str | None) -> str | None:
    """Drop utm_* and other tracking params Google attaches to websiteUri."""
    if not u:
        return None
    parts = urlsplit(u)
    keep = "&".join(kv for kv in parts.query.split("&") if kv and not kv.lower().startswith(("utm_", "gclid", "fbclid")))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, keep, ""))


RADIUS_M = 30_000  # text search otherwise drifts to virginia beach / florida for sparse queries


def city_center(city: str, state: str) -> tuple[float, float]:
    r = httpx.post(
        API,
        headers={"X-Goog-Api-Key": KEY, "X-Goog-FieldMask": "places.location,places.formattedAddress"},
        json={"textQuery": f"{city}, {state}", "includedType": "locality", "regionCode": "US", "pageSize": 1},
        timeout=30,
    )
    r.raise_for_status()
    loc = r.json()["places"][0]["location"]
    return loc["latitude"], loc["longitude"]


def search(query: str, city: str, state: str, center: tuple[float, float]) -> list[dict]:
    out: list[dict] = []
    token = None
    for _ in range(3):  # up to 60 results per query/city
        body = {
            "textQuery": f"{query} in {city}, {state}",
            "pageSize": 20,
            "regionCode": "US",
            "locationRestriction": {"circle": {"center": {"latitude": center[0], "longitude": center[1]}, "radius": RADIUS_M}},
        }
        if token:
            body["pageToken"] = token
        r = httpx.post(
            API,
            headers={"X-Goog-Api-Key": KEY, "X-Goog-FieldMask": FIELDS + ",nextPageToken"},
            json=body,
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()
        out.extend(data.get("places", []))
        token = data.get("nextPageToken")
        if not token:
            break
        time.sleep(1.5)
    return out


def to_gym(p: dict, city: str, state: str) -> dict | None:
    name = p["displayName"]["text"]
    blob = " ".join([name, p.get("editorialSummary", {}).get("text", ""), " ".join(p.get("types", []))])
    styles = detect_styles(blob)
    if not styles or re.search(NOISE, blob.lower()) and "muay_thai" not in styles:
        return None
    loc = p.get("location", {})
    where = locality(p, city, state)
    if not where:
        print(f"  skip non-US: {name} ({p.get('formattedAddress')})", file=sys.stderr)
        return None
    city, state = where
    return {
        "name": name,
        "city": city,
        "state": state,
        "styles": styles,
        "address": p.get("formattedAddress"),
        "lat": loc.get("latitude"),
        "lng": loc.get("longitude"),
        "website": clean_url(p.get("websiteUri")),
        "phone": p.get("nationalPhoneNumber"),
        "google_place_id": p["id"],
        "google_rating": p.get("rating"),
        "google_reviews": p.get("userRatingCount"),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cities", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not KEY and not args.dry_run:
        sys.exit("GOOGLE_PLACES_KEY not set")

    cities = [l.strip() for l in Path(args.cities).read_text().splitlines() if l.strip() and not l.startswith("#")]
    total = 0
    for line in cities:
        city, state = [x.strip() for x in line.split(",")]
        center = city_center(city, state)
        seen: dict[str, dict] = {}
        for q in QUERIES:
            for p in search(q, city, state, center):
                seen.setdefault(p["id"], p)
        gyms = [g for g in (to_gym(p, city, state) for p in seen.values()) if g]
        print(f"{city}, {state}: {len(seen)} places -> {len(gyms)} gyms", file=sys.stderr)
        total += len(gyms)
        if args.dry_run:
            for g in gyms:
                print(json.dumps(g))
            continue
        with conn() as c, c.cursor() as cur:
            place_ids: dict[tuple[str, str], str] = {(state, city): upsert_place(cur, state, city, *center)}
            for g in gyms:
                key = (g["state"], g["city"])
                if key not in place_ids:
                    place_ids[key] = upsert_place(cur, *key)
                raw = seen[g["google_place_id"]]
                add_source(cur, "google_places", None, raw)
                g["place_id"] = place_ids[key]
                upsert_gym(cur, g)
            c.commit()
    print(f"done: {total} gyms", file=sys.stderr)


if __name__ == "__main__":
    main()

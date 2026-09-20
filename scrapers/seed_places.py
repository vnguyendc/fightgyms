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
NOISE = r"karate|taekwondo|tae kwon do|krav|self.?defen[cs]e only|fitness kickboxing|9round|ilovekickboxing|cardio"


def detect_styles(text: str) -> list[str]:
    t = text.lower()
    return [s for s, pat in STYLE_PATTERNS.items() if re.search(pat, t)]


def search(query: str, city: str, state: str) -> list[dict]:
    out: list[dict] = []
    token = None
    for _ in range(3):  # up to 60 results per query/city
        body = {"textQuery": f"{query} in {city}, {state}", "pageSize": 20}
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
    return {
        "name": name,
        "city": city,
        "state": state,
        "styles": styles,
        "address": p.get("formattedAddress"),
        "lat": loc.get("latitude"),
        "lng": loc.get("longitude"),
        "website": p.get("websiteUri"),
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
        seen: dict[str, dict] = {}
        for q in QUERIES:
            for p in search(q, city, state):
                seen.setdefault(p["id"], p)
        gyms = [g for g in (to_gym(p, city, state) for p in seen.values()) if g]
        print(f"{city}, {state}: {len(seen)} places -> {len(gyms)} gyms", file=sys.stderr)
        if args.dry_run:
            for g in gyms:
                print(json.dumps(g))
            continue
        with conn() as c, c.cursor() as cur:
            place_id = upsert_place(cur, state, city)
            for g in gyms:
                raw = seen[g["google_place_id"]]
                add_source(cur, "google_places", None, raw)
                g["place_id"] = place_id
                upsert_gym(cur, g)
            c.commit()
        total += len(gyms)
    print(f"done: {total} gyms", file=sys.stderr)


if __name__ == "__main__":
    main()

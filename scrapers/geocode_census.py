"""Fill missing gym coordinates from the US Census Bureau geocoder (public domain, no key).

Usage:
  DATABASE_URL=... python geocode_census.py --dry-run      # print matches, write nothing
  DATABASE_URL=... python geocode_census.py --limit 300

Only gyms with lat null are touched, so google-seeded coordinates are never overwritten. Each match is
kept in `sources` (kind census_geocoder, raw = gym id, query, matched address). A place without
coordinates gets the mean of its geocoded gyms, which is all distance-to-city needs.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).parent))
from common.db import add_source, conn  # noqa: E402

API = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
BOX = (18.0, 72.0, -180.0, -60.0)  # lat, lat, lng, lng around the us; catches 0,0 and swapped axes


def query(address: str, city: str, state: str) -> str:
    """Addresses that already name the city go as printed; street-only ones get city and state."""
    return address if city.lower() in address.lower() else f"{address}, {city}, {state}"


def parse_match(data: dict, state: str) -> tuple[float, float, str] | None:
    """First match whose matched address is in the gym's state ("213 W 35TH ST, NEW YORK, NY, 10001")."""
    for m in (data.get("result") or {}).get("addressMatches") or []:
        matched = m.get("matchedAddress") or ""
        lat, lng = (m.get("coordinates") or {}).get("y"), (m.get("coordinates") or {}).get("x")
        parts = [p.strip() for p in matched.split(",")]
        if (len(parts) >= 3 and parts[-2] == state and isinstance(lat, (int, float)) and isinstance(lng, (int, float))
                and BOX[0] <= lat <= BOX[1] and BOX[2] <= lng <= BOX[3]):
            return lat, lng, matched
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=300)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    found = 0
    with conn() as c, c.cursor() as cur, httpx.Client(timeout=30) as http:
        cur.execute(
            """
            select g.id, g.slug, g.address, p.city, p.state from gyms g join places p on p.id = g.place_id
            where g.is_active and not g.is_sample and g.lat is null and g.address is not null
            order by g.created_at limit %s
            """,
            (args.limit,),
        )
        gyms = cur.fetchall()
        for g in gyms:
            q = query(g["address"], g["city"], g["state"])
            try:
                r = http.get(API, params={"address": q, "benchmark": "Public_AR_Current", "format": "json"})
                r.raise_for_status()
                hit = parse_match(r.json(), g["state"])
            except (httpx.HTTPError, ValueError) as e:
                print(f"  {g['slug']}: failed {type(e).__name__}", file=sys.stderr)
                continue
            finally:
                time.sleep(0.5)
            if not hit:
                print(f"  {g['slug']}: no match for {q!r}", file=sys.stderr)
                continue
            found += 1
            lat, lng, matched = hit
            print(f"  {g['slug']}: {lat:.5f},{lng:.5f} {matched}", file=sys.stderr)
            if args.dry_run:
                continue
            add_source(cur, "census_geocoder", str(r.url),
                       {"gym_id": str(g["id"]), "query": q, "matched": matched, "lat": lat, "lng": lng})
            cur.execute("update gyms set lat = %s, lng = %s where id = %s and lat is null", (lat, lng, g["id"]))
            c.commit()
        if not args.dry_run:
            # only census-located gyms feed a place centroid; google-seeded places keep what they have
            cur.execute(
                """
                update places p set lat = s.lat, lng = s.lng
                from (select place_id, avg(lat) lat, avg(lng) lng from gyms
                      where lat is not null and is_active and not is_sample and google_place_id is null
                      group by place_id) s
                where s.place_id = p.id and p.lat is null
                returning p.slug
                """
            )
            print(f"places located: {len(cur.fetchall())}", file=sys.stderr)
            c.commit()
    print(f"done: {found}/{len(gyms)} gyms matched", file=sys.stderr)


if __name__ == "__main__":
    main()

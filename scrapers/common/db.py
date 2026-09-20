"""Thin Supabase/Postgres helpers shared by all scrapers.

Uses a direct Postgres connection (DATABASE_URL) rather than the REST client so
upserts and provenance inserts can run in one transaction.
"""
from __future__ import annotations

import json
import os
import re
import unicodedata
from contextlib import contextmanager
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")


@contextmanager
def conn() -> Iterator[psycopg.Connection]:
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as c:
        yield c


def slugify(*parts: str) -> str:
    s = "-".join(p for p in parts if p)
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s


def add_source(cur, kind: str, url: str | None, raw: Any) -> str:
    cur.execute(
        "insert into sources (kind, url, raw) values (%s, %s, %s) returning id",
        (kind, url, json.dumps(raw, default=str)),
    )
    return cur.fetchone()["id"]


def upsert_place(cur, state: str, city: str, lat: float | None = None, lng: float | None = None) -> str:
    slug = slugify(city, state)
    cur.execute(
        """
        insert into places (state, city, slug, lat, lng)
        values (%s, %s, %s, %s, %s)
        on conflict (state, city) do update
          set lat = coalesce(places.lat, excluded.lat),
              lng = coalesce(places.lng, excluded.lng)
        returning id
        """,
        (state.upper(), city, slug, lat, lng),
    )
    return cur.fetchone()["id"]


def upsert_gym(cur, g: dict[str, Any]) -> str:
    """Idempotent on google_place_id; falls back to slug."""
    g = dict(g)
    g.setdefault("slug", slugify(g["name"], g.get("city", ""), g.get("state", "")))
    g.setdefault("styles", [])
    g.setdefault("tags", [])
    cols = [
        "slug", "name", "styles", "place_id", "address", "lat", "lng", "website", "instagram",
        "phone", "google_place_id", "google_rating", "google_reviews", "tapology_id",
        "smoothcomp_id", "affiliation", "founded_year", "tags", "description", "is_sample",
    ]
    vals = [g.get(c) for c in cols]
    conflict_key = "google_place_id" if g.get("google_place_id") else "slug"
    # only overwrite nulls; never clobber hand-verified data
    updates = ", ".join(
        f"{c} = coalesce(gyms.{c}, excluded.{c})" for c in cols if c not in ("slug", "google_place_id")
    )
    # styles/tags: union
    updates += (
        ", styles = (select array_agg(distinct s) from unnest(gyms.styles || excluded.styles) s)"
        ", tags = (select array_agg(distinct t) from unnest(gyms.tags || excluded.tags) t)"
    )
    cur.execute(
        f"""
        insert into gyms ({", ".join(cols)})
        values ({", ".join(["%s"] * len(cols))})
        on conflict ({conflict_key}) do update set {updates}
        returning id
        """,
        vals,
    )
    return cur.fetchone()["id"]


def insert_price(cur, gym_id: str, p: dict[str, Any], source_id: str | None, verified_by: str) -> None:
    cur.execute(
        """
        insert into gym_prices (gym_id, kind, amount_cents, contract_months, free_trial, notes, source_id, verified_at, verified_by)
        values (%s, %s, %s, %s, %s, %s, %s, current_date, %s)
        """,
        (gym_id, p["kind"], p.get("amount_cents"), p.get("contract_months"), p.get("free_trial"), p.get("notes"), source_id, verified_by),
    )


def replace_classes(cur, gym_id: str, classes: list[dict[str, Any]], source_id: str | None) -> None:
    """Schedules are replaced wholesale per source; partial schedules are worse than none."""
    if not classes:
        return
    cur.execute("delete from classes where gym_id = %s", (gym_id,))
    for c in classes:
        cur.execute(
            """
            insert into classes (gym_id, dow, start_time, end_time, name, level, style, source_id, verified_at)
            values (%s, %s, %s, %s, %s, %s, %s, %s, current_date)
            """,
            (gym_id, c["dow"], c["start"], c.get("end"), c.get("name"), c.get("level"), c.get("style"), source_id),
        )

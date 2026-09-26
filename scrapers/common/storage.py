"""Supabase Storage upload over REST. Scrapers use the service role key, which
bypasses RLS; the bucket itself is public-read."""
from __future__ import annotations

import os

import httpx

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
BUCKET = "gym-photos"


def configured() -> bool:
    return bool(SUPABASE_URL and SERVICE_KEY)


def upload(path: str, data: bytes, content_type: str = "image/webp") -> None:
    """Upsert an object at <bucket>/<path>. Raises on HTTP error."""
    r = httpx.post(
        f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{path}",
        headers={
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": content_type,
            "x-upsert": "true",
        },
        content=data,
        timeout=60,
    )
    r.raise_for_status()


def public_url(path: str) -> str:
    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{path}"

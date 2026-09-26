"""Supabase Storage upload over REST. Scrapers use the service role key, which
bypasses RLS; the bucket itself is public-read."""
from __future__ import annotations

import os
import time

import httpx

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
BUCKET = "gym-photos"


def configured() -> bool:
    return bool(SUPABASE_URL and SERVICE_KEY)


def upload(path: str, data: bytes, content_type: str = "image/webp", attempts: int = 4) -> None:
    """Upsert an object at <bucket>/<path>. Retries transient network errors and 5xx with backoff."""
    for i in range(attempts):
        try:
            r = httpx.post(
                f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{path}",
                headers={
                    "Authorization": f"Bearer {SERVICE_KEY}",
                    "Content-Type": content_type,
                    "x-upsert": "true",
                },
                content=data,
                timeout=httpx.Timeout(60, connect=20),
            )
            if r.status_code < 500:
                r.raise_for_status()
                return
            err: Exception = httpx.HTTPStatusError(f"{r.status_code} {r.text[:200]}", request=r.request, response=r)
        except httpx.TransportError as e:  # connect/read timeouts, resets
            err = e
        if i == attempts - 1:
            raise err
        time.sleep(2 ** i)


def public_url(path: str) -> str:
    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{path}"

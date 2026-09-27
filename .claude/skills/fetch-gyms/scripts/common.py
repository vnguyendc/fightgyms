"""Paths shared by the fetch-gyms scripts.

The skill lives at <repo>/.claude/skills/fetch-gyms/scripts. In a git worktree the ignored
scrapers/.env and scrapers/.venv exist only in the main checkout, so MAIN is found through git.
A run keeps its private evidence (captures, leads, queue) under ~/.local/share/fightgyms/runs/<name>,
never in git and never in a temporary scratchpad: the queue and captures are the audit trail.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
_git_common = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--git-common-dir"],
                             capture_output=True, text=True, check=True).stdout.strip()
MAIN = (Path(_git_common) if Path(_git_common).is_absolute() else REPO / _git_common).resolve().parent
PY = str(MAIN / "scrapers/.venv/bin/python")
RUNS = Path.home() / ".local/share/fightgyms/runs"
SITE = "https://findfightgyms.com"

sys.path.insert(0, str(REPO))
from scrapers import public_candidates as pc  # noqa: E402


def run_dir(name: str) -> Path:
    """A run name ("northeast-2026-09") or an absolute path; created private (0700)."""
    path = Path(name).expanduser() if "/" in name else RUNS / name
    for p in reversed([path, *path.parents][:3]):
        if not p.exists():
            p.mkdir(mode=0o700)
    return path


def config(run: Path) -> dict:
    f = run / "run.json"
    return json.loads(f.read_text()) if f.exists() else {}


def main_env(database: bool) -> dict:
    """os.environ plus the main checkout's scrapers/.env; DATABASE_URL only when a step must reach postgres."""
    env = {k: v for k, v in os.environ.items() if k != "DATABASE_URL"}
    for line in (MAIN / "scrapers/.env").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            if database or k.strip() != "DATABASE_URL":
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def read_only(sql: str, params=()) -> list[dict]:
    """One read-only query against the live database (the session refuses writes)."""
    import psycopg
    from psycopg.rows import dict_row
    with psycopg.connect(main_env(True)["DATABASE_URL"], row_factory=dict_row, connect_timeout=10,
                         options="-c default_transaction_read_only=on -c statement_timeout=30000") as c:
        with c.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall() if cur.description else []
        c.rollback()
    return rows


def listed_cities() -> set[tuple[str, str]]:
    return {tuple(ln.split(", ")) for f in pc.CITIES.glob("*.txt") for ln in f.read_text().splitlines()
            if ln and not ln.startswith("#")}

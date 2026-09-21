"""Run a SQL file or statement against DATABASE_URL (no psql needed).

  python run_sql.py ../supabase/migrations/0001_init.sql
  python run_sql.py -c "select refresh_gym_fighter_stats()"
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common.db import conn  # noqa: E402


def main() -> None:
    if len(sys.argv) == 3 and sys.argv[1] == "-c":
        sql = sys.argv[2]
    elif len(sys.argv) == 2:
        sql = Path(sys.argv[1]).read_text()
    else:
        sys.exit(__doc__)
    with conn() as c, c.cursor() as cur:
        cur.execute(sql)
        if cur.description:
            for row in cur.fetchall():
                print(row)
        c.commit()


if __name__ == "__main__":
    main()

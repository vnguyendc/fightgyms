"""Check a run's imported gyms on the live site (read-only).

  verify_live.py --run R [--sample 6]

Prints database counts for the run's gyms (coordinates, photos, prices), then fetches a sample of gym
pages and their city pages from findfightgyms.com: status, title, address present, robots meta.
New gym and city routes render on demand; the home page and listings refresh within an hour (ISR).
"""
import argparse
import random
import re
import sqlite3

import httpx

from common import SITE, read_only, run_dir


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", required=True)
    ap.add_argument("--sample", type=int, default=6)
    args = ap.parse_args()
    run = run_dir(args.run)
    db = sqlite3.connect((run / "queue.sqlite3").as_uri() + "?mode=ro", uri=True)
    status = dict(db.execute("select status, count(*) from candidates group by status").fetchall())
    ids = [r[0] for r in db.execute("select gym_id from candidates where status = 'applied' and gym_id is not null")]
    db.close()
    rows = read_only(
        """select g.slug, g.address, g.lat is not null located, p.state, p.slug place,
                  exists (select 1 from gym_photos ph where ph.gym_id = g.id and ph.is_active) photo,
                  exists (select 1 from gym_current_prices pr where pr.gym_id = g.id) priced
           from gyms g join places p on p.id = g.place_id where g.id = any(%s::uuid[])""", (ids,))
    print({"queue": status, "gyms": len(rows), "located": sum(r["located"] for r in rows),
           "with_photos": sum(r["photo"] for r in rows), "with_prices": sum(r["priced"] for r in rows)})
    for r in random.sample(rows, min(args.sample, len(rows))):
        street = re.match(r"[^,]+", r["address"] or "").group(0)
        for path in (f"/gym/{r['slug']}", f"/gyms/{r['state'].lower()}/{r['place'][:-3]}"):
            page = httpx.get(SITE + path, follow_redirects=True, timeout=30)
            title = re.search(r"<title>([^<]*)</title>", page.text)
            robots = re.search(r'<meta name="robots" content="([^"]*)"', page.text)
            print(page.status_code, path, "|", title.group(1) if title else None, "| address shown:",
                  street in page.text, "| robots:", robots.group(1) if robots else None)


if __name__ == "__main__":
    main()

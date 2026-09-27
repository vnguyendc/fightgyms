"""Finish the gyms a run imported (production; run only after the import was approved).

  enrich.py --run R slugs              imported slugs (queue rows marked applied -> gyms.slug, read-only)
  enrich.py --run R geocode [--dry-run]  scrapers/geocode_census.py: lat/lng where null, place centroids
  enrich.py --run R extract [--workers 4]  scrapers/extract_site.py --gym-slug per imported gym (Haiku calls)
  enrich.py --run R photos [--workers 4]   scrapers/fetch_photos.py --gym-slug per imported gym without photos or a recent attempt

extract_site's default selection skips a gym whose website has a recent `website` source row, which the
importer's provenance row is, so imported gyms must go through --gym-slug. Logs land in final/.
"""
import argparse
import concurrent.futures
import sqlite3
import subprocess

from common import PY, REPO, main_env, read_only, run_dir


def slugs(run):
    db = sqlite3.connect((run / "queue.sqlite3").as_uri() + "?mode=ro", uri=True)
    ids = [r[0] for r in db.execute("select gym_id from candidates where status = 'applied' and gym_id is not null")]
    db.close()
    rows = read_only("select slug from gyms where id = any(%s::uuid[]) and google_place_id is null order by slug", (ids,))
    return [r["slug"] for r in rows]


def script(name, *args, timeout=None):
    return subprocess.run([PY, str(REPO / "scrapers" / name), *args], cwd=REPO / "scrapers", env=main_env(True),
                          capture_output=True, text=True, timeout=timeout)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", required=True)
    ap.add_argument("cmd", choices=("slugs", "geocode", "extract", "photos"))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int, default=250)
    args = ap.parse_args()
    run = run_dir(args.run)
    if args.cmd == "slugs":
        print("\n".join(slugs(run)))
    elif args.cmd == "geocode":
        out = script("geocode_census.py", "--limit", str(args.limit), *(["--dry-run"] if args.dry_run else []))
        (run / "final/geocode_log.txt").open("a").write(out.stderr)
        print(out.stderr[-3000:])
    elif args.cmd == "extract":
        todo = slugs(run)

        def one(slug):
            out = script("extract_site.py", "--gym-slug", slug, timeout=600)
            return slug, out.returncode, (out.stderr.strip().splitlines() or [""])[-1]

        with (run / "final/extract_log.txt").open("a") as log, \
                concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            for slug, code, last in pool.map(one, todo):
                log.write(f"{slug}\t{code}\t{last}\n")
                log.flush()
                print(slug, code, last, flush=True)
    else:
        # per gym, several at a time; fetch_photos alone walks gyms one by one (a vision call per image)
        ids = read_only("""select g.slug from gyms g where g.slug = any(%s) and g.website is not null
            and not exists (select 1 from gym_photos p where p.gym_id = g.id and p.is_active)
            and not exists (select 1 from sources s where s.kind = 'website' and s.url = g.website
                            and s.raw ? 'candidates' and s.fetched_at > now() - interval '30 days')""", (slugs(run),))

        def one(slug):
            out = script("fetch_photos.py", "--gym-slug", slug, timeout=900)
            return slug, out.returncode, (out.stderr.strip().splitlines() or [""])[-1]

        with (run / "final/photos_log.txt").open("a") as log, \
                concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            for slug, code, last in pool.map(one, [r["slug"] for r in ids][:args.limit]):
                log.write(f"{slug}\t{code}\t{last}\n")
                log.flush()
                print(slug, code, last, flush=True)


if __name__ == "__main__":
    main()

"""Finish the gyms a run imported (production; run only after the import was approved).

  enrich.py --run R slugs                  imported slugs (queue rows marked applied -> gyms.slug, read-only)
  enrich.py --run R geocode [--dry-run]    scrapers/geocode_census.py: lat/lng where null, place centroids
  enrich.py --run R extract [--workers 4]  scrapers/extract_site.py --gym-slug per imported gym (Haiku calls)
  enrich.py --run R photos [--workers 4]   scrapers/fetch_photos.py --gym-slug per imported gym without photos
                                           or a recent attempt
  enrich.py --run R phones [--dry-run]     the phone printed on the gym's own captured pages -> gyms.phone
                                           where null, one provenance row each; ambiguous pages are skipped
  enrich.py --run R socials [--workers 4] [--scrapers DIR]
                                           fetch_photos.py --socials-only --gym-slug per imported gym
                                           (needs the socials code; DIR points at a checkout that has it)

extract_site's default selection skips a gym whose website has a recent `website` source row, which the
importer's provenance row is, so imported gyms must go through --gym-slug. Logs land in final/.
"""
import argparse
import concurrent.futures
import hashlib
import json
import re
import sqlite3
import subprocess
from pathlib import Path

from common import PY, REPO, main_env, read_only, run_dir

PHONE = re.compile(r"(?<![\d-])(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-]?(\d{4})(?![\d-])")
TOLL_FREE = {"800", "833", "844", "855", "866", "877", "888"}


def applied(run):
    """(gym_id, candidate record) for every queue row the importer applied."""
    db = sqlite3.connect((run / "queue.sqlite3").as_uri() + "?mode=ro", uri=True)
    rows = [(gid, json.loads(payload)["record"]) for gid, payload in
            db.execute("select gym_id, payload from candidates where status = 'applied' and gym_id is not null")]
    db.close()
    return rows


def slugs(run):
    rows = read_only("select slug from gyms where id = any(%s::uuid[]) and google_place_id is null order by slug",
                     ([gid for gid, _ in applied(run)],))
    return [r["slug"] for r in rows]


def script(scrapers, name, *args, timeout=None):
    return subprocess.run([PY, str(scrapers / name), *args], cwd=scrapers, env=main_env(True),
                          capture_output=True, text=True, timeout=timeout)


def pick_phone(record):
    """(national format, printed text, page) from the gym's own pages, or None when unsure.

    A site that prints exactly one number anywhere gets it. With several (multi-location footers, sister gyms,
    stale pages) every number within reach of this gym's street address on any of its pages counts, 120
    characters after or 80 before, and only a single distinct one is picked. Sites differ in whether the phone
    precedes or follows the address, so anything more clever writes a neighbour's number. Toll-free, fax and
    placeholder numbers (…1234, …0000, 555) never count."""
    hits = []
    for p in record["pages"]:
        for m in PHONE.finditer(p["text"]):
            digits = "".join(m.groups())
            if (m.group(1) in TOLL_FREE or m.group(2) == "555" or digits[-4:] in ("1234", "0000")
                    or "fax" in p["text"][max(0, m.start() - 12):m.start()].lower()):
                continue
            hits.append((digits, m.group(0).strip(), p, m.start(), m.end()))
    if not hits:
        return None
    if len({h[0] for h in hits}) == 1:
        chosen = hits[0]
    else:
        street = re.match(r"\S+\s+\S+", record["address"])
        near = {}
        for p in record["pages"]:
            for s in re.finditer(re.escape(street.group(0)), p["text"], re.I) if street else ():
                for h in hits:
                    if h[2] is p and (0 <= h[3] - s.end() <= 120 or 0 <= s.start() - h[4] <= 80):
                        near.setdefault(h[0], h)
        chosen = next(iter(near.values())) if len(near) == 1 else None
    if not chosen:
        return None
    digits, printed, page = chosen[:3]
    return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}", printed, page


def phones(run, dry):
    decided = [(gid, rec, pick_phone(rec)) for gid, rec in applied(run)]
    missing = {r["id"] for r in read_only("select id::text from gyms where id = any(%s::uuid[]) and phone is null",
                                          ([gid for gid, _, _ in decided],))}
    with (run / "final/phones.tsv").open("w") as fh:
        fh.write("gym_id\tname\tphone\tprinted\tpage\n")
        for gid, rec, pick in decided:
            fh.write("\t".join([gid, rec["name"], *(pick[:2] if pick else ("", "")), pick[2]["url"] if pick else ""]) + "\n")
    todo = [(gid, rec, pick) for gid, rec, pick in decided if pick and gid in missing]
    print({"gyms": len(decided), "picked": sum(1 for *_, p in decided if p), "to_write": len(todo),
           "already_had_phone": len(decided) - len(missing)})
    if dry:
        return
    import psycopg
    with psycopg.connect(main_env(True)["DATABASE_URL"], connect_timeout=10) as c, c.cursor() as cur:
        written = 0
        for gid, rec, (phone, printed, page) in todo:
            raw = {"pipeline": "fetch-gyms-phones", "gym_id": gid, "field": "phone", "value": phone,
                   "printed": printed, "page_url": page["url"],
                   "page_text_sha256": hashlib.sha256(page["text"].encode()).hexdigest()}
            cur.execute("insert into sources (kind, url, fetched_at, raw) values ('website', %s, %s, %s)",
                        (page["url"], page["fetched_at"], json.dumps(raw)))
            cur.execute("update gyms set phone = %s where id = %s and phone is null", (phone, gid))
            written += cur.rowcount
            c.commit()
    print({"phones_written": written})


def pool(run, log_name, jobs, workers):
    with (run / "final" / log_name).open("a") as log, concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        for slug, code, last in ex.map(lambda j: j(), jobs):
            log.write(f"{slug}\t{code}\t{last}\n")
            log.flush()
            print(slug, code, last, flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", required=True)
    ap.add_argument("cmd", choices=("slugs", "geocode", "extract", "photos", "phones", "socials"))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int, default=250)
    ap.add_argument("--scrapers", type=Path, default=REPO / "scrapers", help="scrapers/ of the checkout to run")
    args = ap.parse_args()
    run, scrapers = run_dir(args.run), args.scrapers.resolve()

    def job(name, slug, *extra):
        def go():
            out = script(scrapers, name, *extra, "--gym-slug", slug, timeout=900)
            return slug, out.returncode, (out.stderr.strip().splitlines() or [""])[-1]
        return go

    if args.cmd == "slugs":
        print("\n".join(slugs(run)))
    elif args.cmd == "geocode":
        out = script(scrapers, "geocode_census.py", "--limit", str(args.limit), *(["--dry-run"] if args.dry_run else []))
        (run / "final/geocode_log.txt").open("a").write(out.stderr)
        print(out.stderr[-3000:])
    elif args.cmd == "extract":
        pool(run, "extract_log.txt", [job("extract_site.py", s) for s in slugs(run)], args.workers)
    elif args.cmd == "photos":
        # per gym, several at a time; fetch_photos alone walks gyms one by one (a vision call per image)
        todo = read_only("""select g.slug from gyms g where g.slug = any(%s) and g.website is not null
            and not exists (select 1 from gym_photos p where p.gym_id = g.id and p.is_active)
            and not exists (select 1 from sources s where s.kind = 'website' and s.url = g.website
                            and s.raw ? 'candidates' and s.fetched_at > now() - interval '30 days')""", (slugs(run),))
        pool(run, "photos_log.txt", [job("fetch_photos.py", r["slug"]) for r in todo][:args.limit], args.workers)
    elif args.cmd == "phones":
        phones(run, args.dry_run)
    else:
        if "--socials-only" not in (scrapers / "fetch_photos.py").read_text():
            raise SystemExit(f"{scrapers}/fetch_photos.py has no --socials-only; pass --scrapers <checkout with it>/scrapers")
        pool(run, "socials_log.txt", [job("fetch_photos.py", s, "--socials-only") for s in slugs(run)][:args.limit],
             args.workers)


if __name__ == "__main__":
    main()

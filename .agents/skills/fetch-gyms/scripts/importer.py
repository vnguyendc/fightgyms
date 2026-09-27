"""Drive scrapers.public_candidates for a reviewed run. The queue is <run>/queue.sqlite3 (private, 0600).

  importer.py --run R ingest           final/candidates.jsonl -> queue, 50 lines per ingest call (the CLI cap)
  importer.py --run R dry              offline dry-run: validation only, no database
  importer.py --run R apply-first 3    ONE production apply with --max-new N (N <= 5), then verify before more
  importer.py --run R apply-all        production applies of 5 new gyms each until nothing is pending
  importer.py --run R status

Production applies write the live places/gyms/sources tables. Run them only after the user has explicitly
approved the production import in chat. Every run's JSON report is appended to final/import_log.jsonl.
"""
import argparse
import json
import subprocess
import sys

from common import PY, REPO, main_env, run_dir


def pc(run, database, *args):
    out = subprocess.run([PY, "-m", "scrapers.public_candidates", *map(str, args)], cwd=REPO,
                         env=main_env(database), capture_output=True, text=True)
    lines = out.stdout.strip().splitlines()
    report = json.loads(lines[-1]) if lines else {"status": "blocked", "stderr": out.stderr[-500:]}
    with (run / "final/import_log.jsonl").open("a") as fh:
        fh.write(json.dumps({"args": list(map(str, args)), "exit": out.returncode, "report": report}) + "\n")
    return out.returncode, report


def brief(report):
    return {k: report.get(k) for k in ("status", "accepted", "inserted", "duplicate", "rejected", "deferred",
                                       "reasons", "database_outcome", "queue") if k in report}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", required=True)
    ap.add_argument("cmd", choices=("ingest", "dry", "apply-first", "apply-all", "status"))
    ap.add_argument("n", nargs="?", type=int, default=3)
    args = ap.parse_args()
    run = run_dir(args.run)
    queue = run / "queue.sqlite3"
    if args.cmd == "ingest":
        rows = (run / "final/candidates.jsonl").read_text().splitlines()
        for i in range(0, len(rows), 50):
            chunk = run / f"final/chunk_{i // 50:02d}.jsonl"
            chunk.write_text("\n".join(rows[i:i + 50]) + "\n")
            code, r = pc(run, False, "ingest", "--input", chunk, "--queue", queue, "--limit", 50)
            print(code, brief(r), flush=True)
    elif args.cmd == "dry":
        print(*pc(run, False, "run", "--queue", queue, "--limit", 50))
    elif args.cmd == "apply-first":
        code, r = pc(run, True, "run", "--queue", queue, "--apply", "--max-new", min(args.n, 5), "--limit", 50)
        print(code, brief(r))
    elif args.cmd == "apply-all":
        while True:
            code, r = pc(run, True, "run", "--queue", queue, "--apply", "--max-new", 5, "--limit", 50)
            print(code, brief(r), flush=True)
            if r.get("status") == "blocked" or not r.get("queue", {}).get("pending") or \
                    not (r.get("inserted") or r.get("duplicate") or r.get("rejected")):
                break
    else:
        print(*pc(run, False, "status", "--queue", queue))
    sys.exit(0)


if __name__ == "__main__":
    main()

"""Append reviewed final/new_cities.txt to the repo's region lists (scrapers/cities/*.txt).

  merge_cities.py --run R

Review final/new_cities.txt first: every line must be a real postal city exactly as a gym's own address
prints it. Existing lines are never reordered; new ones go in a section marked with the run name.
The file each state joins comes from run.json "city_files". A missing file is created with a header.
"""
import argparse
from pathlib import Path

from common import REPO, config, run_dir


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", required=True)
    run = run_dir(ap.parse_args().run)
    files = config(run).get("city_files", {})
    new = [tuple(ln.split(", ")) for ln in (run / "final/new_cities.txt").read_text().splitlines() if ln]
    by_file: dict[str, list[str]] = {}
    for city, state in new:
        if state not in files:
            raise SystemExit(f"run.json city_files has no file for {state} ({city}); add it and rerun")
        by_file.setdefault(files[state], []).append(f"{city}, {state}")
    for name, lines in by_file.items():
        path = REPO / "scrapers/cities" / name
        text = path.read_text().splitlines() if path.exists() else [
            "# City, ST — one per line, by the postal city gyms print"]
        existing = {ln for ln in text if ln and not ln.startswith("#")}
        add = sorted(set(lines) - existing)
        if not add:
            continue
        marker = f"# added by {run.name}"
        if marker not in text and existing:
            text.append(marker)
        path.write_text("\n".join(text + add) + "\n")
        print(f"{name}: {len(add)} added")


if __name__ == "__main__":
    main()

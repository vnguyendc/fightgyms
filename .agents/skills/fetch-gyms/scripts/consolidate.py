"""Latest decision per site from leads/*.jsonl -> re-proposed under the current rules -> final/.

  consolidate.py --run R

Writes final/candidates.jsonl (importer input), final/review.tsv (read it before importing),
final/dropped.tsv (skips, failures, holds) and final/new_cities.txt (cities to review and merge).
Holds come from <run>/holds.json: {"hosts": {"host.com": "reason"}, "urls": {"https://...": "reason"}}.
"""
import argparse
import collections
import json
from pathlib import Path
from urllib.parse import urlsplit

import kit
from common import listed_cities, run_dir


def site(url):
    p = urlsplit(url or "")
    return (p.hostname or "").removeprefix("www.") + p.path.rstrip("/")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", required=True)
    run = run_dir(ap.parse_args().run)
    kit.setup(run)
    holds = json.loads((run / "holds.json").read_text()) if (run / "holds.json").exists() else {}
    hold_hosts, hold_urls = holds.get("hosts", {}), holds.get("urls", {})
    out = run / "final"
    out.mkdir(mode=0o700, exist_ok=True)

    latest = {}
    for f in sorted((run / "leads").glob("*.jsonl")):
        for line in f.read_text().splitlines():
            d = json.loads(line)
            d["region"] = f.stem
            if d["kind"] == "skip":
                key = site(d["url"])
            else:
                first = Path(d["captures"][0]) if d["captures"] else None
                key = site(d["result"].get("official_url") or
                           (json.loads(first.read_text())["url"] if first and first.exists() else ""))
            prev = latest.get(key)
            # another region's out_of_area skip never overrides a proposal for the same site
            if prev and d["kind"] == "skip" and d.get("reason") == "out_of_area" and prev["kind"] == "proposal":
                continue
            if prev and prev["kind"] == "skip" and prev.get("reason") == "out_of_area" and d["kind"] == "proposal":
                latest[key] = d
                continue
            if not prev or d["at"] >= prev["at"]:
                latest[key] = d

    valid, dropped, seen_ids = [], [], set()
    for key, d in sorted(latest.items()):
        if d["kind"] == "skip":
            dropped.append((d["region"], "skip:" + d["reason"], d["name"], d["url"], ""))
            continue
        o = d.get("overrides", {})
        if not all(Path(c).exists() for c in d["captures"]):
            dropped.append((d["region"], "capture_missing", o.get("name"), key, d.get("note") or ""))
            continue
        result, record = kit.propose(d["captures"], **{k: o.get(k) for k in
                                     ("name", "address", "city", "state", "styles", "name_quote", "location_quote")})
        if not record:
            why = result.get("reason") or ",".join(result.get("problems", []))
            dropped.append((d["region"], why, result.get("name") or o.get("name"), result.get("official_url") or key,
                            d.get("note") or ""))
            continue
        host = kit.host_of(record["official_url"])
        if host in hold_hosts or record["official_url"] in hold_urls:
            why = hold_hosts.get(host) or hold_urls[record["official_url"]]
            dropped.append((d["region"], "held:" + why, record["name"], record["official_url"], d.get("note") or ""))
            continue
        if result["id"] in seen_ids:
            continue
        seen_ids.add(result["id"])
        valid.append((d, result, record))

    by_host = collections.Counter(kit.host_of(r["official_url"]) for _, _, r in valid)
    for _, _, record in valid:
        u = urlsplit(record["official_url"])
        if by_host[kit.host_of(record["official_url"])] == 1 and u.path not in ("", "/"):
            # one gym per site: its website is the homepage, not the program page the evidence came from
            record["official_url"] = f"{u.scheme}://{u.netloc}/"
            kit.validate_scoped(record)

    with open(out / "candidates.jsonl", "w") as fh:
        for _, _, record in valid:
            fh.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
    with open(out / "review.tsv", "w") as fh:
        fh.write("region\tname\tcity\tstate\tstyles\taddress\tbasis\tshared_host\turl\tnote\n")
        for d, r, record in sorted(valid, key=lambda x: (x[2]["state"], x[2]["city"], x[2]["name"])):
            fh.write("\t".join([d["region"], record["name"], record["city"], record["state"], ",".join(record["styles"]),
                                record["address"], r["location_basis"], str(by_host[kit.host_of(record["official_url"])] > 1),
                                record["official_url"], (d.get("note") or "").replace("\t", " ")]) + "\n")
    with open(out / "dropped.tsv", "w") as fh:
        fh.write("region\treason\tname\turl\tnote\n")
        for row in sorted(dropped, key=lambda x: tuple(str(v or "") for v in x)):
            fh.write("\t".join(str(x or "").replace("\t", " ") for x in row) + "\n")
    new = sorted({(r["city"], r["state"]) for _, _, r in valid} - listed_cities(), key=lambda x: (x[1], x[0]))
    (out / "new_cities.txt").write_text("".join(f"{c}, {s}\n" for c, s in new))
    print(json.dumps({"sites": len(latest), "valid": len(valid), "dropped": len(dropped), "new_cities": len(new),
                      "by_state": collections.Counter(r["state"] for _, _, r in valid),
                      "shared_hosts": {h: n for h, n in by_host.items() if n > 1}}, default=str))


if __name__ == "__main__":
    main()

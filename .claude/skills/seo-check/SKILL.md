---
name: seo-check
description: Run and interpret the read-only FightGyms search and traffic monitor.
---

Run `sh ops/seo-monitor/run.sh` from this repository. Read the JSON path printed even if exit code is 1 (alerts). Read `ops/seo-monitor/README.md` for dependencies and source errors. Report collection time, date coverage, alerts, Search Console clicks/impressions and week-over-week comparison, Vercel traffic/referrers and p75 LCP only when the corresponding source succeeded. Empty metric summaries are unavailable; do not substitute zero or old data. Distinguish Search Console clicks, referral visits and training outcomes. The diagnosis of the October visibility drop remains inferred. Do not modify credentials, production data, sitemap submissions or marketing settings. The script writes an authorized weekly vault note and local bundle and shows a desktop notification.

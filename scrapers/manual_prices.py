"""Import phone-verified price CSVs. Dry run by default; --apply appends facts atomically."""
from __future__ import annotations

import argparse
import csv
import datetime as dt
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path

KINDS = {'monthly', 'drop_in', 'trial'}
FIELDS = ['gym_slug', 'kind', 'amount_dollars', 'verified_at', 'notes']

# One source per verified fact. A transaction-scoped lock serializes this importer;
# source fingerprint + append-only prices makes retries safe without schema changes.
IMPORT_SQL = """
with input as (
  select * from jsonb_to_recordset(%s::jsonb) as r(
    gym_slug text, kind text, amount_cents int, verified_at date, notes text, phone_import_id text)
), saved as (
  insert into sources(kind, raw)
  select 'manual', to_jsonb(r) from input r
  where not exists (
    select 1 from sources s where s.kind='manual' and s.raw->>'phone_import_id'=r.phone_import_id
  ) returning id, raw
)
insert into gym_prices(gym_id, kind, amount_cents, currency, free_trial, notes, verified_at, verified_by, source_id)
select g.id, s.raw->>'kind', (s.raw->>'amount_cents')::int, 'usd',
       (s.raw->>'kind'='trial' and (s.raw->>'amount_cents')::int=0),
       s.raw->>'notes', (s.raw->>'verified_at')::date, 'phone', s.id
from saved s join gyms g on g.slug=s.raw->>'gym_slug'
returning gym_id, kind
"""


def read_prices(path: Path) -> list[dict]:
    result = []
    seen = set()
    with path.open(newline='', encoding='utf-8-sig') as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != FIELDS:
            raise ValueError('CSV headers must be: ' + ','.join(FIELDS))
        for number, row in enumerate(reader, 2):
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f'row {number}: wrong column count')
            row = {key: value.strip() for key, value in row.items()}
            slug, kind = row['gym_slug'], row['kind']
            if not slug or kind not in KINDS:
                raise ValueError(f'row {number}: gym_slug and monthly/drop_in/trial kind required')
            try:
                amount = Decimal(row['amount_dollars'])
                if not amount.is_finite() or amount < 0 or amount * 100 != (amount * 100).to_integral_value() or amount * 100 > 2147483647:
                    raise ValueError()
                date = dt.date.fromisoformat(row['verified_at'])
                if date.isoformat() != row['verified_at'] or date > dt.date.today():
                    raise ValueError()
            except (InvalidOperation, ValueError):
                raise ValueError(f'row {number}: nonnegative dollar amount (max 2 decimals) and nonfuture ISO verification date required') from None
            key = (slug, kind, date.isoformat())
            if key in seen:
                raise ValueError(f'row {number}: duplicate gym/kind/verification date')
            seen.add(key)
            item = {'gym_slug': slug, 'kind': kind, 'amount_cents': int(amount * 100), 'verified_at': date.isoformat(), 'notes': row['notes'] or None}
            item['phone_import_id'] = hashlib.sha256(json.dumps(item, sort_keys=True).encode()).hexdigest()
            result.append(item)
    if not result:
        raise ValueError('CSV contains no verified prices')
    return result


def import_prices(connection, rows, apply=False):
    with connection.cursor() as cur:
        if not apply:
            cur.execute('set transaction read only')
        else:
            cur.execute("select pg_advisory_xact_lock(hashtextextended('fightgyms:phone-prices', 0))")
        slugs = sorted({r['gym_slug'] for r in rows})
        cur.execute('select slug from gyms where slug = any(%s) and is_active and not is_sample' + (' for share' if apply else ''), (slugs,))
        matched = {r['slug'] for r in cur.fetchall()}
        if matched != set(slugs):
            raise ValueError('unknown, inactive or sample gyms: ' + ', '.join(sorted(set(slugs) - matched)))
        cur.execute("select raw->>'phone_import_id' as id from sources where kind='manual' and raw->>'phone_import_id' = any(%s)", ([r['phone_import_id'] for r in rows],))
        existing = {r['id'] for r in cur.fetchall()}
        pending = [r for r in rows if r['phone_import_id'] not in existing]
        if apply:
            cur.execute(IMPORT_SQL, (json.dumps(pending),))
            inserted = len(cur.fetchall())
            if inserted != len(pending):
                raise RuntimeError('price/source count mismatch; transaction must roll back')
        return {'mode': 'apply' if apply else 'dry-run', 'matched_gyms': len(matched), 'new_prices': len(pending), 'already_imported': len(rows) - len(pending)}


def export_calls(connection, output: Path):
    with connection.cursor() as cur:
        cur.execute("set transaction read only")
        cur.execute("""select g.slug, g.name, p.city, p.state, g.phone, g.website
                       from gyms g join places p on p.id=g.place_id
                       where g.is_active and not g.is_sample and p.state in ('DC','MD','VA')
                       and g.styles && array['muay_thai','kickboxing']::text[]
                       order by p.state,p.city,g.name""")
        gyms = cur.fetchall()
    with output.open('x', newline='') as handle:
        fields = ['slug', 'name', 'city', 'state', 'phone', 'website', 'call_status', 'call_notes']
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for gym in gyms:
            writer.writerow({**gym, 'call_status': '', 'call_notes': ''})
    return len(gyms)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv', type=Path, nargs='?')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--export-calls', type=Path, help='export DMV call sheet without changing the database')
    args = parser.parse_args()
    if bool(args.csv) == bool(args.export_calls) or args.export_calls and args.apply:
        parser.error('provide a price CSV or --export-calls PATH; --apply is for price CSVs only')
    if not os.environ.get('DATABASE_URL'):
        parser.error('DATABASE_URL must explicitly identify the target database')
    from common.db import conn
    try:
        rows = read_prices(args.csv) if args.csv else None
        with conn() as connection:
            result = {'exported_gyms': export_calls(connection, args.export_calls)} if args.export_calls else import_prices(connection, rows, args.apply)
            if args.apply:
                connection.commit()
            else:
                connection.rollback()
        print(json.dumps(result))
    except ValueError as exc:
        parser.exit(2, f'{exc}\n')


if __name__ == '__main__':
    main()

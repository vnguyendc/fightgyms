import csv
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('manual_prices', Path(__file__).resolve().parents[1] / 'manual_prices.py')
prices = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prices)


class ManualPricesTests(unittest.TestCase):
    def read(self, rows, fields=prices.FIELDS):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'calls.csv'
            with path.open('w', newline='') as handle:
                writer = csv.writer(handle)
                writer.writerow(fields)
                writer.writerows(rows)
            return prices.read_prices(path)

    def test_free_trial_decimal_and_stable_fingerprint(self):
        rows = [['real-gym', 'trial', '0', '2026-10-01', 'Phone confirmed'], ['real-gym', 'monthly', '149.99', '2026-10-01', '']]
        result = self.read(rows)
        self.assertEqual([r['amount_cents'] for r in result], [0, 14999])
        self.assertEqual(result, self.read(rows))
        self.assertIsNone(result[1]['notes'])

    def test_reject_invalid_rows_and_duplicates(self):
        valid = ['real-gym', 'monthly', '150', '2026-10-01', '']
        for column, value in [(0, ''), (1, 'invented'), (2, '-1'), (2, 'NaN'), (2, 'Infinity'), (2, '.001'), (2, '100000000000'), (3, '2026-02-30'), (3, '2099-01-01')]:
            row = valid.copy()
            row[column] = value
            with self.subTest(column=column, value=value), self.assertRaises(ValueError):
                self.read([row])
        with self.assertRaises(ValueError):
            self.read([valid, valid])
        with self.assertRaises(ValueError):
            self.read([])
        with self.assertRaises(ValueError):
            self.read([valid], fields=['wrong'])

    def test_dry_run_is_read_only_and_unknown_gyms_fail_before_writes(self):
        class Cursor:
            def __init__(self, matched):
                self.matched = matched
                self.commands = []
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def execute(self, sql, params=None):
                self.commands.append(sql)
            def fetchall(self):
                return [{'slug': 'real-gym'}] if 'select slug' in self.commands[-1] and self.matched else []
        class Connection:
            def __init__(self, matched):
                self.cur = Cursor(matched)
            def cursor(self):
                return self.cur
        rows = self.read([['real-gym', 'monthly', '150', '2026-10-01', '']])
        good = Connection(True)
        self.assertEqual(prices.import_prices(good, rows), {'mode': 'dry-run', 'matched_gyms': 1, 'new_prices': 1, 'already_imported': 0})
        self.assertEqual(good.cur.commands[0], 'set transaction read only')
        self.assertTrue(all('insert into' not in sql for sql in good.cur.commands))
        bad = Connection(False)
        with self.assertRaisesRegex(ValueError, 'unknown, inactive or sample'):
            prices.import_prices(bad, rows)
        self.assertTrue(all('insert into' not in sql for sql in bad.cur.commands))

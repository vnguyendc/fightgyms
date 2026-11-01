import datetime as dt
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('seo_monitor', Path(__file__).resolve().parents[2] / 'ops/seo-monitor/collect.py')
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)


class MonitorTests(unittest.TestCase):
    def bundle(self):
        return {'local_date': '2026-11-01', 'period_end': '2026-10-29', 'collected_at': '2026-11-01T12:00:00+00:00', 'bundle_path': '/tmp/bundle.json', 'sources': {}}

    def test_drop_and_unavailable_are_distinct(self):
        b = self.bundle()
        b['sources']['gsc_daily'] = {'error': 'TimeoutError'}
        self.assertEqual(len(monitor.alerts(b)), 1)
        self.assertNotIn('down', monitor.alerts(b)[0])
        end = dt.date(2026, 10, 29)
        b['sources']['gsc_daily'] = {'data': [{'keys': [(end - dt.timedelta(days=i)).isoformat()], 'impressions': 10, 'clicks': 0} for i in range(7, 14)]}
        self.assertIn('down 100%', monitor.alerts(b)[0])
        b['sources']['gsc_daily'] = {'data': []}
        self.assertEqual(monitor.alerts(b), [])

    def test_site_sitemap_and_inspection_alerts(self):
        b = self.bundle()
        b['sources'] = {'homepage': {'data': {'status': 503}}, 'gsc_sitemaps': {'data': [{'errors': 1, 'lastDownloaded': '2026-10-01T00:00:00Z'}]}, 'inspections': {'data': {'url': {'coverageState': 'Crawled - currently not indexed'}, 'other': {'error': 'HttpError'}}}}
        prior = {'sources': {'inspections': {'data': {'url': {'coverageState': 'Submitted and indexed'}}}}}
        alerts = monitor.alerts(b, prior)
        self.assertEqual(len(alerts), 5)
        self.assertTrue(any('URL left' in s for s in alerts))

    def test_sample_deterministic_unique_and_at_most_thirty(self):
        urls = [monitor.ORIGIN, monitor.ORIGIN + '/gyms'] + [monitor.ORIGIN + '/gym/' + str(i) for i in range(60)] + [monitor.ORIGIN + '/gyms/va/city' + str(i) for i in range(20)]
        sample = monitor.fixed_sample(urls, [{'keys': [urls[-1]]}])
        self.assertEqual(sample, monitor.fixed_sample(urls, [{'keys': [urls[-1]]}]))
        self.assertEqual(len(sample), 30)
        self.assertEqual(len(set(sample)), 30)
        self.assertIn(urls[-1], sample)
        self.assertEqual(monitor.fixed_sample([], []), [])

    def test_note_no_source_never_fabricates_a_chart(self):
        b = self.bundle()
        b['alerts'] = ['source unavailable']
        note = monitor.render_note(b, '2026-10-25')
        self.assertIn('Previous: [[FightGyms SEO Weekly 2026-10-25]]', note)
        self.assertIn('Search performance unavailable', note)
        self.assertNotIn('xychart-beta', note)
        b['sources']['gsc_daily'] = {'data': []}
        self.assertIn('xychart-beta', monitor.render_note(b))

    def test_fifty_percent_alert_boundary(self):
        b = self.bundle()
        end = dt.date(2026, 10, 29)
        prior = {'keys': [(end - dt.timedelta(days=7)).isoformat()], 'impressions': 100, 'clicks': 1}
        current = {'keys': [end.isoformat()], 'impressions': 50, 'clicks': 1}
        b['sources']['gsc_daily'] = {'data': [prior, current]}
        self.assertTrue(any('down 50%' in text for text in monitor.alerts(b)))
        current['impressions'] = 51
        self.assertEqual(monitor.alerts(b), [])

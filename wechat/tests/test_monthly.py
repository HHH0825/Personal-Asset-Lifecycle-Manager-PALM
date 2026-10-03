import unittest
from datetime import date
import test_backend as fixtures
from palm.reports import month_bounds

class MonthlyTest(unittest.TestCase):
    setUp = fixtures.MiniApiTest.setUp
    token = fixtures.MiniApiTest.token
    headers = fixtures.MiniApiTest.headers
    create_item = fixtures.MiniApiTest.create_item

    def test_event_months_precision_isolation_and_trash(self):
        alice, bob = self.token('alice'), self.token('bob')
        h = self.headers(alice)
        item = self.create_item(alice)
        self.create_item(bob)
        for day, cost in [('2025-01-02', '10.01'), ('2025-01-03', '0'), ('2025-02-03', '99.99')]:
            self.assertEqual(self.client.post(f'/api/mp/items/{item}/maintenance', headers=h,
                json={'maintained_on': day, 'cost': cost, 'description': '检查'}).status_code, 201)
        usage = self.client.post(f'/api/mp/items/{item}/usage', headers=h, json={'used_on': '2025-01-31', 'notes': ''}).json
        self.client.post(f'/api/mp/items/{item}/usage', headers=h, json={'used_on': '2025-02-01', 'notes': ''})
        self.client.post(f'/api/mp/items/{item}/disposal', headers=h,
            json={'disposed_on': '2025-03-01', 'method': 'sold', 'proceeds': '2000', 'notes': ''})
        def report(month): return self.client.get('/api/mp/reports/monthly?month=' + month, headers=h).json
        january = report('2025-01')
        self.assertEqual(january['totals'], {'purchase_count': 1, 'purchase_total': '1200.00',
            'maintenance_total': '10.01', 'disposal_total': '0.00', 'usage_count': 1})
        self.assertEqual(report('2025-02')['totals']['maintenance_total'], '99.99')
        self.assertEqual(report('2025-03')['totals']['disposal_total'], '2000.00')
        self.assertEqual(report('2024-12')['has_activity'], False)
        self.client.put('/api/mp/usage/' + str(usage['id']), headers=h, json={'used_on': '2025-02-02', 'notes': ''})
        self.assertEqual(report('2025-01')['totals']['usage_count'], 0)
        self.client.delete(f'/api/mp/items/{item}', headers=h)
        self.assertEqual(report('2025-01')['has_activity'], False)
        self.client.post(f'/api/mp/trash/{item}/restore', headers=h)
        self.assertEqual(report('2025-01')['totals']['purchase_count'], 1)
        other = self.client.get('/api/mp/reports/monthly?month=2025-01', headers=self.headers(bob)).json
        self.assertEqual(other['totals']['maintenance_total'], '0.00')
        self.assertNotEqual(other['purchases'][0]['id'], item)
        self.assertEqual(self.client.get('/api/mp/reports/monthly').status_code, 401)

    def test_target_recalculation_and_anniversary(self):
        token = self.token('owner'); h = self.headers(token); item = self.create_item(token)
        self.client.put(f'/api/mp/items/{item}/daily-target', headers=h, json={'amount': '120.00'})
        report = self.client.get('/api/mp/reports/monthly?month=2025-01', headers=h).json
        self.assertEqual(report['memories'][0]['date'], '2025-01-11')
        self.assertEqual(report['memories'][0]['kind'], 'target')
        anniversary = self.client.get('/api/mp/reports/monthly?month=2026-01', headers=h).json
        self.assertEqual(anniversary['memories'][0]['label'], '相伴 1 年')
        self.client.put(f'/api/mp/items/{item}/daily-target', headers=h, json={'amount': None})
        self.assertEqual(self.client.get('/api/mp/reports/monthly?month=2025-01', headers=h).json['memories'], [])

    def test_current_month_leap_and_invalid_months(self):
        token = self.token('owner'); h = self.headers(token)
        self.assertEqual(month_bounds('2024-02', date(2024, 3, 1))[1], date(2024, 2, 29))
        self.assertEqual(month_bounds('2025-12', date(2026, 1, 2))[1], date(2025, 12, 31))
        self.assertEqual(month_bounds('2026-01', date(2026, 1, 2))[1], date(2026, 1, 2))
        for month in ['2025-13', '2025-1', 'garbage', '', '9999-01']:
            self.assertEqual(self.client.get('/api/mp/reports/monthly?month=' + month, headers=h).status_code, 400)
        report = self.client.get('/api/mp/reports/monthly', headers=h).json
        self.assertTrue(report['is_current'])
        self.assertEqual(report['cutoff_date'], report['today'])

if __name__ == '__main__': unittest.main()

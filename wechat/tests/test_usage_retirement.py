"""Retired usage data remains read-only and does not influence current workflows."""
import unittest
import test_backend as fixtures
from palm.database import get_db


class UsageRetirementTest(unittest.TestCase):
    setUp = fixtures.MiniApiTest.setUp
    token = fixtures.MiniApiTest.token
    headers = fixtures.MiniApiTest.headers
    create_item = fixtures.MiniApiTest.create_item

    def legacy_usage(self, item, day='2025-02-01'):
        with self.app.app_context():
            cursor = get_db().execute(
                'INSERT INTO usage_records (item_id, used_on, notes) VALUES (?, ?, ?)',
                (item, day, '旧记录'))
            get_db().commit()
            return cursor.lastrowid

    def test_retired_writes_authorize_before_410_and_preserve_history(self):
        owner, outsider = self.token('owner'), self.token('outsider')
        item = self.create_item(owner)
        record = self.legacy_usage(item)
        paths = [('POST', f'/api/mp/items/{item}/usage/today'),
                 ('POST', f'/api/mp/items/{item}/usage'),
                 ('PUT', f'/api/mp/usage/{record}'), ('DELETE', f'/api/mp/usage/{record}')]
        for method, path in paths:
            for token, status in [(None, 401), (outsider, 404), (owner, 410)]:
                response = self.client.open(path, method=method, headers=self.headers(token) if token else {}, json={})
                self.assertEqual(response.status_code, status, (method, path, response.json))
                if status == 410:
                    self.assertEqual(response.json['error'], '使用记录已停用，历史记录仍可查看')
        history = self.client.get(f'/api/mp/items/{item}/usage', headers=self.headers(owner)).json
        self.assertEqual(history, [{'id': record, 'item_id': item, 'used_on': '2025-02-01', 'notes': '旧记录'}])
        self.assertEqual(self.client.get(f'/api/mp/items/{item}/usage', headers=self.headers(outsider)).status_code, 404)
        self.client.delete(f'/api/mp/items/{item}', headers=self.headers(owner))
        for method, path in paths:
            self.assertEqual(self.client.open(path, method=method, headers=self.headers(owner)).status_code, 404)
        self.client.post(f'/api/mp/trash/{item}/restore', headers=self.headers(owner))
        self.assertEqual(len(self.client.get(f'/api/mp/items/{item}/usage', headers=self.headers(owner)).json), 1)

    def test_old_dates_no_longer_restrict_purchase_or_disposal_but_repairs_do(self):
        token = self.token('owner'); h = self.headers(token); item = self.create_item(token)
        self.legacy_usage(item, '2025-01-02')
        self.legacy_usage(item, '2025-12-31')
        fields = {'name': '相机', 'category': '数码设备', 'icon_type': 'digital',
                  'purchase_date': '2025-03-01', 'purchase_price': '1200.00', 'status': 'active'}
        self.assertEqual(self.client.put(f'/api/mp/items/{item}', headers=h, json=fields).status_code, 200)
        self.assertEqual(self.client.post(f'/api/mp/items/{item}/maintenance', headers=h,
            json={'maintained_on': '2025-04-01', 'cost': '0', 'description': '检查'}).status_code, 201)
        fields['purchase_date'] = '2025-05-01'
        self.assertEqual(self.client.put(f'/api/mp/items/{item}', headers=h, json=fields).status_code, 400)
        disposal = {'disposed_on': '2025-03-31', 'method': 'sold', 'proceeds': '0'}
        self.assertEqual(self.client.post(f'/api/mp/items/{item}/disposal', headers=h, json=disposal).status_code, 400)
        disposal['disposed_on'] = '2025-04-02'
        self.assertEqual(self.client.post(f'/api/mp/items/{item}/disposal', headers=h, json=disposal).status_code, 201)
        self.assertEqual(len(self.client.get(f'/api/mp/items/{item}', headers=h).json['usage_records']), 2)

    def test_insights_only_keep_manual_idle_and_usage_only_month_is_empty(self):
        token = self.token('owner'); h = self.headers(token)
        active, unknown, idle = [self.create_item(token, name) for name in ['旧使用', '无记录', '闲置']]
        self.legacy_usage(active, '2025-02-01')
        with self.app.app_context():
            get_db().execute("UPDATE items SET status='idle' WHERE id=?", (idle,))
            get_db().commit()
        insights = self.client.get('/api/mp/insights', headers=h).json
        self.assertEqual([item['id'] for item in insights['review_items']], [idle])
        self.assertEqual(insights['unknown_usage_items'], [])
        kinds = [card['kind'] for card in insights['analysis_cards']]
        self.assertIn('manual_idle', kinds)
        self.assertNotIn('inactive', kinds)
        self.assertNotIn('unknown_use', kinds)
        report = self.client.get('/api/mp/reports/monthly?month=2025-02', headers=h).json
        self.assertFalse(report['has_activity'])
        self.assertEqual(report['totals']['usage_count'], 0)

    def test_monthly_leaders_ties_zero_total_precision_and_user_scope(self):
        token, outsider = self.token('owner'), self.token('other'); h = self.headers(token)
        ids = [self.create_item(token, name) for name in ['相机', '书', '杯子']]
        other = self.create_item(outsider)
        with self.app.app_context():
            get_db().executemany('UPDATE items SET purchase_cents=? WHERE id=?', [(100, ids[0]), (100, ids[1]), (99, ids[2]), (999999, other)])
            get_db().commit()
        report = self.client.get('/api/mp/reports/monthly?month=2025-01', headers=h).json
        self.assertEqual(report['totals']['cashflow_net'], '2.99')
        self.assertEqual({row['id'] for row in report['purchase_leaders']}, set(ids[:2]))
        self.assertEqual([row['share'] for row in report['purchase_leaders']], ['33.44', '33.44'])
        with self.app.app_context():
            get_db().executemany('UPDATE items SET purchase_cents=0 WHERE id=?', [(item,) for item in ids])
            get_db().commit()
        report = self.client.get('/api/mp/reports/monthly?month=2025-01', headers=h).json
        self.assertEqual(len(report['purchase_leaders']), 3)
        self.assertTrue(all(row['share'] is None for row in report['purchase_leaders']))
        self.assertEqual(report['totals']['cashflow_net'], '0.00')
        self.assertTrue(report['has_activity'])
        empty = self.client.get('/api/mp/reports/monthly?month=2024-12', headers=h).json
        self.assertEqual(empty['purchase_leaders'], [])


if __name__ == '__main__':
    unittest.main()

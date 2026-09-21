import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from app import create_app


def day(offset=0):
    return (date.today() - timedelta(days=offset)).isoformat()


class PalmApiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.database = str(Path(self.temp.name) / "test.sqlite3")
        self.app = create_app({"TESTING": True, "DATABASE": self.database})
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def make_item(self, **changes):
        data = {"name": "笔记本", "category": "数码", "purchase_date": day(30),
                "purchase_price": "1000.00", "status": "active", "notes": ""}
        data.update(changes)
        response = self.client.post("/api/items", json=data)
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def test_lifecycle_cost_search_and_persistence(self):
        item = self.make_item()
        item_id = item["id"]
        self.assertEqual(self.client.post(f"/api/items/{item_id}/usage", json={"used_on": day(20), "notes": "学习"}).status_code, 201)
        repair = self.client.post(f"/api/items/{item_id}/maintenance", json={
            "maintained_on": day(10), "cost": "120.50", "description": "更换配件"}).json
        self.assertEqual(self.client.get(f"/api/items/{item_id}").json["net_cost"], "1120.50")
        self.assertEqual(self.client.put(f"/api/maintenance/{repair['id']}", json={
            "maintained_on": day(10), "cost": "100.00", "description": "更换配件"}).status_code, 200)
        disposal = self.client.post(f"/api/items/{item_id}/disposal", json={
            "disposed_on": day(5), "method": "sold", "proceeds": "400.00", "notes": ""})
        self.assertEqual(disposal.status_code, 201)
        detail = self.client.get(f"/api/items/{item_id}").json
        self.assertEqual((detail["status"], detail["net_cost"], detail["holding_days"], detail["usage_count"]),
                         ("disposed", "700.00", 25, 1))
        self.assertEqual(self.client.get('/api/items?q=笔记').json[0]["id"], item_id)
        self.assertEqual(self.client.get('/api/stats').json["net_cost_total"], "700.00")
        restarted = create_app({"TESTING": True, "DATABASE": self.database}).test_client()
        self.assertEqual(restarted.get(f"/api/items/{item_id}").json["net_cost"], "700.00")
        self.assertEqual(self.client.delete(f"/api/disposal/{disposal.json['id']}").status_code, 204)
        self.assertEqual(self.client.get(f"/api/items/{item_id}").json["status"], "idle")
        self.assertEqual(self.client.delete(f"/api/maintenance/{repair['id']}").status_code, 204)
        self.assertEqual(self.client.delete(f"/api/items/{item_id}").status_code, 204)
        self.assertEqual(self.client.get(f"/api/items/{item_id}").status_code, 404)

    def test_validation_and_item_edit(self):
        bad = self.client.post('/api/items', json={"name": "", "category": "数码", "purchase_date": day(), "purchase_price": "1"})
        self.assertEqual(bad.status_code, 400)
        self.assertIn("物品名称", bad.json["error"])
        self.assertEqual(self.client.post('/api/items', json={"name": "A", "category": "B", "purchase_date": day(), "purchase_price": "-1"}).status_code, 400)
        item = self.make_item()
        item_id = item["id"]
        self.assertEqual(self.client.post(f"/api/items/{item_id}/usage", json={"used_on": day(40), "notes": ""}).status_code, 400)
        self.assertEqual(self.client.post(f"/api/items/{item_id}/usage", json={"used_on": day(20), "notes": ""}).status_code, 201)
        edit = {"name": "新名字", "category": "学习", "purchase_date": day(30), "purchase_price": "899.99", "status": "idle", "notes": "更新"}
        self.assertEqual(self.client.put(f"/api/items/{item_id}", json=edit).json["status"], "idle")
        self.assertEqual(self.client.put(f"/api/items/{item_id}", json={**edit, "purchase_date": day(10)}).status_code, 400)
        self.assertEqual(self.client.post(f"/api/items/{item_id}/disposal", json={"disposed_on": day(25), "method": "sold", "proceeds": "1", "notes": ""}).status_code, 400)
        self.assertEqual(self.client.post(f"/api/items/{item_id}/disposal", json={"disposed_on": day(5), "method": "sold", "proceeds": "1", "notes": ""}).status_code, 201)
        self.assertEqual(self.client.post(f"/api/items/{item_id}/usage", json={"used_on": day(1), "notes": ""}).status_code, 400)
        self.assertEqual(self.client.put(f"/api/items/{item_id}", json={**edit, "status": "active"}).status_code, 400)


if __name__ == '__main__':
    unittest.main()

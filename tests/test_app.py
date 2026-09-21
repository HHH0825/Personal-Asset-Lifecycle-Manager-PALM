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
        after_repair = self.client.get(f"/api/items/{item_id}").json
        self.assertEqual((after_repair["daily_purchase_cost"], after_repair["daily_net_cost"]),
                         ("33.33", "36.67"))
        disposal = self.client.post(f"/api/items/{item_id}/disposal", json={
            "disposed_on": day(5), "method": "sold", "proceeds": "400.00", "notes": ""})
        self.assertEqual(disposal.status_code, 201)
        detail = self.client.get(f"/api/items/{item_id}").json
        self.assertEqual((detail["status"], detail["net_cost"], detail["holding_days"], detail["usage_count"]),
                         ("disposed", "700.00", 25, 1))
        self.assertEqual((detail["daily_purchase_cost"], detail["daily_net_cost"]), ("40.00", "28.00"))
        listed = self.client.get("/api/items").json[0]
        self.assertEqual((listed["holding_days"], listed["daily_purchase_cost"], listed["daily_net_cost"]),
                         (detail["holding_days"], detail["daily_purchase_cost"], detail["daily_net_cost"]))
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

    def test_monthly_insights_and_all_time_totals(self):
        first_this_month = date.today().replace(day=1)
        last_previous_month = first_this_month - timedelta(days=1)
        current_month = first_this_month.strftime("%Y-%m")
        previous_month = last_previous_month.strftime("%Y-%m")
        item = self.make_item(purchase_date=last_previous_month.isoformat(), purchase_price="100.00")
        item_id = item["id"]
        self.assertEqual(self.client.post(f"/api/items/{item_id}/maintenance", json={
            "maintained_on": day(), "cost": "25.50", "description": "维修"}).status_code, 201)
        self.assertEqual(self.client.post(f"/api/items/{item_id}/disposal", json={
            "disposed_on": day(), "method": "sold", "proceeds": "30.00", "notes": ""}).status_code, 201)
        start_month = date.today().year * 12 + date.today().month - 1 - 11
        old_year, old_index = divmod(start_month, 12)
        older_than_chart = date(old_year, old_index + 1, 1) - timedelta(days=1)
        self.make_item(name="旧物品", purchase_date=older_than_chart.isoformat(), purchase_price="40.00")

        insights = self.client.get("/api/insights").json
        self.assertEqual(len(insights["months"]), 12)
        months = {entry["month"]: entry for entry in insights["months"]}
        self.assertEqual(months[previous_month]["purchase"], "100.00")
        self.assertEqual(months[current_month]["maintenance"], "25.50")
        self.assertEqual(months[current_month]["proceeds"], "30.00")
        self.assertEqual(sum(float(entry["purchase"]) for entry in insights["months"]), 100.0)
        self.assertEqual(self.client.get("/api/stats").json["purchase_total"], "140.00")

    def test_review_rules_and_daily_cost_boundaries(self):
        idle = self.make_item(name="手动闲置", purchase_date=day(120), status="idle", purchase_price="0.00")
        threshold = self.make_item(name="恰好九十天", purchase_date=day(120))
        recent = self.make_item(name="八十九天", purchase_date=day(120))
        unknown = self.make_item(name="无使用记录", purchase_date=day(120))
        disposed = self.make_item(name="已处置", purchase_date=day(120))
        self.client.post(f"/api/items/{threshold['id']}/usage", json={"used_on": day(90), "notes": ""})
        self.client.post(f"/api/items/{recent['id']}/usage", json={"used_on": day(89), "notes": ""})
        self.client.post(f"/api/items/{disposed['id']}/usage", json={"used_on": day(100), "notes": ""})
        self.client.post(f"/api/items/{disposed['id']}/disposal", json={
            "disposed_on": day(10), "method": "sold", "proceeds": "1200.00", "notes": ""})

        insights = self.client.get("/api/insights").json
        review = {entry["id"]: entry for entry in insights["review_items"]}
        unknown_ids = {entry["id"] for entry in insights["unknown_usage_items"]}
        self.assertEqual(set(review), {idle["id"], threshold["id"]})
        self.assertEqual(review[threshold["id"]]["days_since_last_recorded_use"], 90)
        self.assertEqual(review[idle["id"]]["review_reason"], "manual_idle")
        self.assertEqual(unknown_ids, {unknown["id"]})
        self.assertNotIn(disposed["id"], review)
        self.assertNotIn(recent["id"], review)

        same_day = self.make_item(name="今天购买", purchase_date=day(), purchase_price="0.00")
        self.assertIsNone(self.client.get(f"/api/items/{same_day['id']}").json["daily_net_cost"])
        self.assertIsNone(self.client.get(f"/api/items/{same_day['id']}").json["daily_purchase_cost"])
        self.assertEqual(self.client.get(f"/api/items/{idle['id']}").json["daily_purchase_cost"], "0.00")
        disposed_detail = self.client.get(f"/api/items/{disposed['id']}").json
        self.assertEqual(disposed_detail["net_cost"], "-200.00")
        self.assertEqual(disposed_detail["holding_days"], 110)
        self.assertEqual(disposed_detail["daily_net_cost"], "-1.82")
        self.assertEqual(disposed_detail["daily_purchase_cost"], "9.09")
        self.assertEqual(disposed_detail["last_recorded_use"], day(100))


if __name__ == '__main__':
    unittest.main()

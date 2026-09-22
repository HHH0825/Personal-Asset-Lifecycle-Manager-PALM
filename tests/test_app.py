import tempfile
import unittest
import sqlite3
from contextlib import closing
from datetime import date, timedelta
from pathlib import Path

from app import create_app
from werkzeug.security import generate_password_hash


def day(offset=0):
    return (date.today() - timedelta(days=offset)).isoformat()


class PalmApiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.database = str(Path(self.temp.name) / "test.sqlite3")
        self.app = create_app({"TESTING": True, "DATABASE": self.database})
        self.client = self.app.test_client()
        self.auth(self.client, "owner", register=True)

    def auth(self, client, username, register=False):
        token = client.get("/api/auth/me").json["csrf_token"]
        client.environ_base["HTTP_X_CSRF_TOKEN"] = token
        response = client.post("/api/auth/register" if register else "/api/auth/login", json={
            "username": username, "password": "a-strong-password-123",
        })
        self.assertEqual(response.status_code, 201 if register else 200, response.json)
        client.environ_base["HTTP_X_CSRF_TOKEN"] = response.json["csrf_token"]
        return response.json["user"]

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
        self.assertEqual(self.app.secret_key, restarted.application.secret_key)
        self.auth(restarted, "owner")
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

    def test_icon_type_create_edit_and_validation(self):
        item = self.make_item(name="自定义分类物品", category="我的分类")
        self.assertEqual(item["icon_type"], "other")
        edit = {"name": item["name"], "category": item["category"], "purchase_date": item["purchase_date"],
                "purchase_price": item["purchase_price"], "status": item["status"], "notes": ""}
        for icon_type in ("digital", "home", "daily", "clothing", "books", "mobility", "sports", "tools", "other"):
            response = self.client.put(f"/api/items/{item['id']}", json={**edit, "icon_type": icon_type})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json["icon_type"], icon_type)
            self.assertEqual(self.client.get("/api/items").json[0]["icon_type"], icon_type)
        self.assertEqual(self.client.put(f"/api/items/{item['id']}", json={**edit, "icon_type": "books"}).status_code, 200)
        self.assertEqual(self.client.put(f"/api/items/{item['id']}", json=edit).json["icon_type"], "books")
        for invalid in ("unknown", "", None, 1):
            self.assertEqual(self.client.put(f"/api/items/{item['id']}", json={**edit, "icon_type": invalid}).status_code, 400)
            self.assertEqual(self.client.post("/api/items", json={**edit, "icon_type": invalid}).status_code, 400)

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

    def test_authentication_and_user_isolation(self):
        owner_item = self.make_item(name="甲的物品")
        owner_id = owner_item["id"]
        repair = self.client.post(f"/api/items/{owner_id}/maintenance", json={
            "maintained_on": day(1), "cost": "20", "description": "维修",
        }).json["id"]
        usage = self.client.post(f"/api/items/{owner_id}/usage", json={
            "used_on": day(20), "notes": "使用",
        }).json["id"]
        disposed_item = self.make_item(name="甲处置的物品")
        disposal = self.client.post(f"/api/items/{disposed_item['id']}/disposal", json={
            "disposed_on": day(1), "method": "sold", "proceeds": "10", "notes": "",
        }).json["id"]

        stranger = self.app.test_client()
        self.assertEqual(stranger.get("/api/items").status_code, 401)
        self.assertEqual(stranger.get("/api/stats").status_code, 401)
        self.assertEqual(stranger.get("/api/insights").status_code, 401)
        self.assertEqual(stranger.post("/api/auth/register", json={"username": "x", "password": "123"}).status_code, 403)
        self.auth(stranger, "second", register=True)
        self.assertEqual(stranger.get("/api/items").json, [])
        self.assertEqual(stranger.get("/api/stats").json["total_items"], 0)
        self.assertEqual(stranger.get("/api/insights").json["review_items"], [])
        for path in (f"/api/items/{owner_id}", f"/api/items/{owner_id}/usage",
                     f"/api/items/{owner_id}/maintenance", f"/api/items/{disposed_item['id']}/disposal"):
            self.assertEqual(stranger.get(path).status_code, 404, path)
        self.assertEqual(stranger.put(f"/api/items/{owner_id}", json={}).status_code, 404)
        self.assertEqual(stranger.delete(f"/api/items/{owner_id}").status_code, 404)
        self.assertEqual(stranger.post(f"/api/items/{owner_id}/usage", json={}).status_code, 404)
        for path in (f"/api/maintenance/{repair}", f"/api/usage/{usage}", f"/api/disposal/{disposal}"):
            self.assertEqual(stranger.put(path, json={}).status_code, 404, path)
            self.assertEqual(stranger.delete(path).status_code, 404, path)
        own = stranger.post("/api/items", json={"name": "乙的物品", "category": "数码", "purchase_date": day(2),
                                                   "purchase_price": "15.00", "status": "active", "notes": ""})
        self.assertEqual(own.status_code, 201)
        self.assertEqual(stranger.get("/api/stats").json["purchase_total"], "15.00")
        self.assertEqual(self.client.get("/api/stats").json["purchase_total"], "2000.00")
        self.assertEqual(sum(float(month["purchase"]) for month in stranger.get("/api/insights").json["months"]), 15)
        self.assertEqual(len(self.client.get("/api/items").json), 2)
        self.assertEqual(stranger.get("/api/items?q=甲").json, [])
        self.assertEqual(stranger.get("/api/insights").json["unknown_usage_items"][0]["id"], own.json["id"])
        self.assertEqual(stranger.post("/api/auth/logout").status_code, 204)
        self.assertEqual(stranger.get("/api/items").status_code, 401)
        self.auth(stranger, "owner")
        self.assertEqual(len(stranger.get("/api/items").json), 2)
        self.assertEqual(stranger.get(f"/api/items/{own.json['id']}").status_code, 404)

    def test_registration_validation_and_csrf(self):
        other = self.app.test_client()
        token = other.get("/api/auth/me").json["csrf_token"]
        other.environ_base["HTTP_X_CSRF_TOKEN"] = token
        self.assertEqual(other.post("/api/auth/register", json={"username": "OWNER", "password": "a-strong-password-123"}).status_code, 400)
        self.assertEqual(other.post("/api/auth/register", json={"username": "x", "password": "a-strong-password-123"}).status_code, 400)
        self.assertEqual(other.post("/api/auth/register", json={"username": "other", "password": "123"}).status_code, 400)
        self.assertEqual(other.post("/api/auth/login", json={"username": "owner", "password": "wrong-password"}).status_code, 401)
        self.assertEqual(other.get("/api/auth/me").json["user"], None)
        self.assertEqual(other.get("/api/auth/me").headers["Cache-Control"], "no-store")
        other.environ_base["HTTP_X_CSRF_TOKEN"] = "invalid"
        self.assertEqual(other.post("/api/auth/login", json={"username": "owner", "password": "a-strong-password-123"}).status_code, 403)
        self.client.environ_base["HTTP_X_CSRF_TOKEN"] = "invalid"
        self.assertEqual(self.client.post("/api/items", json={}).status_code, 403)
        self.assertEqual(self.client.delete("/api/items/1").status_code, 403)

    def test_existing_database_migrates_to_first_account(self):
        with tempfile.TemporaryDirectory() as folder:
            old_database = str(Path(folder) / "old.sqlite3")
            with closing(sqlite3.connect(old_database)) as connection:
                connection.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, category TEXT, "
                                   "purchase_date TEXT, purchase_cents INTEGER, notes TEXT, status TEXT, created_at TEXT)")
                connection.execute("CREATE TABLE usage_records (id INTEGER PRIMARY KEY, item_id INTEGER, used_on TEXT, notes TEXT)")
                connection.execute("INSERT INTO items VALUES (1, '旧物品', '数码', ?, 10000, '', 'active', CURRENT_TIMESTAMP)", (day(5),))
                connection.execute("INSERT INTO usage_records VALUES (1, 1, ?, '旧使用记录')", (day(2),))
                connection.commit()
            migrated = create_app({"TESTING": True, "DATABASE": old_database, "SECRET_KEY": "test-key"})
            self.assertTrue(Path(old_database + ".pre-accounts.bak").exists())
            self.assertTrue(Path(old_database + ".pre-icons.bak").exists())
            create_app({"TESTING": True, "DATABASE": old_database, "SECRET_KEY": "test-key"})
            first = migrated.test_client()
            second = migrated.test_client()
            self.auth(first, "first", register=True)
            self.auth(second, "second", register=True)
            self.assertEqual(first.get("/api/items").json[0]["name"], "旧物品")
            self.assertEqual(first.get("/api/items/1").json["usage_records"][0]["notes"], "旧使用记录")
            self.assertEqual(first.get("/api/items/1").json["icon_type"], "other")
            self.assertEqual(second.get("/api/items").json, [])
            self.assertEqual(second.get("/api/items/1").status_code, 404)

    def test_icon_migration_keeps_existing_user_ownership(self):
        with tempfile.TemporaryDirectory() as folder:
            database = str(Path(folder) / "accounts.sqlite3")
            with closing(sqlite3.connect(database)) as connection:
                connection.executescript("""
                    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL,
                        username_key TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT);
                    CREATE TABLE items (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT NOT NULL,
                        category TEXT NOT NULL, purchase_date TEXT NOT NULL, purchase_cents INTEGER NOT NULL,
                        notes TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT);
                """)
                password_hash = generate_password_hash("a-strong-password-123")
                for user_id, username in ((1, "first"), (2, "second")):
                    connection.execute("INSERT INTO users VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
                                       (user_id, username, username, password_hash))
                for item_id, user_id, category in ((1, 1, "数码设备"), (2, 1, "日常用品"),
                                                    (3, 1, "出行用品"), (4, 2, "自定义分类")):
                    connection.execute("INSERT INTO items VALUES (?, ?, ?, ?, ?, 10000, '', 'active', CURRENT_TIMESTAMP)",
                                       (item_id, user_id, f"旧物品{item_id}", category, day(5)))
                connection.commit()
            migrated = create_app({"TESTING": True, "DATABASE": database, "SECRET_KEY": "test-key"})
            self.assertTrue(Path(database + ".pre-icons.bak").exists())
            first, second = migrated.test_client(), migrated.test_client()
            self.auth(first, "first")
            self.auth(second, "second")
            self.assertEqual({item["category"]: item["icon_type"] for item in first.get("/api/items").json},
                             {"数码设备": "digital", "日常用品": "daily", "出行用品": "mobility"})
            self.assertEqual([(item["category"], item["icon_type"]) for item in second.get("/api/items").json],
                             [("自定义分类", "other")])
            self.assertEqual(second.get("/api/items/1").status_code, 404)
            create_app({"TESTING": True, "DATABASE": database, "SECRET_KEY": "test-key"})
            self.assertEqual(first.get("/api/items/1").json["icon_type"], "digital")

    def test_public_pages_and_auth_redirects(self):
        guest = self.app.test_client()
        home = guest.get("/")
        self.assertEqual(home.status_code, 200)
        self.assertIn('id="demo-slider"', home.text)
        self.assertNotIn('id="app-shell"', home.text)
        self.assertIn('data-mode="login"', guest.get("/login").text)
        self.assertIn('data-mode="register"', guest.get("/register").text)
        self.assertEqual(guest.get("/app").location, "/login")
        for path in ("/", "/login", "/register"):
            self.assertEqual(self.client.get(path).location, "/app")
        archive = self.client.get("/app")
        self.assertEqual(archive.status_code, 200)
        self.assertEqual(archive.headers["Cache-Control"], "no-store")
        self.assertIn('id="app-shell"', archive.text)
        self.assertNotIn('id="auth-form"', archive.text)
        self.client.post("/api/auth/logout")
        self.assertEqual(self.client.get("/").status_code, 200)
        self.assertEqual(self.client.get("/app").location, "/login")

    def test_daily_target_save_validation_isolation_and_persistence(self):
        item = self.make_item(purchase_date=day(150), purchase_price="300.00")
        path = f"/api/items/{item['id']}/daily-target"
        self.assertIsNone(item["daily_target"])
        for invalid in ("0", "-1", "NaN", True, "0.001", "1000000000", "", [], {}):
            self.assertEqual(self.client.put(path, json={"amount": invalid}).status_code, 400, invalid)
        self.assertEqual(self.client.put(path, json={}).status_code, 400)
        response = self.client.put(path, json={"amount": "1.00"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["daily_target"]["progress_percent"], 50)
        self.assertEqual(response.json["daily_target"]["remaining_days"], 150)
        self.assertEqual(self.client.get("/api/items").json[0]["daily_target"], response.json["daily_target"])
        self.client.post(f"/api/items/{item['id']}/maintenance", json={"maintained_on": day(), "cost": "900", "description": "维修"})
        self.assertEqual(self.client.get(f"/api/items/{item['id']}").json["daily_target"], response.json["daily_target"])
        other = self.app.test_client()
        self.auth(other, "target_other", register=True)
        self.assertEqual(other.put(path, json={"amount": "1"}).status_code, 404)
        self.assertEqual(other.get("/api/items").json, [])
        restarted = create_app({"TESTING": True, "DATABASE": self.database}).test_client()
        self.auth(restarted, "owner")
        self.assertEqual(restarted.get(f"/api/items/{item['id']}").json["daily_target"]["amount"], "1.00")
        self.assertIsNone(self.client.put(path, json={"amount": None}).json["daily_target"])
        self.client.environ_base["HTTP_X_CSRF_TOKEN"] = "wrong"
        self.assertEqual(self.client.put(path, json={"amount": "1"}).status_code, 403)

    def test_target_recalculates_on_item_and_disposal_edits(self):
        item = self.make_item(purchase_date=day(300), purchase_price="300.01")
        path = f"/api/items/{item['id']}"
        goal = self.client.put(path + "/daily-target", json={"amount": "1"}).json
        self.assertEqual(goal["daily_purchase_cost"], "1.00")
        self.assertEqual(goal["daily_target"]["status"], "pending")
        edit = {"name": item["name"], "category": item["category"], "purchase_date": day(300),
                "purchase_price": "200.00", "notes": "", "status": "active"}
        updated = self.client.put(path, json=edit).json
        self.assertEqual(updated["daily_target"]["amount"], "1.00")
        self.assertEqual(updated["daily_target"]["status"], "reached")
        disposed = self.client.post(path + "/disposal", json={"disposed_on": day(150), "method": "sold", "proceeds": "1000", "notes": ""}).json
        frozen = self.client.get(path).json
        self.assertEqual((frozen["holding_days"], frozen["daily_target"]["status"]), (150, "closed"))
        self.assertIsNone(frozen["milestones"]["next"])
        self.assertEqual(self.client.put(path + "/daily-target", json={"amount": None}).status_code, 400)
        self.client.put(f"/api/disposal/{disposed['id']}", json={"disposed_on": day(50), "method": "sold", "proceeds": "1000", "notes": ""})
        self.assertEqual(self.client.get(path).json["daily_target"]["status"], "reached")
        self.client.delete(f"/api/disposal/{disposed['id']}")
        self.assertEqual(self.client.put(path + "/daily-target", json={"amount": "0.50"}).json["daily_target"]["status"], "pending")
        self.assertEqual(self.client.put(path, json={**edit, "purchase_date": day(400)}).json["daily_target"]["status"], "reached")

    def test_goal_migration_backup_and_idempotency(self):
        item = self.make_item(purchase_price="135.25", icon_type="books")
        self.client.post(f"/api/items/{item['id']}/usage", json={"used_on": day(2), "notes": "原有记录"})
        # Recreate the immediately preceding schema by removing only the new column.
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute("ALTER TABLE items DROP COLUMN daily_target_cents")
            connection.execute("PRAGMA user_version = 3")
            connection.commit()
        create_app({"TESTING": True, "DATABASE": self.database})
        backup = Path(self.database + ".pre-goals.bak")
        original_backup = backup.read_bytes()
        with closing(sqlite3.connect(backup)) as connection:
            self.assertNotIn("daily_target_cents", [row[1] for row in connection.execute("PRAGMA table_info(items)")])
        detail = self.client.get(f"/api/items/{item['id']}").json
        self.assertEqual((detail["purchase_price"], detail["icon_type"], detail["usage_records"][0]["notes"]),
                         ("135.25", "books", "原有记录"))
        self.assertIsNone(detail["daily_target"])
        self.client.put(f"/api/items/{item['id']}/daily-target", json={"amount": "2"})
        create_app({"TESTING": True, "DATABASE": self.database})
        self.assertEqual(backup.read_bytes(), original_backup)
        self.assertEqual(self.client.get(f"/api/items/{item['id']}").json["daily_target"]["amount"], "2.00")


if __name__ == '__main__':
    unittest.main()

"""Checks for the refactor's data isolation and fixed query count."""

import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

from app import create_app, initialize_app
from palm.database import get_db, initialize_database


ROOT = Path(__file__).resolve().parent.parent


class ArchitectureTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        base = Path(self.temporary.name)
        self.database = base / "isolated.sqlite3"
        self.app = initialize_app(create_app({
            "TESTING": True, "DATABASE": str(self.database),
            "PHOTO_DIR": str(base / "photos"), "KEY_PATH": str(base / "secret.key"),
        }))
        self.client = self.app.test_client()
        token = self.client.get("/api/auth/me").json["csrf_token"]
        self.client.environ_base["HTTP_X_CSRF_TOKEN"] = token
        result = self.client.post("/api/auth/register", json={
            "username": "architecture", "password": "strong-password-123",
        })
        self.assertEqual(result.status_code, 201)
        self.client.environ_base["HTTP_X_CSRF_TOKEN"] = result.json["csrf_token"]
        self.user_id = result.json["user"]["id"]

    def add_items(self, count):
        bought = (date.today() - timedelta(days=30)).isoformat()
        with self.app.app_context():
            get_db().executemany(
                "INSERT INTO items (user_id, name, category, purchase_date, purchase_cents) VALUES (?, ?, ?, ?, ?)",
                ((self.user_id, f"物品 {index}", "学习", bought, 10000) for index in range(count)),
            )
            get_db().commit()

    def traced_get(self, path):
        statements = []
        original_connect = sqlite3.connect

        def connect(*args, **kwargs):
            connection = original_connect(*args, **kwargs)
            connection.set_trace_callback(statements.append)
            return connection

        with patch("palm.database.sqlite3.connect", side_effect=connect):
            response = self.client.get(path)
        self.assertEqual(response.status_code, 200, response.json)
        reads = sum(sql.lstrip().upper().startswith(("SELECT", "WITH")) for sql in statements)
        return reads, response.json

    def test_importing_entrypoints_does_not_create_real_state(self):
        with tempfile.TemporaryDirectory() as isolated:
            destination = Path(isolated)
            shutil.copytree(ROOT / "palm", destination / "palm", ignore=shutil.ignore_patterns("__pycache__"))
            for filename in ("app.py", "journey.py", "seed_demo.py"):
                shutil.copy2(ROOT / filename, destination / filename)
            result = subprocess.run(
                [sys.executable, "-c", "import app, seed_demo; assert not __import__('pathlib').Path('instance').exists()"],
                cwd=destination, capture_output=True, text=True, timeout=15,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((destination / "instance").exists())

    def test_query_count_does_not_grow_per_item(self):
        self.add_items(2)
        before = {path: self.traced_get(path)[0] for path in ("/api/items", "/api/stats", "/api/insights")}
        self.add_items(98)
        after = {path: self.traced_get(path)[0] for path in before}
        self.assertEqual(before, after)
        self.assertLessEqual(after["/api/items"], 2)
        self.assertLessEqual(after["/api/stats"], 2)
        self.assertLessEqual(after["/api/insights"], 6)
        self.assertEqual(len(self.client.get("/api/items").json), 100)

    def test_aggregates_do_not_multiply_child_rows(self):
        self.add_items(1)
        item_id = self.client.get("/api/items").json[0]["id"]
        used_on = (date.today() - timedelta(days=2)).isoformat()
        for note in ("第一次", "第二次"):
            self.assertEqual(self.client.post(f"/api/items/{item_id}/usage", json={
                "used_on": used_on, "notes": note,
            }).status_code, 201)
        for amount in ("1.00", "2.00", "3.00"):
            self.assertEqual(self.client.post(f"/api/items/{item_id}/maintenance", json={
                "maintained_on": used_on, "cost": amount, "description": "维护",
            }).status_code, 201)
        self.assertEqual(self.client.post(f"/api/items/{item_id}/disposal", json={
            "disposed_on": date.today().isoformat(), "method": "sold", "proceeds": "0.50", "notes": "",
        }).status_code, 201)
        listed = self.client.get("/api/items").json[0]
        self.assertEqual((listed["usage_count"], listed["maintenance_total"], listed["net_cost"]),
                         (2, "6.00", "105.50"))
        stats = self.client.get("/api/stats").json
        self.assertEqual((stats["maintenance_total"], stats["net_cost_total"]), ("6.00", "105.50"))

    def test_failed_migration_rolls_back(self):
        with patch("palm.database.SCHEMA", "CREATE TABLE rollback_probe (id INTEGER); BROKEN STATEMENT;"):
            with self.assertRaisesRegex(RuntimeError, "数据库初始化或升级失败"):
                initialize_database(self.app)
        with closing(sqlite3.connect(self.database)) as connection:
            self.assertIsNone(connection.execute(
                "SELECT name FROM sqlite_master WHERE name = 'rollback_probe'"
            ).fetchone())
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 7)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM users").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()

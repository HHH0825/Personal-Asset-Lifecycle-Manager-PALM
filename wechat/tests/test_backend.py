"""Standalone mini program API and user isolation tests."""

import io
from contextlib import closing
from datetime import datetime, timedelta, timezone
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from PIL import Image

WECHAT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WECHAT_ROOT / "backend"))
from palm import create_app, initialize_app
from palm.database import get_db
from dev import create_dev_app


class MiniApiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="palm-wechat-test-")
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.app = initialize_app(create_app({
            "TESTING": True, "DATABASE": str(base / "db.sqlite3"),
            "PHOTO_DIR": str(base / "photos"),
            "WECHAT_CODE_EXCHANGER": lambda code: "openid-" + code,
        }))
        self.client = self.app.test_client()

    def token(self, name):
        response = self.client.post("/api/mp/auth/login", json={"code": name})
        self.assertEqual(response.status_code, 200)
        return response.json["token"]

    def headers(self, token):
        return {"Authorization": "Bearer " + token}

    def create_item(self, token, name="相机"):
        response = self.client.post("/api/mp/items", headers=self.headers(token), json={
            "name": name, "category": "数码设备", "icon_type": "digital",
            "purchase_date": "2025-01-01", "purchase_price": "1200.00",
            "status": "active", "notes": "课程项目",
        })
        self.assertEqual(response.status_code, 201, response.json)
        return response.json["id"]

    def test_login_token_logout_and_account_isolation(self):
        alice, bob = self.token("alice"), self.token("bob")
        self.assertNotEqual(alice, bob)
        item_id = self.create_item(alice)
        self.assertEqual(self.client.get("/api/mp/items", headers=self.headers(bob)).json, [])
        self.assertEqual(self.client.get(f"/api/mp/items/{item_id}", headers=self.headers(bob)).status_code, 404)
        self.assertEqual(self.client.get(f"/api/mp/items/{item_id}/photo", headers=self.headers(bob)).status_code, 404)
        self.assertEqual(self.client.get("/api/mp/stats", headers=self.headers(bob)).json["total_items"], 0)
        self.assertEqual(self.client.get("/api/mp/insights", headers=self.headers(bob)).json["analysis_cards"], [])
        self.assertEqual(self.client.post("/api/mp/auth/logout", headers=self.headers(alice)).status_code, 204)
        self.assertEqual(self.client.get("/api/mp/items", headers=self.headers(alice)).status_code, 401)
        renewed = self.token("alice")
        self.assertEqual(self.client.get("/api/mp/items", headers=self.headers(renewed)).json[0]["id"], item_id)

    def test_item_lifecycle_photo_and_trash(self):
        token = self.token("owner")
        headers = self.headers(token)
        item_id = self.create_item(token)
        # Represent an existing account's historical record, rather than using the retired API.
        with self.app.app_context():
            get_db().execute("INSERT INTO usage_records (item_id, used_on, notes) VALUES (?, ?, ?)",
                             (item_id, "2025-02-01", "拍照"))
            get_db().commit()
        repair = self.client.post(f"/api/mp/items/{item_id}/maintenance", headers=headers,
                                  json={"maintained_on": "2025-03-01", "cost": "100", "description": "清洁"})
        self.assertEqual(repair.status_code, 201)
        photo = Image.new("RGB", (4, 4), "#496251")
        stream = io.BytesIO()
        photo.save(stream, format="PNG")
        stream.seek(0)
        uploaded = self.client.post(f"/api/mp/items/{item_id}/photo", headers=headers,
                                    data={"photo": (stream, "photo.png")})
        self.assertEqual(uploaded.status_code, 200)
        outsider = self.token("outsider")
        self.assertEqual(self.client.get(f"/api/mp/items/{item_id}/photo", headers=self.headers(outsider)).status_code, 404)
        photo_response = self.client.get(f"/api/mp/items/{item_id}/photo", headers=headers)
        self.assertTrue(photo_response.data.startswith(b"\xff\xd8"))
        photo_response.close()
        detail = self.client.get(f"/api/mp/items/{item_id}", headers=headers).json
        self.assertEqual(detail["maintenance_total"], "100.00")
        self.assertEqual(detail["usage_count"], 1)
        disposal = self.client.post(f"/api/mp/items/{item_id}/disposal", headers=headers,
                                    json={"disposed_on": "2025-04-01", "method": "sold", "proceeds": "500"})
        self.assertEqual(disposal.status_code, 201)
        self.assertEqual(self.client.get(f"/api/mp/items/{item_id}", headers=headers).json["net_cost"], "800.00")
        self.assertEqual(self.client.delete(f"/api/mp/items/{item_id}", headers=headers).status_code, 204)
        self.assertEqual(self.client.get("/api/mp/items", headers=headers).json, [])
        self.assertEqual(self.client.put(f"/api/mp/maintenance/{repair.json['id']}", headers=headers,
                                         json={"maintained_on": "2025-03-02", "cost": "5", "description": "误改"}).status_code, 404)
        self.assertEqual(self.client.get(f"/api/mp/items/{item_id}/photo", headers=headers).status_code, 404)
        self.assertEqual(len(self.client.get("/api/mp/trash", headers=headers).json), 1)
        self.assertEqual(self.client.post(f"/api/mp/trash/{item_id}/restore", headers=headers).status_code, 200)
        self.assertEqual(self.client.delete(f"/api/mp/items/{item_id}", headers=headers).status_code, 204)
        self.assertEqual(self.client.delete(f"/api/mp/trash/{item_id}", headers=headers).status_code, 204)
        self.assertEqual(self.client.get(f"/api/mp/items/{item_id}", headers=headers).status_code, 404)

    def test_expired_trash_cannot_be_restored_and_is_excluded_from_analysis(self):
        token = self.token("expired")
        headers = self.headers(token)
        item_id = self.create_item(token)
        self.assertEqual(self.client.delete(f"/api/mp/items/{item_id}", headers=headers).status_code, 204)
        with self.app.app_context():
            get_db().execute("UPDATE items SET deleted_at = ? WHERE id = ?",
                             ((datetime.now(timezone.utc) - timedelta(days=31)).isoformat(timespec="seconds"), item_id))
            get_db().commit()
        self.assertEqual(self.client.post(f"/api/mp/trash/{item_id}/restore", headers=headers).status_code, 410)
        self.assertEqual(self.client.get("/api/mp/trash", headers=headers).json, [])
        self.assertEqual(self.client.get("/api/mp/stats", headers=headers).json["total_items"], 0)

    def test_local_debug_login_is_disabled_without_explicit_flag(self):
        local = initialize_app(create_app({"TESTING": True,
            "DATABASE": str(Path(self.temp.name) / "production.sqlite3"),
            "PHOTO_DIR": str(Path(self.temp.name) / "production-photos"),
            "DEV_LOGIN": False}))
        response = local.test_client().post("/api/mp/auth/login", json={"code": "dev:student"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json, {"error": "本地调试登录未开启，请使用本地开发启动入口"})

    def test_local_debug_login_requires_loopback(self):
        local = initialize_app(create_app({"TESTING": True,
            "DATABASE": str(Path(self.temp.name) / "local.sqlite3"),
            "PHOTO_DIR": str(Path(self.temp.name) / "local-photos"),
            "DEV_LOGIN": True}))
        self.assertEqual(local.test_client().post("/api/mp/auth/login",
                         json={"code": "dev:student"}).status_code, 200)
        response = local.test_client().post("/api/mp/auth/login",
                         json={"code": "dev:student"}, environ_base={"REMOTE_ADDR": "192.0.2.10"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json["error"], "本地调试登录仅允许电脑本机访问")

    def test_dev_entry_reuses_student_data_without_environment_flag(self):
        config = {"TESTING": True,
                  "DATABASE": str(Path(self.temp.name) / "dev.sqlite3"),
                  "PHOTO_DIR": str(Path(self.temp.name) / "dev-photos")}
        with patch.dict("os.environ", {"PALM_WECHAT_DEV_LOGIN": "0"}):
            local = initialize_app(create_dev_app(config))
        self.assertTrue(local.config["DEV_LOGIN"])
        client = local.test_client()
        session = client.post("/api/mp/auth/login", json={"code": "dev:student"})
        self.assertEqual(session.status_code, 200)
        headers = self.headers(session.json["token"])
        item = client.post("/api/mp/items", headers=headers, json={
            "name": "原有收藏", "category": "日常用品", "icon_type": "daily",
            "purchase_date": "2025-01-01", "purchase_price": "10.00", "status": "active"})
        self.assertEqual(item.status_code, 201)
        restarted = initialize_app(create_dev_app(config)).test_client()
        again = restarted.post("/api/mp/auth/login", json={"code": "dev:student"})
        self.assertEqual(again.status_code, 200)
        self.assertEqual(session.json["user"]["id"], again.json["user"]["id"])
        self.assertEqual(restarted.get("/api/mp/items", headers=self.headers(again.json["token"])).json[0]["id"], item.json["id"])

    def test_real_login_configuration_and_malformed_debug_code(self):
        config = {"TESTING": True, "DEV_LOGIN": False,
                  "WECHAT_APP_ID": "", "WECHAT_APP_SECRET": "",
                  "DATABASE": str(Path(self.temp.name) / "auth-errors.sqlite3"),
                  "PHOTO_DIR": str(Path(self.temp.name) / "auth-errors-photos")}
        client = initialize_app(create_app(config)).test_client()
        with patch("palm.routes_auth.urllib.request.urlopen") as exchange:
            response = client.post("/api/mp/auth/login", json={"code": "real-wechat-code"})
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json["error"], "服务器尚未配置微信登录")
            exchange.assert_not_called()
        debug = initialize_app(create_dev_app(config)).test_client()
        response = debug.post("/api/mp/auth/login", json={"code": "dev:bad name"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json["error"], "本地调试码格式应为 dev:名称")

    def test_invalid_login_and_profile(self):
        self.assertEqual(self.client.get("/api/mp/items").status_code, 401)
        self.assertEqual(self.client.post("/api/mp/auth/login", json={"code": ""}).status_code, 400)
        token = self.token("profile")
        profile = self.client.put("/api/mp/profile", headers=self.headers(token),
                                  json={"username": "小棕", "avatar_key": "sprout"})
        self.assertEqual(profile.status_code, 200)
        self.assertEqual(self.client.get("/api/mp/auth/me", headers=self.headers(token)).json["user"]["username"], "小棕")
        self.assertEqual(self.client.put("/api/mp/profile", headers=self.headers(token),
                                         json={"username": "", "avatar_key": "sprout"}).status_code, 400)

    def test_can_run_when_wechat_directory_is_copied_alone(self):
        with tempfile.TemporaryDirectory(prefix="palm-wechat-copy-") as isolated:
            target = Path(isolated) / "wechat"
            shutil.copytree(WECHAT_ROOT / "backend", target / "backend", ignore=shutil.ignore_patterns("__pycache__"))
            process = subprocess.run([sys.executable, "-c",
                "from palm import create_app, initialize_app; "
                "app=initialize_app(create_app()); "
                "assert app.test_client().get('/healthz').json == {'ok': True}"],
                cwd=target / "backend", capture_output=True, text=True, timeout=20)
            self.assertEqual(process.returncode, 0, process.stderr)
            self.assertTrue((target / "instance" / "palm.sqlite3").exists())
            with closing(sqlite3.connect(target / "instance" / "palm.sqlite3")) as db:
                self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 9)


if __name__ == "__main__":
    unittest.main()

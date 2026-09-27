"""Tests for the installer adapter and its data migration, using temp data only."""

import hashlib
import io
import os
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch


PACKAGE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_DIR))

import launcher
from migration import MigrationError, migrate_instance
from palm import create_app, initialize_app
from palm.database import get_db


def test_app(folder):
    return initialize_app(create_app({
        "TESTING": True,
        "DATABASE": str(folder / "palm.sqlite3"),
        "KEY_PATH": str(folder / "session.key"),
        "PHOTO_DIR": str(folder / "uploads" / "items"),
    }))


def register(app, username):
    client = app.test_client()
    token = client.get("/api/auth/me").json["csrf_token"]
    response = client.post("/api/auth/register", json={
        "username": username, "password": "installer-test-password",
    }, headers={"X-CSRF-Token": token})
    assert response.status_code == 201, response.json
    return client, response.json["user"]["id"]


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="palm-package-test-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.source = self.base / "旧版 instance"
        self.destination = self.base / "安装版 instance"
        self.app = test_app(self.source)
        client, user_id = register(self.app, "old_owner")
        self.client = client
        with self.app.app_context():
            get_db().execute(
                "INSERT INTO items (user_id, name, category, purchase_date, purchase_cents, photo_key) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (user_id, "旧相机", "数码设备", "2025-01-01", 10000, "photo.jpg"),
            )
            get_db().commit()
        photos = self.source / "uploads" / "items"
        photos.mkdir(parents=True)
        (photos / "photo.jpg").write_bytes(b"fixture photo")

    def test_installed_configuration_is_separate_from_source(self):
        with patch.dict(os.environ, {"PALM_PACKAGE_DATA_DIR": str(self.destination)}):
            app = launcher.configured_app()
            self.assertEqual(Path(app.config["DATABASE"]), self.destination / "palm.sqlite3")
            self.assertEqual(Path(app.config["KEY_PATH"]), self.destination / "session.key")
            self.assertEqual(Path(app.config["PHOTO_DIR"]), self.destination / "uploads" / "items")
            self.assertFalse(self.destination.exists())
        self.assertEqual(Path(create_app().config["DATABASE"]),
                         PACKAGE_DIR.parents[1] / "instance" / "palm.sqlite3")

    def test_default_installed_directory_uses_local_app_data(self):
        with patch.dict(os.environ, {
            "LOCALAPPDATA": str(self.base), "PALM_PACKAGE_DATA_DIR": "",
        }):
            self.assertEqual(launcher.instance_directory(), self.base / "PALM" / "instance")

    def test_migration_keeps_source_and_allows_original_login_and_photo(self):
        initial_hash = hashlib.sha256((self.source / "palm.sqlite3").read_bytes()).hexdigest()
        self.assertIsNone(migrate_instance(self.source, self.destination))
        self.assertEqual(initial_hash, hashlib.sha256(
            (self.source / "palm.sqlite3").read_bytes()).hexdigest())
        self.assertEqual((self.destination / "uploads" / "items" / "photo.jpg").read_bytes(), b"fixture photo")
        migrated = test_app(self.destination)
        client = migrated.test_client()
        token = client.get("/api/auth/me").json["csrf_token"]
        self.assertEqual(client.post("/api/auth/login", json={
            "username": "old_owner", "password": "installer-test-password",
        }, headers={"X-CSRF-Token": token}).status_code, 200)
        items = client.get("/api/items").json
        self.assertEqual([item["name"] for item in items], ["旧相机"])
        response = client.get(f"/api/items/{items[0]['id']}/photo")
        try:
            self.assertEqual(response.data, b"fixture photo")
        finally:
            response.close()

    def test_migration_backs_up_empty_installed_database(self):
        test_app(self.destination)
        backup = migrate_instance(self.source, self.destination)
        self.assertIsNotNone(backup)
        self.assertTrue((backup / "palm.sqlite3").exists())
        with closing(sqlite3.connect(self.destination / "palm.sqlite3")) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM users").fetchone()[0], 1)

    def test_migration_refuses_to_overwrite_existing_user(self):
        existing = test_app(self.destination)
        register(existing, "new_owner")
        old_hash = hashlib.sha256((self.destination / "palm.sqlite3").read_bytes()).hexdigest()
        with self.assertRaisesRegex(MigrationError, "已有用户数据"):
            migrate_instance(self.source, self.destination)
        self.assertEqual(old_hash, hashlib.sha256(
            (self.destination / "palm.sqlite3").read_bytes()).hexdigest())

    def test_missing_photo_or_key_cannot_replace_destination(self):
        (self.source / "uploads" / "items" / "photo.jpg").unlink()
        with self.assertRaisesRegex(MigrationError, "照片缺失"):
            migrate_instance(self.source, self.destination)
        self.assertFalse(self.destination.exists())
        (self.source / "session.key").unlink()
        with self.assertRaisesRegex(MigrationError, "session.key"):
            migrate_instance(self.source, self.destination)

    def test_old_schema_is_upgraded_only_in_copy(self):
        with closing(sqlite3.connect(self.source / "palm.sqlite3")) as db:
            db.execute("DROP INDEX idx_items_trash")
            db.execute("ALTER TABLE items DROP COLUMN deleted_at")
            db.execute("PRAGMA user_version = 7")
            db.commit()
        migrate_instance(self.source, self.destination)
        with closing(sqlite3.connect(self.source / "palm.sqlite3")) as old:
            self.assertEqual(old.execute("PRAGMA user_version").fetchone()[0], 7)
        with closing(sqlite3.connect(self.destination / "palm.sqlite3")) as new:
            self.assertEqual(new.execute("PRAGMA user_version").fetchone()[0], 8)
        self.assertTrue((self.destination / "palm.sqlite3.pre-trash.bak").exists())

    def test_cancel_does_not_create_data(self):
        with patch.object(launcher, "choose_source_folder", return_value=None), patch.dict(
            os.environ, {"PALM_PACKAGE_DATA_DIR": str(self.destination)},
        ):
            self.assertEqual(launcher.main(["--migrate"]), 0)
        self.assertFalse(self.destination.exists())

    def test_startup_with_redirected_western_code_page(self):
        with io.BytesIO() as output, io.BytesIO() as errors:
            with io.TextIOWrapper(output, encoding="cp1252") as stdout, \
                 io.TextIOWrapper(errors, encoding="cp1252") as stderr, \
                 patch.object(sys, "stdout", stdout), patch.object(sys, "stderr", stderr), \
                 patch.object(launcher, "make_server") as make_server, \
                 patch.dict(os.environ, {"PALM_PACKAGE_DATA_DIR": str(self.destination)}):
                self.assertEqual(launcher.main(["--no-browser"]), 0)
                make_server.return_value.serve_forever.assert_called_once()
                make_server.return_value.server_close.assert_called_once()
                stdout.flush()
                self.assertIn("PALM 本地访问地址", output.getvalue().decode("utf-8"))
                self.assertIn("Ctrl+C", output.getvalue().decode("utf-8"))

    def test_migration_error_with_redirected_western_code_page(self):
        with io.BytesIO() as output, io.BytesIO() as errors:
            with io.TextIOWrapper(output, encoding="cp1252") as stdout, \
                 io.TextIOWrapper(errors, encoding="cp1252") as stderr, \
                 patch.object(sys, "stdout", stdout), patch.object(sys, "stderr", stderr), \
                 patch.object(launcher, "migrate_instance", side_effect=MigrationError("旧数据校验失败")), \
                 patch.dict(os.environ, {"PALM_PACKAGE_DATA_DIR": str(self.destination)}):
                self.assertEqual(launcher.main(["--migrate-from", str(self.source)]), 1)
                stderr.flush()
                self.assertIn("操作失败：旧数据校验失败", errors.getvalue().decode("utf-8"))

    def test_port_conflict_does_not_open_browser_or_write_data(self):
        with patch.object(launcher, "make_server", side_effect=OSError("occupied")), \
             patch.object(launcher.webbrowser, "open") as open_browser, \
             patch.dict(os.environ, {"PALM_PACKAGE_DATA_DIR": str(self.destination)}):
            self.assertEqual(launcher.run_service(), 1)
        open_browser.assert_not_called()
        self.assertFalse(self.destination.exists())

    def test_browser_opens_after_server_and_data_are_ready(self):
        events = []

        class Server:
            def serve_forever(self):
                events.append("serve")

            def server_close(self):
                events.append("close")

        def ready(app):
            events.append("initialize")
            return app

        with patch.object(launcher, "make_server", side_effect=lambda *_args, **_kwargs: (
            events.append("bind") or Server()
        )), patch.object(launcher, "initialize_app", side_effect=ready), \
             patch.object(launcher.webbrowser, "open", side_effect=lambda *_args, **_kwargs: (
                 events.append("browser") or True
             )), patch.dict(os.environ, {"PALM_PACKAGE_DATA_DIR": str(self.destination)}):
            self.assertEqual(launcher.run_service(), 0)
        self.assertEqual(events, ["bind", "initialize", "browser", "serve", "close"])


if __name__ == "__main__":
    unittest.main()

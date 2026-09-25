import os
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path
from flask import current_app, g
from .schema import SCHEMA


def get_db():
    if "db" not in g:
        connection = sqlite3.connect(current_app.config["DATABASE"])
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        g.db = connection
    return g.db


def close_db(_error=None):
    connection = g.pop("db", None)
    if connection:
        connection.close()


def initialize_database(app):
    Path(app.config["DATABASE"]).parent.mkdir(parents=True, exist_ok=True)
    try:
        with app.app_context():
            database_path = Path(app.config["DATABASE"])
            if database_path.exists():
                with closing(sqlite3.connect(database_path)) as source:
                    old_table = source.execute(
                        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='items'"
                    ).fetchone()
                    old_columns = [r[1] for r in source.execute("PRAGMA table_info(items)")] if old_table else []
                    old_user_table = source.execute(
                        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'"
                    ).fetchone()
                    old_user_columns = [r[1] for r in source.execute("PRAGMA table_info(users)")] if old_user_table else []
                    for needed, suffix in (
                        (bool(old_table) and "user_id" not in old_columns, ".pre-accounts.bak"),
                        (bool(old_table) and "icon_type" not in old_columns, ".pre-icons.bak"),
                        (bool(old_table) and "daily_target_cents" not in old_columns, ".pre-goals.bak"),
                        (bool(old_user_table) and ("avatar_key" not in old_user_columns or "auth_version" not in old_user_columns), ".pre-profile.bak"),
                        (bool(old_table) and "warranty_expires_on" not in old_columns, ".pre-warranty.bak"),
                        (bool(old_table) and ("photo_key" not in old_columns or "is_pinned" not in old_columns), ".pre-photos-pins.bak"),
                    ):
                        if not needed:
                            continue
                        backup_path = database_path.with_name(database_path.name + suffix)
                        if not backup_path.exists():
                            descriptor, temporary_name = tempfile.mkstemp(
                                prefix="palm-backup-", suffix=".tmp", dir=database_path.parent
                            )
                            os.close(descriptor)
                            try:
                                with closing(sqlite3.connect(temporary_name)) as target:
                                    source.backup(target)
                                if not backup_path.exists():
                                    os.replace(temporary_name, backup_path)
                                else:
                                    Path(temporary_name).unlink()
                            except Exception:
                                Path(temporary_name).unlink(missing_ok=True)
                                raise
            connection = get_db()
            connection.execute("BEGIN IMMEDIATE")
            # executescript commits any pending transaction first, so run schema
            # statements individually to keep creation and migration atomic.
            for statement in SCHEMA.split(";"):
                statement = statement.strip()
                if statement and statement != "PRAGMA foreign_keys = ON":
                    connection.execute(statement)
            columns = [r[1] for r in get_db().execute("PRAGMA table_info(items)")]
            if "user_id" not in columns:
                get_db().execute("ALTER TABLE items ADD COLUMN user_id INTEGER REFERENCES users(id)")
            if "icon_type" not in columns:
                get_db().execute("ALTER TABLE items ADD COLUMN icon_type TEXT NOT NULL DEFAULT 'other'")
                get_db().execute("UPDATE items SET icon_type = CASE category "
                             "WHEN '数码设备' THEN 'digital' WHEN '日常用品' THEN 'daily' "
                             "WHEN '出行用品' THEN 'mobility' ELSE 'other' END")
            if "daily_target_cents" not in columns:
                get_db().execute("ALTER TABLE items ADD COLUMN daily_target_cents INTEGER CHECK (daily_target_cents > 0)")
            user_columns = [r[1] for r in get_db().execute("PRAGMA table_info(users)")]
            if "avatar_key" not in user_columns:
                get_db().execute("ALTER TABLE users ADD COLUMN avatar_key TEXT")
            if "auth_version" not in user_columns:
                get_db().execute("ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0")
            if "warranty_expires_on" not in columns:
                get_db().execute("ALTER TABLE items ADD COLUMN warranty_expires_on TEXT")
            if "photo_key" not in columns:
                get_db().execute("ALTER TABLE items ADD COLUMN photo_key TEXT")
            if "is_pinned" not in columns:
                get_db().execute("ALTER TABLE items ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1))")
            get_db().execute("CREATE INDEX IF NOT EXISTS idx_items_user ON items(user_id)")
            get_db().execute("PRAGMA user_version = 7")
            get_db().commit()
    except Exception as exc:
        raise RuntimeError("数据库初始化或升级失败，请检查原数据库与升级前备份") from exc

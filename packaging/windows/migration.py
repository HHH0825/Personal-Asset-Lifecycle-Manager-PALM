"""Copy a stopped source instance into a separate installed instance safely."""

import os
import shutil
import sqlite3
import tempfile
from contextlib import closing
from datetime import datetime
from pathlib import Path
from uuid import uuid4


class MigrationError(Exception):
    pass


def choose_source_folder():
    """Use the Windows folder picker; leave selection unchanged on cancel."""
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        try:
            selected = filedialog.askdirectory(parent=root, title="选择旧版 PALM 的 instance 文件夹")
        finally:
            root.destroy()
    except Exception as exc:
        raise MigrationError("无法打开文件夹选择器，请使用 --migrate-from 指定旧目录") from exc
    return Path(selected) if selected else None


def _check_database(path):
    try:
        with closing(sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)) as db:
            if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise MigrationError("数据库完整性检查未通过")
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if "items" not in tables:
                raise MigrationError("所选目录不是 PALM 的 instance：数据库缺少物品表")
            if db.execute("PRAGMA user_version").fetchone()[0] > 8:
                raise MigrationError("旧数据库版本高于当前安装版，请使用更新的安装包")
            references = set()
            columns = {row[1] for row in db.execute("PRAGMA table_info(items)")}
            if "photo_key" in columns:
                references = {row[0] for row in db.execute(
                    "SELECT photo_key FROM items WHERE photo_key IS NOT NULL"
                )}
            return tables, references
    except sqlite3.DatabaseError as exc:
        raise MigrationError(f"无法读取数据库：{exc}") from exc


def _fresh_destination(destination):
    if not destination.exists():
        return True
    if not destination.is_dir():
        return False
    if not any(destination.iterdir()):
        return True
    database = destination / "palm.sqlite3"
    if not database.is_file():
        return False
    try:
        with closing(sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True)) as db:
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            for table in ("users", "items", "usage_records", "maintenance_records",
                          "disposal_records", "trash_expired"):
                if table in tables and db.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone():
                    return False
            photo_dir = destination / "uploads" / "items"
            if photo_dir.exists() and any(photo_dir.iterdir()):
                return False
            return True
    except (sqlite3.DatabaseError, OSError):
        return False


def _copy_photo_files(source, destination, references):
    photos = source / "uploads" / "items"
    if not photos.exists():
        if references:
            raise MigrationError("数据库引用了照片，但旧版照片目录不存在")
        return
    if not photos.is_dir() or photos.is_symlink():
        raise MigrationError("旧版照片目录无效")
    files = list(photos.iterdir())
    for item in files:
        if not item.is_file() or item.is_symlink():
            raise MigrationError(f"照片目录含有不支持的文件：{item.name}")
    names = {item.name for item in files}
    missing = references - names
    if missing:
        raise MigrationError(f"旧版照片缺失：{', '.join(sorted(missing)[:3])}")
    target = destination / "uploads" / "items"
    target.mkdir(parents=True, exist_ok=True)
    for item in files:
        shutil.copy2(item, target / item.name)


def migrate_instance(source, destination):
    """Stage, validate and swap without ever changing the selected source.

    Returns the backup path of a pre-existing empty installed instance, or None.
    """
    try:
        source = Path(source).expanduser().resolve(strict=True)
    except OSError as exc:
        raise MigrationError(f"旧目录不存在：{exc}") from exc
    destination = Path(destination).expanduser().resolve()
    if source == destination or source in destination.parents or destination in source.parents:
        raise MigrationError("旧目录与安装版数据目录不能相同或互相包含")
    if not source.is_dir():
        raise MigrationError("请选择旧版的 instance 文件夹")
    database = source / "palm.sqlite3"
    key = source / "session.key"
    if not database.is_file() or not key.is_file():
        raise MigrationError("旧目录必须包含 palm.sqlite3 和 session.key")
    if database.is_symlink() or key.is_symlink():
        raise MigrationError("不支持迁移符号链接文件")
    if not key.read_text(encoding="ascii").strip():
        raise MigrationError("旧版 session.key 为空")
    _, references = _check_database(database)
    if not _fresh_destination(destination):
        raise MigrationError("安装版已有用户数据；为避免覆盖，请先自行备份并处理该数据")

    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix="palm-import-", dir=destination.parent))
    backup = None
    try:
        with closing(sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True)) as original:
            with closing(sqlite3.connect(staging / "palm.sqlite3")) as copied:
                original.backup(copied)
        shutil.copy2(key, staging / "session.key")
        _copy_photo_files(source, staging, references)
        _check_database(staging / "palm.sqlite3")

        # Exercise the same upgrade path used on launch, but only on the staged copy.
        from palm import create_app, initialize_app
        initialize_app(create_app({
            "DATABASE": str(staging / "palm.sqlite3"),
            "KEY_PATH": str(staging / "session.key"),
            "PHOTO_DIR": str(staging / "uploads" / "items"),
        }))
        _check_database(staging / "palm.sqlite3")
        if not _fresh_destination(destination):
            raise MigrationError("迁移期间安装版出现新数据，已取消替换，请关闭程序后重试")

        if destination.exists():
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            backup = destination.with_name(f"{destination.name}.pre-import-{stamp}-{uuid4().hex[:8]}")
            os.replace(destination, backup)
        try:
            os.replace(staging, destination)
        except Exception:
            if backup is not None and not destination.exists():
                os.replace(backup, destination)
            raise
        return backup
    except MigrationError:
        raise
    except (OSError, sqlite3.DatabaseError, RuntimeError, UnicodeError) as exc:
        raise MigrationError(f"迁移未完成：{exc}") from exc
    finally:
        if staging.exists():
            shutil.rmtree(staging)

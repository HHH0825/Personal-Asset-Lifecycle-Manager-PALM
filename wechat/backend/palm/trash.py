"""Thirty-day trash, including photo cleanup after committed deletes."""

from datetime import datetime, timedelta, timezone
from flask import abort, current_app, g
from .database import get_db
from .photo import remove_photo_file


def utc_now():
    return datetime.now(timezone.utc)


def expiry(deleted_at):
    return datetime.fromisoformat(deleted_at) + timedelta(days=30)


def purge_expired(now=None):
    cutoff = ((now or utc_now()) - timedelta(days=30)).isoformat(timespec="seconds")
    connection = get_db()
    connection.execute("BEGIN IMMEDIATE")
    try:
        rows = connection.execute(
            "SELECT id, user_id, photo_key, deleted_at FROM items "
            "WHERE deleted_at IS NOT NULL AND deleted_at <= ?", (cutoff,)
        ).fetchall()
        for row in rows:
            connection.execute(
                "INSERT OR IGNORE INTO trash_expired (item_id, user_id, expired_at) VALUES (?, ?, ?)",
                (row["id"], row["user_id"], expiry(row["deleted_at"]).isoformat(timespec="seconds")),
            )
            connection.execute("DELETE FROM items WHERE id = ?", (row["id"],))
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    for row in rows:
        remove_photo_file(row["photo_key"])
    return len(rows)


def list_trash():
    purge_expired()
    rows = get_db().execute(
        "SELECT id, name, category, icon_type, status, deleted_at FROM items "
        "WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC, id DESC", (g.user_id,)
    ).fetchall()
    return [{**dict(row), "expires_at": expiry(row["deleted_at"]).isoformat(timespec="seconds")}
            for row in rows]


def trash_row(item_id):
    row = get_db().execute(
        "SELECT * FROM items WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL",
        (item_id, g.user_id),
    ).fetchone()
    if row:
        return row
    expired = get_db().execute(
        "SELECT 1 FROM trash_expired WHERE item_id = ? AND user_id = ?", (item_id, g.user_id)
    ).fetchone()
    if expired:
        abort(410, description="物品已超过 30 天保留期限")
    abort(404)


def restore_item(item_id):
    row = trash_row(item_id)
    if expiry(row["deleted_at"]) <= utc_now():
        purge_expired()
        abort(410, description="物品已超过 30 天保留期限")
    get_db().execute("UPDATE items SET deleted_at = NULL WHERE id = ? AND user_id = ?", (item_id, g.user_id))
    get_db().commit()


def permanently_delete(item_id):
    row = trash_row(item_id)
    connection = get_db()
    connection.execute("DELETE FROM items WHERE id = ? AND user_id = ?", (item_id, g.user_id))
    connection.commit()
    remove_photo_file(row["photo_key"])

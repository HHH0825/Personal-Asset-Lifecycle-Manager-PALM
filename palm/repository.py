from flask import abort, g
from .database import get_db


def user_by_id(user_id):
    return get_db().execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone() if user_id else None


def user_by_key(username_key):
    return get_db().execute("SELECT * FROM users WHERE username_key = ?", (username_key,)).fetchone()


def register_user(username, password_hash):
    connection = get_db()
    connection.execute("BEGIN IMMEDIATE")
    try:
        first_user = connection.execute("SELECT NOT EXISTS (SELECT 1 FROM users)").fetchone()[0]
        cursor = connection.execute(
            "INSERT INTO users (username, username_key, password_hash) VALUES (?, ?, ?)",
            (username, username.casefold(), password_hash),
        )
        if first_user:
            connection.execute("UPDATE items SET user_id = ? WHERE user_id IS NULL", (cursor.lastrowid,))
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return user_by_id(cursor.lastrowid)


def update_username(user_id, username):
    connection = get_db()
    try:
        connection.execute("UPDATE users SET username = ?, username_key = ? WHERE id = ?",
                           (username, username.casefold(), user_id))
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return user_by_id(user_id)


def update_password(user_id, password_hash):
    connection = get_db()
    connection.execute("UPDATE users SET password_hash = ?, auth_version = auth_version + 1 WHERE id = ?",
                       (password_hash, user_id))
    connection.commit()


def update_avatar(user_id, avatar):
    connection = get_db()
    connection.execute("UPDATE users SET avatar_key = ? WHERE id = ?", (avatar, user_id))
    connection.commit()
    return user_by_id(user_id)


def list_item_rows(user_id, query=None, today=None, item_id=None):
    """Fetch owned items and one aggregate row per child table, without row multiplication."""
    from datetime import date

    pattern = None
    if query is not None:
        escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
    return get_db().execute(
        """WITH repairs AS (
             SELECT record.item_id, SUM(record.cost_cents) AS maintenance_cents
             FROM maintenance_records AS record
             JOIN items AS owner ON owner.id = record.item_id
             WHERE owner.user_id = :owner GROUP BY record.item_id
           ), uses AS (
             SELECT record.item_id, COUNT(*) AS usage_count,
                    MAX(record.used_on) AS last_used_on,
                    MAX(CASE WHEN record.used_on = :today THEN 1 ELSE 0 END) AS used_today
             FROM usage_records AS record
             JOIN items AS owner ON owner.id = record.item_id
             WHERE owner.user_id = :owner GROUP BY record.item_id
           )
           SELECT item.*, COALESCE(repairs.maintenance_cents, 0) AS maintenance_cents,
                  COALESCE(uses.usage_count, 0) AS usage_count,
                  uses.last_used_on, COALESCE(uses.used_today, 0) AS used_today,
                  disposal.id AS disposal_id, disposal.disposed_on,
                  disposal.method AS disposal_method, disposal.proceeds_cents,
                  disposal.notes AS disposal_notes
           FROM items AS item
           LEFT JOIN repairs ON repairs.item_id = item.id
           LEFT JOIN uses ON uses.item_id = item.id
           LEFT JOIN disposal_records AS disposal ON disposal.item_id = item.id
           WHERE item.user_id = :owner
             AND (:item_id IS NULL OR item.id = :item_id)
             AND (:pattern IS NULL OR item.name LIKE :pattern ESCAPE '\\'
                  OR item.category LIKE :pattern ESCAPE '\\')
           ORDER BY item.id DESC""",
        {"owner": user_id, "today": today or date.today().isoformat(),
         "item_id": item_id, "pattern": pattern},
    ).fetchall()


def item_summary(item_id, user_id, today=None):
    rows = list_item_rows(user_id, today=today, item_id=item_id)
    if not rows:
        abort(404)
    return rows[0]


def usage_rows(item_id):
    return get_db().execute(
        "SELECT * FROM usage_records WHERE item_id = ? ORDER BY used_on DESC, id DESC", (item_id,)
    ).fetchall()


def maintenance_rows(item_id):
    return get_db().execute(
        "SELECT * FROM maintenance_records WHERE item_id = ? ORDER BY maintained_on DESC, id DESC", (item_id,)
    ).fetchall()


def event_row(table, record_id, user_id):
    return get_db().execute(
        f"SELECT record.* FROM {table} AS record JOIN items AS item ON item.id = record.item_id "
        "WHERE record.id = ? AND item.user_id = ?", (record_id, user_id)
    ).fetchone()


def monthly_totals(user_id, first_month):
    totals = {}
    for table, date_column, amount_column, key in (
        ("items", "purchase_date", "purchase_cents", "purchase"),
        ("maintenance_records", "maintained_on", "cost_cents", "maintenance"),
        ("disposal_records", "disposed_on", "proceeds_cents", "proceeds"),
    ):
        source = "items AS event" if table == "items" else f"{table} AS event JOIN items AS owner ON owner.id = event.item_id"
        owner_column = "event.user_id" if table == "items" else "owner.user_id"
        rows = get_db().execute(
            f"SELECT substr(event.{date_column}, 1, 7) AS month, SUM(event.{amount_column}) AS total "
            f"FROM {source} WHERE {owner_column} = ? AND event.{date_column} >= ? "
            f"GROUP BY substr(event.{date_column}, 1, 7)",
            (user_id, first_month + "-01"),
        )
        totals[key] = {row["month"]: row["total"] for row in rows}
    return totals


def repair_totals(user_id):
    return get_db().execute(
        "SELECT item.id, item.name, item.icon_type, SUM(record.cost_cents) AS total "
        "FROM maintenance_records AS record JOIN items AS item ON item.id = record.item_id "
        "WHERE item.user_id = ? GROUP BY item.id ORDER BY total DESC, item.id ASC", (user_id,)
    ).fetchall()


def create_item(user_id, name, category, icon_type, purchased, warranty, price, notes, status):
    cursor = get_db().execute(
        "INSERT INTO items (user_id, name, category, icon_type, purchase_date, warranty_expires_on, "
        "purchase_cents, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (user_id, name, category, icon_type, purchased, warranty, price, notes, status),
    )
    get_db().commit()
    return cursor.lastrowid


def update_item(item_id, user_id, name, category, icon_type, purchased, warranty, price, notes, status):
    get_db().execute(
        "UPDATE items SET name=?, category=?, icon_type=?, purchase_date=?, warranty_expires_on=?, "
        "purchase_cents=?, notes=?, status=? WHERE id=? AND user_id=?",
        (name, category, icon_type, purchased, warranty, price, notes, status, item_id, user_id),
    )
    get_db().commit()


def delete_item(item_id):
    connection = get_db()
    connection.execute("BEGIN IMMEDIATE")
    try:
        row = item_row(item_id)
        connection.execute("DELETE FROM items WHERE id = ?", (item_id,))
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return row["photo_key"]


def set_item_target(item_id, user_id, amount):
    get_db().execute("UPDATE items SET daily_target_cents = ? WHERE id = ? AND user_id = ?", (amount, item_id, user_id))
    get_db().commit()


def set_item_pin(item_id, user_id, is_pinned):
    get_db().execute("UPDATE items SET is_pinned = ? WHERE id = ? AND user_id = ?",
                     (int(is_pinned), item_id, user_id))
    get_db().commit()


def swap_photo_key(item_id, new_key):
    connection = get_db()
    connection.execute("BEGIN IMMEDIATE")
    try:
        row = item_row(item_id)
        connection.execute("UPDATE items SET photo_key = ? WHERE id = ?", (new_key, item_id))
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return row["photo_key"]


def event_boundary(item_id, table, column, function):
    assert (table, column) in {
        ("usage_records", "used_on"), ("maintenance_records", "maintained_on"),
        ("disposal_records", "disposed_on"),
    }
    assert function in ("MIN", "MAX")
    return get_db().execute(f"SELECT {function}({column}) FROM {table} WHERE item_id = ?", (item_id,)).fetchone()[0]


def disposal_by_item(item_id):
    return get_db().execute("SELECT * FROM disposal_records WHERE item_id = ?", (item_id,)).fetchone()


def create_event(item_id, kind, fields):
    assert kind in ("usage", "maintenance")
    table = f"{kind}_records"
    columns = ", ".join(["item_id", *fields])
    placeholders = ", ".join("?" for _ in range(len(fields) + 1))
    cursor = get_db().execute(f"INSERT INTO {table} ({columns}) VALUES ({placeholders})",
                              (item_id, *fields.values()))
    get_db().commit()
    return cursor.lastrowid


def update_event(kind, record_id, fields):
    assert kind in ("usage", "maintenance")
    table = f"{kind}_records"
    assignments = ", ".join(f"{column} = ?" for column in fields)
    get_db().execute(f"UPDATE {table} SET {assignments} WHERE id = ?", (*fields.values(), record_id))
    get_db().commit()


def delete_event(kind, record_id):
    assert kind in ("usage", "maintenance")
    get_db().execute(f"DELETE FROM {kind}_records WHERE id = ?", (record_id,))
    get_db().commit()


def quick_use_today(item_id, today):
    connection = get_db()
    connection.execute("BEGIN IMMEDIATE")
    try:
        item = item_row(item_id)
        if item["status"] == "disposed":
            from .validation import InputError
            raise InputError("已处置物品不能记录使用")
        record = connection.execute(
            "SELECT * FROM usage_records WHERE item_id = ? AND used_on = ? ORDER BY id DESC LIMIT 1",
            (item_id, today),
        ).fetchone()
        created = record is None
        if created:
            cursor = connection.execute(
                "INSERT INTO usage_records (item_id, used_on, notes) VALUES (?, ?, '')", (item_id, today)
            )
            record = connection.execute("SELECT * FROM usage_records WHERE id = ?", (cursor.lastrowid,)).fetchone()
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return record, created


def create_disposal(item_id, fields):
    columns = ", ".join(["item_id", *fields])
    placeholders = ", ".join("?" for _ in range(len(fields) + 1))
    connection = get_db()
    connection.execute("BEGIN")
    try:
        connection.execute(f"INSERT INTO disposal_records ({columns}) VALUES ({placeholders})",
                           (item_id, *fields.values()))
        connection.execute("UPDATE items SET status = 'disposed' WHERE id = ?", (item_id,))
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return disposal_by_item(item_id)


def update_disposal(record_id, fields):
    assignments = ", ".join(f"{column} = ?" for column in fields)
    get_db().execute(f"UPDATE disposal_records SET {assignments} WHERE id = ?", (*fields.values(), record_id))
    get_db().commit()


def delete_disposal(record_id, item_id):
    connection = get_db()
    connection.execute("BEGIN")
    try:
        connection.execute("DELETE FROM disposal_records WHERE id = ?", (record_id,))
        connection.execute("UPDATE items SET status = 'idle' WHERE id = ?", (item_id,))
        connection.commit()
    except Exception:
        connection.rollback()
        raise

def item_row(item_id):
    row = get_db().execute("SELECT * FROM items WHERE id = ? AND user_id = ?", (item_id, g.user_id)).fetchone()
    if not row:
        from flask import abort
        abort(404)
    return row

def record_row(table, record_id):
    row = event_row(table, record_id, g.user_id)
    if not row:
        from flask import abort
        abort(404)
    return row

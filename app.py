"""PALM: a small, local personal asset lifecycle manager."""

from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
import sqlite3

from flask import Flask, g, jsonify, render_template, request


SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    purchase_date TEXT NOT NULL,
    purchase_cents INTEGER NOT NULL CHECK (purchase_cents >= 0),
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'idle', 'disposed')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS usage_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    used_on TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS maintenance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    maintained_on TEXT NOT NULL,
    cost_cents INTEGER NOT NULL CHECK (cost_cents >= 0),
    description TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS disposal_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
    disposed_on TEXT NOT NULL,
    method TEXT NOT NULL CHECK (method IN ('sold', 'gifted', 'discarded', 'other')),
    proceeds_cents INTEGER NOT NULL CHECK (proceeds_cents >= 0),
    notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
CREATE INDEX IF NOT EXISTS idx_usage_item ON usage_records(item_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_item ON maintenance_records(item_id);
"""


class InputError(Exception):
    pass


def create_app(test_config=None):
    app = Flask(__name__, instance_relative_config=True)
    app.config.from_mapping(DATABASE=str(Path(app.instance_path) / "palm.sqlite3"))
    if test_config:
        app.config.update(test_config)
    Path(app.config["DATABASE"]).parent.mkdir(parents=True, exist_ok=True)

    def db():
        if "db" not in g:
            g.db = sqlite3.connect(app.config["DATABASE"])
            g.db.row_factory = sqlite3.Row
            g.db.execute("PRAGMA foreign_keys = ON")
        return g.db

    @app.teardown_appcontext
    def close_db(_error):
        connection = g.pop("db", None)
        if connection:
            connection.close()

    with app.app_context():
        db().executescript(SCHEMA)
        db().commit()

    @app.errorhandler(InputError)
    def input_error(error):
        return jsonify(error=str(error)), 400

    @app.errorhandler(404)
    def not_found(_error):
        return jsonify(error="记录不存在"), 404

    def body():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            raise InputError("请提交 JSON 对象")
        return data

    def value(data, key, label, max_length=120, required=True):
        raw = data.get(key, "")
        if not isinstance(raw, str):
            raise InputError(f"{label}格式不正确")
        result = raw.strip()
        if required and not result:
            raise InputError(f"请填写{label}")
        if len(result) > max_length:
            raise InputError(f"{label}不能超过 {max_length} 字")
        return result

    def date_value(data, key, label):
        raw = value(data, key, label, 10)
        try:
            parsed = date.fromisoformat(raw)
        except ValueError as exc:
            raise InputError(f"{label}必须是有效日期") from exc
        if parsed.isoformat() != raw or parsed > date.today():
            raise InputError(f"{label}必须是不晚于今天的有效日期")
        return raw

    def cents_value(data, key, label):
        raw = data.get(key)
        if isinstance(raw, bool) or raw is None:
            raise InputError(f"请填写{label}")
        try:
            number = Decimal(str(raw))
        except (InvalidOperation, ValueError) as exc:
            raise InputError(f"{label}必须是非负金额") from exc
        if not number.is_finite() or number < 0 or number > 999999999 or number.as_tuple().exponent < -2:
            raise InputError(f"{label}必须是非负金额，最多两位小数")
        return int(number * 100)

    def money(cents):
        return f"{cents / 100:.2f}"

    def daily_cost(cents, days):
        if days == 0:
            return None
        return str((Decimal(cents) / (Decimal(days) * 100)).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP))

    def item_row(item_id):
        row = db().execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
        if not row:
            from flask import abort
            abort(404)
        return row

    def record_row(table, record_id):
        row = db().execute(f"SELECT * FROM {table} WHERE id = ?", (record_id,)).fetchone()
        if not row:
            from flask import abort
            abort(404)
        return row

    def item_payload(row, details=False):
        item_id = row["id"]
        maintenance_cents = db().execute(
            "SELECT COALESCE(SUM(cost_cents), 0) FROM maintenance_records WHERE item_id = ?", (item_id,)
        ).fetchone()[0]
        usage_summary = db().execute(
            "SELECT COUNT(*) AS count, MAX(used_on) AS last_used_on FROM usage_records WHERE item_id = ?", (item_id,)
        ).fetchone()
        disposal = db().execute("SELECT * FROM disposal_records WHERE item_id = ?", (item_id,)).fetchone()
        end = date.fromisoformat(disposal["disposed_on"]) if disposal else date.today()
        holding_days = (end - date.fromisoformat(row["purchase_date"])).days
        net_cents = row["purchase_cents"] + maintenance_cents - (disposal["proceeds_cents"] if disposal else 0)
        result = {
            "id": item_id, "name": row["name"], "category": row["category"],
            "purchase_date": row["purchase_date"], "purchase_price": money(row["purchase_cents"]),
            "notes": row["notes"], "status": row["status"],
            "maintenance_total": money(maintenance_cents), "usage_count": usage_summary["count"],
            "last_recorded_use": usage_summary["last_used_on"],
            "disposal_proceeds": money(disposal["proceeds_cents"] if disposal else 0),
            "net_cost": money(net_cents),
            "holding_days": holding_days,
            "daily_purchase_cost": daily_cost(row["purchase_cents"], holding_days),
            "daily_net_cost": daily_cost(net_cents, holding_days),
        }
        if details:
            result["usage_records"] = [dict(r) for r in db().execute(
                "SELECT * FROM usage_records WHERE item_id = ? ORDER BY used_on DESC, id DESC", (item_id,)
            )]
            result["maintenance_records"] = [
                {"id": r["id"], "item_id": item_id, "maintained_on": r["maintained_on"],
                 "cost": money(r["cost_cents"]), "description": r["description"]}
                for r in db().execute(
                    "SELECT * FROM maintenance_records WHERE item_id = ? ORDER BY maintained_on DESC, id DESC", (item_id,)
                )
            ]
            result["disposal"] = ({"id": disposal["id"], "item_id": item_id,
                "disposed_on": disposal["disposed_on"], "method": disposal["method"],
                "proceeds": money(disposal["proceeds_cents"]), "notes": disposal["notes"]} if disposal else None)
        return result

    def ensure_event_date(item, event_date):
        if event_date < item["purchase_date"]:
            raise InputError("记录日期不能早于购买日期")
        disposal = db().execute("SELECT disposed_on FROM disposal_records WHERE item_id = ?", (item["id"],)).fetchone()
        if disposal and event_date > disposal["disposed_on"]:
            raise InputError("记录日期不能晚于处置日期")

    def ensure_purchase_date(item_id, purchase_date):
        for table, column in (("usage_records", "used_on"), ("maintenance_records", "maintained_on"), ("disposal_records", "disposed_on")):
            row = db().execute(f"SELECT MIN({column}) FROM {table} WHERE item_id = ?", (item_id,)).fetchone()
            if row[0] and purchase_date > row[0]:
                raise InputError("购买日期不能晚于已有生命周期记录")

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.route("/api/items", methods=["GET", "POST"])
    def items():
        if request.method == "GET":
            query = request.args.get("q", "").strip()[:120]
            rows = db().execute(
                "SELECT * FROM items WHERE name LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\' ORDER BY id DESC",
                tuple("%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%" for _ in range(2))
            ).fetchall()
            return jsonify([item_payload(row) for row in rows])
        data = body()
        name = value(data, "name", "物品名称")
        category = value(data, "category", "分类", 60)
        purchased = date_value(data, "purchase_date", "购买日期")
        price = cents_value(data, "purchase_price", "购买价格")
        notes = value(data, "notes", "备注", 1000, False)
        status = data.get("status", "active")
        if status not in ("active", "idle"):
            raise InputError("新物品状态只能是使用中或闲置")
        cur = db().execute(
            "INSERT INTO items (name, category, purchase_date, purchase_cents, notes, status) VALUES (?, ?, ?, ?, ?, ?)",
            (name, category, purchased, price, notes, status)
        )
        db().commit()
        return jsonify(item_payload(item_row(cur.lastrowid), True)), 201

    @app.route("/api/items/<int:item_id>", methods=["GET", "PUT", "DELETE"])
    def item_detail(item_id):
        row = item_row(item_id)
        if request.method == "GET":
            return jsonify(item_payload(row, True))
        if request.method == "DELETE":
            db().execute("DELETE FROM items WHERE id = ?", (item_id,))
            db().commit()
            return "", 204
        data = body()
        name = value(data, "name", "物品名称")
        category = value(data, "category", "分类", 60)
        purchased = date_value(data, "purchase_date", "购买日期")
        ensure_purchase_date(item_id, purchased)
        price = cents_value(data, "purchase_price", "购买价格")
        notes = value(data, "notes", "备注", 1000, False)
        status = data.get("status")
        allowed = ("disposed",) if row["status"] == "disposed" else ("active", "idle")
        if status not in allowed:
            raise InputError("已处置状态由处置记录决定；其他物品可设为使用中或闲置")
        db().execute(
            "UPDATE items SET name=?, category=?, purchase_date=?, purchase_cents=?, notes=?, status=? WHERE id=?",
            (name, category, purchased, price, notes, status, item_id)
        )
        db().commit()
        return jsonify(item_payload(item_row(item_id), True))

    def event_data(kind, data):
        if kind == "usage":
            return {"used_on": date_value(data, "used_on", "使用日期"),
                    "notes": value(data, "notes", "备注", 1000, False)}
        return {"maintained_on": date_value(data, "maintained_on", "维修日期"),
                "cost_cents": cents_value(data, "cost", "维修费用"),
                "description": value(data, "description", "维修说明", 500)}

    @app.route("/api/items/<int:item_id>/<kind>", methods=["GET", "POST"])
    def events(item_id, kind):
        if kind not in ("usage", "maintenance"):
            from flask import abort
            abort(404)
        item = item_row(item_id)
        table = f"{kind}_records"
        if request.method == "GET":
            payload = item_payload(item, True)
            return jsonify(payload[f"{kind}_records"])
        if item["status"] == "disposed":
            raise InputError("已处置物品不能新增使用或维修记录")
        fields = event_data(kind, body())
        ensure_event_date(item, fields["used_on" if kind == "usage" else "maintained_on"])
        columns = ", ".join(["item_id", *fields])
        placeholders = ", ".join("?" for _ in range(len(fields) + 1))
        cur = db().execute(f"INSERT INTO {table} ({columns}) VALUES ({placeholders})", (item_id, *fields.values()))
        db().commit()
        records = item_payload(item_row(item_id), True)[f"{kind}_records"]
        return jsonify(next(r for r in records if r["id"] == cur.lastrowid)), 201

    @app.route("/api/<kind>/<int:record_id>", methods=["PUT", "DELETE"])
    def event_detail(kind, record_id):
        if kind not in ("usage", "maintenance"):
            from flask import abort
            abort(404)
        table = f"{kind}_records"
        record = record_row(table, record_id)
        item = item_row(record["item_id"])
        if request.method == "DELETE":
            db().execute(f"DELETE FROM {table} WHERE id = ?", (record_id,))
            db().commit()
            return "", 204
        fields = event_data(kind, body())
        ensure_event_date(item, fields["used_on" if kind == "usage" else "maintained_on"])
        assignments = ", ".join(f"{column} = ?" for column in fields)
        db().execute(f"UPDATE {table} SET {assignments} WHERE id = ?", (*fields.values(), record_id))
        db().commit()
        records = item_payload(item_row(item["id"]), True)[f"{kind}_records"]
        return jsonify(next(r for r in records if r["id"] == record_id))

    def disposal_data(data, item):
        disposed_on = date_value(data, "disposed_on", "处置日期")
        if disposed_on < item["purchase_date"]:
            raise InputError("处置日期不能早于购买日期")
        for table, column in (("usage_records", "used_on"), ("maintenance_records", "maintained_on")):
            last = db().execute(f"SELECT MAX({column}) FROM {table} WHERE item_id = ?", (item["id"],)).fetchone()[0]
            if last and disposed_on < last:
                raise InputError("处置日期不能早于已有使用或维修记录")
        method = data.get("method")
        if method not in ("sold", "gifted", "discarded", "other"):
            raise InputError("请选择有效的处置方式")
        return {"disposed_on": disposed_on, "method": method,
                "proceeds_cents": cents_value(data, "proceeds", "回收金额"),
                "notes": value(data, "notes", "备注", 1000, False)}

    @app.route("/api/items/<int:item_id>/disposal", methods=["GET", "POST"])
    def disposal(item_id):
        item = item_row(item_id)
        existing = db().execute("SELECT * FROM disposal_records WHERE item_id = ?", (item_id,)).fetchone()
        if request.method == "GET":
            return jsonify(item_payload(item, True)["disposal"])
        if existing:
            raise InputError("该物品已有处置记录")
        fields = disposal_data(body(), item)
        columns = ", ".join(["item_id", *fields])
        placeholders = ", ".join("?" for _ in range(len(fields) + 1))
        db().execute("BEGIN")
        db().execute(f"INSERT INTO disposal_records ({columns}) VALUES ({placeholders})", (item_id, *fields.values()))
        db().execute("UPDATE items SET status = 'disposed' WHERE id = ?", (item_id,))
        db().commit()
        return jsonify(item_payload(item_row(item_id), True)["disposal"]), 201

    @app.route("/api/disposal/<int:record_id>", methods=["PUT", "DELETE"])
    def disposal_detail(record_id):
        record = record_row("disposal_records", record_id)
        item = item_row(record["item_id"])
        if request.method == "DELETE":
            db().execute("BEGIN")
            db().execute("DELETE FROM disposal_records WHERE id = ?", (record_id,))
            db().execute("UPDATE items SET status = 'idle' WHERE id = ?", (item["id"],))
            db().commit()
            return "", 204
        fields = disposal_data(body(), item)
        assignments = ", ".join(f"{column} = ?" for column in fields)
        db().execute(f"UPDATE disposal_records SET {assignments} WHERE id = ?", (*fields.values(), record_id))
        db().commit()
        return jsonify(item_payload(item_row(item["id"]), True)["disposal"])

    @app.get("/api/stats")
    def stats():
        rows = db().execute("SELECT * FROM items").fetchall()
        payloads = [item_payload(row) for row in rows]
        category = {}
        for row in rows:
            category[row["category"]] = category.get(row["category"], 0) + row["purchase_cents"]
        return jsonify({
            "total_items": len(rows),
            "status_counts": {state: sum(p["status"] == state for p in payloads) for state in ("active", "idle", "disposed")},
            "purchase_total": money(sum(r["purchase_cents"] for r in rows)),
            "maintenance_total": money(sum(int(Decimal(p["maintenance_total"]) * 100) for p in payloads)),
            "disposal_total": money(sum(int(Decimal(p["disposal_proceeds"]) * 100) for p in payloads)),
            "net_cost_total": money(sum(int(Decimal(p["net_cost"]) * 100) for p in payloads)),
            "categories": [{"name": name, "amount": money(amount)} for name, amount in sorted(category.items(), key=lambda x: -x[1])],
        })

    @app.get("/api/insights")
    def insights():
        today = date.today()
        months = []
        for offset in range(11, -1, -1):
            absolute_month = today.year * 12 + today.month - 1 - offset
            year, month_index = divmod(absolute_month, 12)
            months.append(f"{year:04d}-{month_index + 1:02d}")
        monthly = {month: {"purchase": 0, "maintenance": 0, "proceeds": 0} for month in months}
        for table, date_column, amount_column, key in (
            ("items", "purchase_date", "purchase_cents", "purchase"),
            ("maintenance_records", "maintained_on", "cost_cents", "maintenance"),
            ("disposal_records", "disposed_on", "proceeds_cents", "proceeds"),
        ):
            rows = db().execute(
                f"SELECT substr({date_column}, 1, 7) AS month, SUM({amount_column}) AS total "
                f"FROM {table} WHERE {date_column} >= ? GROUP BY substr({date_column}, 1, 7)",
                (months[0] + "-01",),
            )
            for row in rows:
                if row["month"] in monthly:
                    monthly[row["month"]][key] = row["total"]

        review = []
        unrecorded = []
        for row in db().execute("SELECT * FROM items WHERE status != 'disposed' ORDER BY id DESC"):
            item = item_payload(row)
            last_used = item["last_recorded_use"]
            days_since = (today - date.fromisoformat(last_used)).days if last_used else None
            item["days_since_last_recorded_use"] = days_since
            if row["status"] == "idle":
                item["review_reason"] = "manual_idle"
                review.append(item)
            elif days_since is not None and days_since >= 90:
                item["review_reason"] = "no_recent_record"
                review.append(item)
            elif last_used is None:
                unrecorded.append(item)
        review.sort(key=lambda item: (item["review_reason"] != "manual_idle", -(item["days_since_last_recorded_use"] or 0)))
        return jsonify({
            "months": [{"month": month, **{key: money(value) for key, value in monthly[month].items()}}
                       for month in months],
            "review_threshold_days": 90,
            "review_items": review,
            "unknown_usage_items": unrecorded,
        })

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000)

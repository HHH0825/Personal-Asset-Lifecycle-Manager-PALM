"""Monthly summaries computed from current account records."""

import calendar
import re
from datetime import date
from .journey import item_journey
from .database import get_db
from .repository import list_item_rows
from .validation import InputError, money


def month_bounds(value, today):
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", value or ""):
        raise InputError("月份格式应为 YYYY-MM")
    year, month = map(int, value.split("-"))
    if year < 1 or value > today.strftime("%Y-%m"):
        raise InputError("不能查看未来月份")
    start = date(year, month, 1)
    last = date(year, month, calendar.monthrange(year, month)[1])
    return start, min(last, today)


def monthly_report(user_id, month, today):
    start, end = month_bounds(month, today)
    begin, finish = start.isoformat(), end.isoformat()
    items = list_item_rows(user_id, today=finish)
    bought = sorted((row for row in items if begin <= row["purchase_date"] <= finish),
                    key=lambda row: (row["purchase_date"], row["id"]), reverse=True)
    connection = get_db()
    totals = {}
    for key, table, date_column, amount_column in (
        ("maintenance_total", "maintenance_records", "maintained_on", "cost_cents"),
        ("proceeds_total", "disposal_records", "disposed_on", "proceeds_cents"),
    ):
        totals[key] = connection.execute(
            f"SELECT COALESCE(SUM(event.{amount_column}), 0) FROM {table} AS event "
            f"JOIN items AS item ON item.id = event.item_id "
            f"WHERE item.user_id = ? AND item.deleted_at IS NULL "
            f"AND event.{date_column} BETWEEN ? AND ?", (user_id, begin, finish),
        ).fetchone()[0]
    usage_count = connection.execute(
        "SELECT COUNT(*) FROM usage_records AS event JOIN items AS item ON item.id = event.item_id "
        "WHERE item.user_id = ? AND item.deleted_at IS NULL AND event.used_on BETWEEN ? AND ?",
        (user_id, begin, finish),
    ).fetchone()[0]
    highlights = []
    for row in items:
        purchased = date.fromisoformat(row["purchase_date"])
        if purchased > end:
            continue
        disposed = date.fromisoformat(row["disposed_on"]) if row["disposed_on"] else None
        holding_end = min(end, disposed) if disposed else end
        journey = item_journey(purchased, holding_end, row["purchase_cents"],
                               row["daily_target_cents"], end, disposed=disposed is not None and disposed <= end)
        for milestone in journey["milestones"]["earned"]:
            if begin <= milestone["date"] <= finish:
                highlights.append({"kind": "milestone", "item_id": row["id"], "name": row["name"],
                                   "icon_type": row["icon_type"], "date": milestone["date"],
                                   "text": milestone["label"]})
        target = journey["daily_target"]
        if target and target["reached_on"] and begin <= target["reached_on"] <= finish:
            highlights.append({"kind": "target", "item_id": row["id"], "name": row["name"],
                               "icon_type": row["icon_type"], "date": target["reached_on"],
                               "text": f"达成每天 {target['amount']} 元的小目标"})
    highlights.sort(key=lambda event: (event["date"], event["item_id"], event["kind"]), reverse=True)
    return {"month": month, "through": finish, "is_current": month == today.strftime("%Y-%m"),
            "purchase_count": len(bought),
            "purchase_total": money(sum(row["purchase_cents"] for row in bought)),
            "maintenance_total": money(totals["maintenance_total"]),
            "proceeds_total": money(totals["proceeds_total"]), "usage_count": usage_count,
            "purchased_items": [{"id": row["id"], "name": row["name"], "icon_type": row["icon_type"],
                                 "purchase_date": row["purchase_date"]} for row in bought],
            "highlights": highlights}

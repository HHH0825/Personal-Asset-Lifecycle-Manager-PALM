from datetime import date
from flask import g
from .repository import item_summary, usage_rows, maintenance_rows, event_boundary, disposal_by_item
from .validation import InputError, date_value, value, cents_value, money, daily_cost
from .journey import item_journey

def item_costs(purchase_cents, maintenance_cents, proceeds_cents, purchased, end):
    """Calculate a snapshot from plain values so the rules can be tested without a DB."""
    holding_days = (end - purchased).days
    net_cents = purchase_cents + maintenance_cents - proceeds_cents
    return holding_days, net_cents, daily_cost(purchase_cents, holding_days), daily_cost(net_cents, holding_days)


def maintenance_payload(record):
    return {"id": record["id"], "item_id": record["item_id"],
            "maintained_on": record["maintained_on"], "cost": money(record["cost_cents"]),
            "description": record["description"]}


def disposal_payload(record):
    return {"id": record["id"], "item_id": record["item_id"],
            "disposed_on": record["disposed_on"], "method": record["method"],
            "proceeds": money(record["proceeds_cents"]), "notes": record["notes"]}


def item_payload(row, details=False, today=None):
    today = today or date.today()
    item_id = row["id"]
    if "maintenance_cents" not in row.keys():
        row = item_summary(item_id, g.user_id, today.isoformat())
    maintenance_cents = row["maintenance_cents"]
    disposed = row["disposal_id"] is not None
    end = date.fromisoformat(row["disposed_on"]) if disposed else today
    holding_days, net_cents, purchase_daily, net_daily = item_costs(
        row["purchase_cents"], maintenance_cents, row["proceeds_cents"] or 0,
        date.fromisoformat(row["purchase_date"]), end,
    )
    result = {
        "id": item_id, "name": row["name"], "category": row["category"], "icon_type": row["icon_type"],
        "purchase_date": row["purchase_date"], "purchase_price": money(row["purchase_cents"]),
        "warranty_expires_on": row["warranty_expires_on"],
        "photo_url": f"/api/items/{item_id}/photo" if row["photo_key"] else None,
        "is_pinned": bool(row["is_pinned"]), "used_today": bool(row["used_today"]),
        "notes": row["notes"], "status": row["status"],
        "maintenance_total": money(maintenance_cents), "usage_count": row["usage_count"],
        "last_recorded_use": row["last_used_on"],
        "disposal_proceeds": money(row["proceeds_cents"] or 0),
        "net_cost": money(net_cents),
        "holding_days": holding_days,
        "daily_purchase_cost": purchase_daily,
        "daily_net_cost": net_daily,
    }
    result.update(item_journey(date.fromisoformat(row["purchase_date"]), end,
                               row["purchase_cents"], row["daily_target_cents"],
                               today, disposed=disposed))
    if details:
        result["usage_records"] = [dict(r) for r in usage_rows(item_id)]
        result["maintenance_records"] = [maintenance_payload(r) for r in maintenance_rows(item_id)]
        result["disposal"] = ({"id": row["disposal_id"], "item_id": item_id,
            "disposed_on": row["disposed_on"], "method": row["disposal_method"],
            "proceeds": money(row["proceeds_cents"]), "notes": row["disposal_notes"]} if disposed else None)
    return result

def ensure_event_date(item, event_date):
    if event_date < item["purchase_date"]:
        raise InputError("记录日期不能早于购买日期")
    disposal = disposal_by_item(item["id"])
    if disposal and event_date > disposal["disposed_on"]:
        raise InputError("记录日期不能晚于处置日期")

def ensure_purchase_date(item_id, purchase_date):
    for table, column in (("usage_records", "used_on"), ("maintenance_records", "maintained_on"), ("disposal_records", "disposed_on")):
        earliest = event_boundary(item_id, table, column, "MIN")
        if earliest and purchase_date > earliest:
            raise InputError("购买日期不能晚于已有生命周期记录")

def event_data(kind, data):
    if kind == "usage":
        return {"used_on": date_value(data, "used_on", "使用日期"),
                "notes": value(data, "notes", "备注", 1000, False)}
    return {"maintained_on": date_value(data, "maintained_on", "维修日期"),
            "cost_cents": cents_value(data, "cost", "维修费用"),
            "description": value(data, "description", "维修说明", 500)}

def disposal_data(data, item):
    disposed_on = date_value(data, "disposed_on", "处置日期")
    if disposed_on < item["purchase_date"]:
        raise InputError("处置日期不能早于购买日期")
    for table, column in (("usage_records", "used_on"), ("maintenance_records", "maintained_on")):
        last = event_boundary(item["id"], table, column, "MAX")
        if last and disposed_on < last:
            raise InputError("处置日期不能早于已有使用或维修记录")
    method = data.get("method")
    if method not in ("sold", "gifted", "discarded", "other"):
        raise InputError("请选择有效的处置方式")
    return {"disposed_on": disposed_on, "method": method,
            "proceeds_cents": cents_value(data, "proceeds", "回收金额"),
            "notes": value(data, "notes", "备注", 1000, False)}

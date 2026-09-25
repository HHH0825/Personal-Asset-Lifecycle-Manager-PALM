from datetime import date
from flask import Blueprint, jsonify, request
from .repository import (item_row, record_row, usage_rows, maintenance_rows, disposal_by_item,
                         create_event, update_event, delete_event, quick_use_today,
                         create_disposal, update_disposal, delete_disposal)
from .services import ensure_event_date, event_data, disposal_data, maintenance_payload, disposal_payload
from .validation import InputError, body

bp = Blueprint("events", __name__)

@bp.post("/api/items/<int:item_id>/usage/today")
def quick_usage(item_id):
    record, created = quick_use_today(item_id, date.today().isoformat())
    return jsonify(record=dict(record), created=created), 201 if created else 200

@bp.route("/api/items/<int:item_id>/<kind>", methods=["GET", "POST"])
def events(item_id, kind):
    if kind not in ("usage", "maintenance"):
        from flask import abort
        abort(404)
    item = item_row(item_id)
    table = f"{kind}_records"
    if request.method == "GET":
        records = usage_rows(item_id) if kind == "usage" else maintenance_rows(item_id)
        return jsonify([dict(record) if kind == "usage" else maintenance_payload(record) for record in records])
    if item["status"] == "disposed":
        raise InputError("已处置物品不能新增使用或维修记录")
    fields = event_data(kind, body())
    ensure_event_date(item, fields["used_on" if kind == "usage" else "maintained_on"])
    record = record_row(table, create_event(item_id, kind, fields))
    return jsonify(dict(record) if kind == "usage" else maintenance_payload(record)), 201

@bp.route("/api/<kind>/<int:record_id>", methods=["PUT", "DELETE"])
def event_detail(kind, record_id):
    if kind not in ("usage", "maintenance"):
        from flask import abort
        abort(404)
    table = f"{kind}_records"
    record = record_row(table, record_id)
    item = item_row(record["item_id"])
    if request.method == "DELETE":
        delete_event(kind, record_id)
        return "", 204
    fields = event_data(kind, body())
    ensure_event_date(item, fields["used_on" if kind == "usage" else "maintained_on"])
    update_event(kind, record_id, fields)
    record = record_row(table, record_id)
    return jsonify(dict(record) if kind == "usage" else maintenance_payload(record))

@bp.route("/api/items/<int:item_id>/disposal", methods=["GET", "POST"])
def disposal(item_id):
    item = item_row(item_id)
    existing = disposal_by_item(item_id)
    if request.method == "GET":
        return jsonify(disposal_payload(existing) if existing else None)
    if existing:
        raise InputError("该物品已有处置记录")
    fields = disposal_data(body(), item)
    record = create_disposal(item_id, fields)
    return jsonify(disposal_payload(record)), 201

@bp.route("/api/disposal/<int:record_id>", methods=["PUT", "DELETE"])
def disposal_detail(record_id):
    record = record_row("disposal_records", record_id)
    item = item_row(record["item_id"])
    if request.method == "DELETE":
        delete_disposal(record_id, item["id"])
        return "", 204
    fields = disposal_data(body(), item)
    update_disposal(record_id, fields)
    record = record_row("disposal_records", record_id)
    return jsonify(disposal_payload(record))

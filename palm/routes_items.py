from flask import Blueprint, current_app, g, jsonify, request, send_from_directory
from .photo import remove_photo_file, save_photo, delete_photo
from .repository import (item_row, list_item_rows, create_item, update_item, delete_item,
                         set_item_target, set_item_pin)
from .services import item_payload, ensure_purchase_date
from .validation import InputError, body, value, date_value, warranty_value, cents_value, icon_type_value

bp = Blueprint("items", __name__)

@bp.put("/api/items/<int:item_id>/daily-target")
def daily_target(item_id):
    row = item_row(item_id)
    if row["status"] == "disposed":
        raise InputError("已处置物品的目标只读，撤销处置后可修改")
    data = body()
    if "amount" not in data:
        raise InputError("请填写目标金额，取消目标请提交 null")
    amount = None if data["amount"] is None else cents_value(data, "amount", "目标金额")
    if amount == 0:
        raise InputError("目标金额必须大于零")
    set_item_target(item_id, g.user_id, amount)
    return jsonify(item_payload(item_row(item_id), True))

@bp.route("/api/items", methods=["GET", "POST"])
def items():
    if request.method == "GET":
        query = request.args.get("q", "").strip()[:120]
        rows = list_item_rows(g.user_id, query=query)
        return jsonify([item_payload(row) for row in rows])
    data = body()
    name = value(data, "name", "物品名称")
    category = value(data, "category", "分类", 60)
    icon_type = icon_type_value(data, "other")
    purchased = date_value(data, "purchase_date", "购买日期")
    warranty = warranty_value(data, purchased)
    price = cents_value(data, "purchase_price", "购买价格")
    notes = value(data, "notes", "备注", 1000, False)
    status = data.get("status", "active")
    if status not in ("active", "idle"):
        raise InputError("新物品状态只能是使用中或闲置")
    item_id = create_item(g.user_id, name, category, icon_type, purchased, warranty, price, notes, status)
    return jsonify(item_payload(item_row(item_id), True)), 201

@bp.route("/api/items/<int:item_id>", methods=["GET", "PUT", "DELETE"])
def item_detail(item_id):
    row = item_row(item_id)
    if request.method == "GET":
        return jsonify(item_payload(row, True))
    if request.method == "DELETE":
        remove_photo_file(delete_item(item_id))
        return "", 204
    data = body()
    name = value(data, "name", "物品名称")
    category = value(data, "category", "分类", 60)
    icon_type = icon_type_value(data, row["icon_type"])
    purchased = date_value(data, "purchase_date", "购买日期")
    ensure_purchase_date(item_id, purchased)
    warranty = warranty_value(data, purchased, row["warranty_expires_on"])
    price = cents_value(data, "purchase_price", "购买价格")
    notes = value(data, "notes", "备注", 1000, False)
    status = data.get("status")
    allowed = ("disposed",) if row["status"] == "disposed" else ("active", "idle")
    if status not in allowed:
        raise InputError("已处置状态由处置记录决定；其他物品可设为使用中或闲置")
    update_item(item_id, g.user_id, name, category, icon_type, purchased, warranty, price, notes, status)
    return jsonify(item_payload(item_row(item_id), True))

@bp.route("/api/items/<int:item_id>/photo", methods=["GET", "POST", "DELETE"])
def item_photo(item_id):
    row = item_row(item_id)
    if request.method == "GET":
        if not row["photo_key"]:
            from flask import abort
            abort(404)
        return send_from_directory(current_app.config["PHOTO_DIR"], row["photo_key"], mimetype="image/jpeg")
    if request.method == "DELETE":
        delete_photo(item_id)
        return "", 204

    save_photo(item_id, request.files.get("photo"))
    return jsonify(item_payload(item_row(item_id), True))

@bp.put("/api/items/<int:item_id>/pin")
def pin_item(item_id):
    item_row(item_id)
    data = body()
    if not isinstance(data.get("is_pinned"), bool):
        raise InputError("置顶状态必须为 true 或 false")
    set_item_pin(item_id, g.user_id, data["is_pinned"])
    return jsonify(item_payload(item_row(item_id)))

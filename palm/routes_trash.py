from flask import Blueprint, jsonify
from .repository import item_row
from .services import item_payload
from .trash import list_trash, restore_item, permanently_delete

bp = Blueprint("trash", __name__)


@bp.get("/api/trash")
def trash():
    return jsonify(list_trash())


@bp.post("/api/trash/<int:item_id>/restore")
def restore(item_id):
    restore_item(item_id)
    return jsonify(item_payload(item_row(item_id), True))


@bp.delete("/api/trash/<int:item_id>")
def delete_forever(item_id):
    permanently_delete(item_id)
    return "", 204

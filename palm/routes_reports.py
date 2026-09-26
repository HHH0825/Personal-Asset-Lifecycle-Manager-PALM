from datetime import date
from flask import Blueprint, g, jsonify, request
from .reports import monthly_report

bp = Blueprint("reports", __name__)


@bp.get("/api/reports/monthly")
def month():
    today = date.today()
    return jsonify(monthly_report(g.user_id, request.args.get("month", today.strftime("%Y-%m")), today))

"""Read only dashboard and analysis endpoints."""

from datetime import date

from flask import Blueprint, g, jsonify

from .analytics import build_insights, build_stats, recent_months
from .repository import list_item_rows, monthly_totals, repair_totals


bp = Blueprint("insights", __name__)


@bp.get("/api/stats")
def stats():
    return jsonify(build_stats(list_item_rows(g.user_id)))


@bp.get("/api/insights")
def insights():
    today = date.today()
    months = recent_months(today)
    grouped = monthly_totals(g.user_id, months[0])
    monthly = {month: {key: grouped[key].get(month, 0) for key in ("purchase", "maintenance", "proceeds")}
               for month in months}
    return jsonify(build_insights(today, list_item_rows(g.user_id, today=today.isoformat()),
                                  months, monthly, repair_totals(g.user_id)))

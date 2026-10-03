from flask import Blueprint, g, jsonify, request
from .reports import monthly_report

bp = Blueprint('reports', __name__)

@bp.get('/api/mp/reports/monthly')
def monthly():
    return jsonify(monthly_report(g.user_id, request.args.get('month')))

import hmac
import secrets
from flask import g, jsonify, request, session
from .repository import user_by_id

def csrf_token():
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_urlsafe(32)
    return session["csrf_token"]

def input_error(error):
    return jsonify(error=str(error)), 400

def not_found(_error):
    return jsonify(error="记录不存在"), 404

def gone(error):
    return jsonify(error=error.description), 410

def avoid_cached_account_data(response):
    if request.path.startswith("/api/") or request.path in ("/", "/app", "/login", "/register"):
        response.headers["Cache-Control"] = "no-store"
    return response

def protect_api():
    if not request.path.startswith("/api/"):
        return None
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        expected = session.get("csrf_token", "")
        supplied = request.headers.get("X-CSRF-Token", "")
        if not expected or not hmac.compare_digest(expected, supplied):
            return jsonify(error="页面验证已失效，请刷新后重试"), 403
    if request.path.startswith("/api/auth/"):
        return None
    user_id = session.get("user_id")
    user = user_by_id(user_id)
    if not user or session.get("auth_version", 0) != user["auth_version"]:
        session.clear()
        return jsonify(error="请先登录"), 401
    g.user_id = user["id"]

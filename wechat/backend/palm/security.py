"""Bearer authentication for mini program requests; no browser cookies are used."""

import hashlib
import time

from flask import g, jsonify, request

from .database import get_db


def no_store(response):
    if request.path.startswith("/api/mp/"):
        response.headers["Cache-Control"] = "no-store"
    return response


def protect_api():
    if not request.path.startswith("/api/mp/"):
        return None
    if request.path == "/api/mp/auth/login":
        return None
    supplied = request.headers.get("Authorization", "")
    if not supplied.startswith("Bearer "):
        return jsonify(error="请先登录"), 401
    token = supplied[7:]
    if len(token) != 64 or any(char not in "0123456789abcdefABCDEF" for char in token):
        return jsonify(error="登录状态已失效"), 401
    digest = hashlib.sha256(token.encode("ascii")).hexdigest()
    row = get_db().execute(
        "SELECT s.user_id FROM wechat_sessions AS s JOIN users AS u ON u.id = s.user_id "
        "WHERE s.token_hash = ? AND s.expires_at > ?", (digest, int(time.time())),
    ).fetchone()
    if row is None:
        return jsonify(error="登录状态已失效"), 401
    g.user_id = row["user_id"]
    g.token_hash = digest

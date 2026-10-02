"""Exchange wx.login codes server-side and issue revocable PALM credentials."""

import hashlib
import json
import re
import secrets
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request

from flask import Blueprint, current_app, g, jsonify, request
from werkzeug.security import generate_password_hash

from .database import get_db
from .repository import user_by_id
from .validation import AVATAR_KEYS, InputError, body, value

bp = Blueprint("mp_auth", __name__)
TOKEN_TTL_SECONDS = 7 * 24 * 3600


def exchange_code(code):
    exchanger = current_app.config.get("WECHAT_CODE_EXCHANGER")
    if exchanger:
        return exchanger(code)
    if code.startswith("dev:"):
        if not current_app.config["DEV_LOGIN"]:
            raise InputError("本地调试登录未开启，请使用本地开发启动入口")
        if request.remote_addr not in ("127.0.0.1", "::1"):
            raise InputError("本地调试登录仅允许电脑本机访问")
        if not re.fullmatch(r"dev:[A-Za-z0-9_-]{1,40}", code):
            raise InputError("本地调试码格式应为 dev:名称")
        return code
    if current_app.config["DEV_LOGIN"] and request.remote_addr in ("127.0.0.1", "::1"):
        raise InputError("本地调试码格式应为 dev:名称")
    app_id = current_app.config["WECHAT_APP_ID"]
    secret = current_app.config["WECHAT_APP_SECRET"]
    if not app_id or not secret:
        raise InputError("服务器尚未配置微信登录")
    query = urllib.parse.urlencode({"appid": app_id, "secret": secret,
                                    "js_code": code, "grant_type": "authorization_code"})
    try:
        with urllib.request.urlopen("https://api.weixin.qq.com/sns/jscode2session?" + query, timeout=5) as response:
            result = json.load(response)
    except (OSError, ValueError) as exc:
        current_app.logger.warning("微信登录服务暂不可用：%s", type(exc).__name__)
        raise InputError("微信登录服务暂不可用，请稍后再试") from exc
    if not isinstance(result, dict) or result.get("errcode") or not isinstance(result.get("openid"), str) or not result["openid"]:
        raise InputError("微信登录凭证无效，请重试")
    return result["openid"]


def public_user(user):
    return {"id": user["id"], "username": user["username"], "avatar_key": user["avatar_key"]}


def user_for_openid(openid):
    db = get_db()
    row = db.execute("SELECT user_id FROM wechat_identities WHERE openid = ?", (openid,)).fetchone()
    if row:
        return user_by_id(row["user_id"])
    key = "wx_" + hashlib.sha256(openid.encode("utf-8")).hexdigest()[:24]
    db.execute("BEGIN IMMEDIATE")
    try:
        row = db.execute("SELECT user_id FROM wechat_identities WHERE openid = ?", (openid,)).fetchone()
        if row:
            db.commit()
            return user_by_id(row["user_id"])
        cursor = db.execute("INSERT INTO users (username, username_key, password_hash) VALUES (?, ?, ?)",
                            ("微信用户" + key[-4:], key, generate_password_hash(secrets.token_urlsafe(32))))
        db.execute("INSERT INTO wechat_identities (openid, user_id) VALUES (?, ?)", (openid, cursor.lastrowid))
        db.commit()
    except Exception:
        db.rollback()
        raise
    return user_by_id(cursor.lastrowid)


@bp.post("/api/mp/auth/login")
def login():
    code = body().get("code")
    if not isinstance(code, str) or not 1 <= len(code) <= 256:
        raise InputError("请提交有效的微信登录凭证")
    user = user_for_openid(exchange_code(code))
    token = secrets.token_hex(32)
    expiry = int(time.time()) + TOKEN_TTL_SECONDS
    db = get_db()
    db.execute("DELETE FROM wechat_sessions WHERE expires_at <= ?", (int(time.time()),))
    db.execute("INSERT INTO wechat_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
               (hashlib.sha256(token.encode("ascii")).hexdigest(), user["id"], expiry))
    db.commit()
    return jsonify(token=token, expires_at=expiry, user=public_user(user))


@bp.get("/api/mp/auth/me")
def me():
    return jsonify(user=public_user(user_by_id(g.user_id)))


@bp.post("/api/mp/auth/logout")
def logout():
    get_db().execute("DELETE FROM wechat_sessions WHERE token_hash = ?", (g.token_hash,))
    get_db().commit()
    return "", 204


@bp.put("/api/mp/profile")
def profile():
    data = body()
    username = value(data, "username", "昵称", 32)
    if len(username) < 2:
        raise InputError("昵称至少需要 2 个字符")
    avatar = data.get("avatar_key")
    if avatar is not None and avatar not in AVATAR_KEYS:
        raise InputError("请选择有效的预设头像")
    db = get_db()
    try:
        db.execute("UPDATE users SET username = ?, username_key = ?, avatar_key = ? WHERE id = ?",
                   (username, username.casefold(), avatar, g.user_id))
        db.commit()
    except sqlite3.IntegrityError as exc:
        db.rollback()
        raise InputError("该昵称已被使用") from exc
    return jsonify(user=public_user(user_by_id(g.user_id)))

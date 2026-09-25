import re
import sqlite3
from flask import Blueprint, g, jsonify, session
from werkzeug.security import check_password_hash, generate_password_hash
from .repository import user_by_id, user_by_key, register_user, update_username, update_password, update_avatar
from .security import csrf_token
from .validation import AVATAR_KEYS, InputError, body

bp = Blueprint("account", __name__)

def public_user(row):
    return {"id": row["id"], "username": row["username"], "avatar_key": row["avatar_key"]}

@bp.get("/api/auth/me")
def auth_me():
    user_id = session.get("user_id")
    user = user_by_id(user_id)
    if user_id and (not user or session.get("auth_version", 0) != user["auth_version"]):
        session.clear()
        user = None
    return jsonify(user=public_user(user) if user else None, csrf_token=csrf_token())

@bp.post("/api/auth/register")
def auth_register():
    data = body()
    username = data.get("username")
    password = data.get("password")
    if not isinstance(username, str) or not re.fullmatch(r"[\w]{3,32}", username.strip()):
        raise InputError("用户名应为 3 至 32 个字母、数字、汉字或下划线")
    username = username.strip()
    if not isinstance(password, str) or not 8 <= len(password) <= 128:
        raise InputError("密码长度应为 8 至 128 个字符")
    password_hash = generate_password_hash(password)
    try:
        user = register_user(username, password_hash)
    except sqlite3.IntegrityError as exc:
        raise InputError("用户名已被使用") from exc
    session.clear()
    session["user_id"] = user["id"]
    session["auth_version"] = user["auth_version"]
    return jsonify(user=public_user(user), csrf_token=csrf_token()), 201

@bp.post("/api/auth/login")
def auth_login():
    data = body()
    username, password = data.get("username"), data.get("password")
    user = user_by_key(username.strip().casefold()) if isinstance(username, str) else None
    if not user or not isinstance(password, str) or not check_password_hash(user["password_hash"], password):
        return jsonify(error="用户名或密码不正确"), 401
    session.clear()
    session["user_id"] = user["id"]
    session["auth_version"] = user["auth_version"]
    return jsonify(user=public_user(user), csrf_token=csrf_token())

@bp.post("/api/auth/logout")
def auth_logout():
    session.clear()
    return "", 204

@bp.put("/api/account/username")
def account_username():
    data = body()
    username = data.get("username")
    if not isinstance(username, str) or not re.fullmatch(r"[\w]{3,32}", username.strip()):
        raise InputError("用户名应为 3 至 32 个字母、数字、汉字或下划线")
    username = username.strip()
    user = user_by_id(g.user_id)
    if not isinstance(data.get("current_password"), str) or not check_password_hash(user["password_hash"], data["current_password"]):
        raise InputError("当前密码不正确")
    try:
        updated = update_username(g.user_id, username)
    except sqlite3.IntegrityError as exc:
        raise InputError("用户名已被使用") from exc
    return jsonify(user=public_user(updated))

@bp.put("/api/account/password")
def account_password():
    data = body()
    user = user_by_id(g.user_id)
    if not isinstance(data.get("current_password"), str) or not check_password_hash(user["password_hash"], data["current_password"]):
        raise InputError("当前密码不正确")
    new_password = data.get("new_password")
    if not isinstance(new_password, str) or not 8 <= len(new_password) <= 128:
        raise InputError("新密码长度应为 8 至 128 个字符")
    update_password(g.user_id, generate_password_hash(new_password))
    session.clear()
    return "", 204

@bp.put("/api/account/avatar")
def account_avatar():
    data = body()
    avatar = data.get("avatar_key")
    if "avatar_key" not in data or (avatar is not None and (not isinstance(avatar, str) or avatar not in AVATAR_KEYS)):
        raise InputError("请选择有效的预设头像")
    return jsonify(user=public_user(update_avatar(g.user_id, avatar)))

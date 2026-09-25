from flask import Blueprint, redirect, render_template, request, session
from .repository import user_by_id

bp = Blueprint("pages", __name__)

def signed_in_user():
    user_id = session.get("user_id")
    user = user_by_id(user_id)
    if user_id and (not user or session.get("auth_version", 0) != user["auth_version"]):
        session.clear()
        user = None
    return user

@bp.get("/")
def index():
    return redirect("/app") if signed_in_user() else render_template("landing.html")

@bp.get("/login")
@bp.get("/register")
def auth_page():
    if signed_in_user():
        return redirect("/app")
    return render_template("auth.html", register=request.path == "/register")

@bp.get("/app")
def archive_page():
    if not signed_in_user():
        return redirect("/login")
    return render_template("index.html")

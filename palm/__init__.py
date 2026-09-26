"""PALM application setup. Importing this package does not touch user data."""

import os
import secrets
from pathlib import Path

from flask import Flask

from .database import close_db, initialize_database
from .security import input_error, not_found, gone, avoid_cached_account_data, protect_api
from .routes_account import bp as account_bp
from .routes_pages import bp as pages_bp
from .routes_items import bp as items_bp
from .routes_events import bp as events_bp
from .routes_insights import bp as insights_bp
from .routes_trash import bp as trash_bp
from .routes_exports import bp as exports_bp
from .routes_reports import bp as reports_bp
from .validation import InputError


def create_app(test_config=None):
    project_root = Path(__file__).resolve().parent.parent
    app = Flask(__name__, instance_path=str(project_root / "instance"),
                template_folder=str(project_root / "templates"),
                static_folder=str(project_root / "static"))
    app.config.from_mapping(
        DATABASE=str(Path(app.instance_path) / "palm.sqlite3"),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
    )
    if test_config:
        app.config.update(test_config)
    app.config.setdefault("PHOTO_DIR", str(Path(app.config["DATABASE"]).parent / "uploads" / "items"))
    app.config.setdefault("KEY_PATH", str(Path(app.config["DATABASE"]).parent / "session.key"))
    app.teardown_appcontext(close_db)
    app.register_error_handler(InputError, input_error)
    app.register_error_handler(404, not_found)
    app.register_error_handler(410, gone)
    app.after_request(avoid_cached_account_data)
    app.before_request(protect_api)
    for blueprint in (pages_bp, account_bp, items_bp, events_bp, insights_bp, trash_bp, exports_bp, reports_bp):
        app.register_blueprint(blueprint)
    return app


def initialize_app(app):
    """Prepare persistent state explicitly before serving requests."""
    if not app.config.get("SECRET_KEY"):
        if os.environ.get("PALM_SECRET_KEY"):
            app.config["SECRET_KEY"] = os.environ["PALM_SECRET_KEY"]
        else:
            key_path = Path(app.config["KEY_PATH"])
            key_path.parent.mkdir(parents=True, exist_ok=True)
            try:
                with key_path.open("x", encoding="ascii") as key_file:
                    key_file.write(secrets.token_hex(32))
            except FileExistsError:
                pass
            app.config["SECRET_KEY"] = key_path.read_text(encoding="ascii")
    initialize_database(app)
    from .trash import purge_expired
    with app.app_context():
        purge_expired()
    return app

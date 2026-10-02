"""Independent PALM service for the WeChat mini program."""

import os
from pathlib import Path

from flask import Flask, jsonify

from .database import close_db, initialize_database
from .security import protect_api, no_store
from .validation import InputError
from .routes_auth import bp as auth_bp
from .routes_items import bp as items_bp
from .routes_events import bp as events_bp
from .routes_insights import bp as insights_bp
from .routes_trash import bp as trash_bp


def create_app(test_config=None):
    root = Path(__file__).resolve().parents[2]
    app = Flask(__name__, static_folder=None)
    app.config.update(
        DATABASE=str(root / "instance" / "palm.sqlite3"),
        PHOTO_DIR=str(root / "instance" / "uploads" / "items"),
        WECHAT_APP_ID=os.getenv("PALM_WECHAT_APP_ID", ""),
        WECHAT_APP_SECRET=os.getenv("PALM_WECHAT_APP_SECRET", ""),
        DEV_LOGIN=os.getenv("PALM_WECHAT_DEV_LOGIN") == "1",
        MAX_CONTENT_LENGTH=6 * 1024 * 1024,
    )
    if test_config:
        app.config.update(test_config)
    app.teardown_appcontext(close_db)
    app.before_request(protect_api)
    app.after_request(no_store)
    app.register_error_handler(InputError, lambda error: (jsonify(error=str(error)), 400))
    app.register_error_handler(404, lambda _error: (jsonify(error="记录不存在"), 404))
    app.register_error_handler(410, lambda error: (jsonify(error=error.description), 410))
    app.register_error_handler(413, lambda _error: (jsonify(error="照片不能超过 5 MB"), 413))
    for blueprint in (auth_bp, items_bp, events_bp, insights_bp, trash_bp):
        app.register_blueprint(blueprint)
    @app.get("/healthz")
    def healthz():
        return jsonify(ok=True)
    return app


def initialize_app(app):
    initialize_database(app)
    from .trash import purge_expired
    with app.app_context():
        purge_expired()
    return app

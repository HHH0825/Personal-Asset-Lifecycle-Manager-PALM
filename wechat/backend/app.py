"""Standalone local development entry point; production imports wsgi:application."""

import os

from palm import create_app, initialize_app

application = create_app()


if __name__ == "__main__":
    initialize_app(application)
    application.run(host="127.0.0.1", port=int(os.getenv("PALM_WECHAT_PORT", "5001")), debug=False)

"""Production WSGI application."""

from palm import create_app, initialize_app

application = initialize_app(create_app({"DEV_LOGIN": False}))

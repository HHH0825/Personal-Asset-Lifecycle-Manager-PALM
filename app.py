"""PALM entry point and compatibility import for create_app."""

from palm import create_app, initialize_app


if __name__ == "__main__":
    application = initialize_app(create_app())
    application.run(host="127.0.0.1", port=5000)

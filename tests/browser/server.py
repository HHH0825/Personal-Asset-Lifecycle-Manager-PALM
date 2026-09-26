"""Isolated local server for Playwright. Never uses the real instance data."""

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app import create_app, initialize_app


def main():
    with tempfile.TemporaryDirectory(prefix="palm-browser-") as directory:
        base = Path(directory)
        app = initialize_app(create_app({
            "TESTING": True,
            "DATABASE": str(base / "palm.sqlite3"),
            "KEY_PATH": str(base / "session.key"),
            "PHOTO_DIR": str(base / "uploads" / "items"),
        }))
        app.run(host="127.0.0.1", port=int(os.environ["PALM_BROWSER_PORT"]),
                debug=False, use_reloader=False)


if __name__ == "__main__":
    main()

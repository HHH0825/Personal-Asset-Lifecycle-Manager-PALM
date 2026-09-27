"""Entry point for the installed Windows edition of PALM.

This file deliberately lives outside the application package. Source launches keep
using app.py and its existing instance directory.
"""

import argparse
import os
import sys
import webbrowser
from pathlib import Path

if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from palm import create_app, initialize_app
from werkzeug.serving import make_server

from migration import MigrationError, choose_source_folder, migrate_instance


HOST = "127.0.0.1"
PORT = 5000
URL = f"http://{HOST}:{PORT}"


def instance_directory():
    """Return installed user data location, with a test-only absolute override."""
    override = os.environ.get("PALM_PACKAGE_DATA_DIR")
    if override:
        path = Path(override)
        if not path.is_absolute():
            raise ValueError("PALM_PACKAGE_DATA_DIR 必须是绝对路径")
        return path
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        raise RuntimeError("无法找到 LOCALAPPDATA，无法确定 PALM 数据目录")
    return Path(local_app_data) / "PALM" / "instance"


def configured_app(data_dir=None):
    base = data_dir or instance_directory()
    return create_app({
        "DATABASE": str(base / "palm.sqlite3"),
        "KEY_PATH": str(base / "session.key"),
        "PHOTO_DIR": str(base / "uploads" / "items"),
    })


def run_service(open_browser=True):
    app = configured_app()
    try:
        server = make_server(HOST, PORT, app, threaded=True)
    except OSError as exc:
        print(f"无法启动：{PORT} 端口可能已被占用。{exc}", file=sys.stderr, flush=True)
        return 1
    try:
        initialize_app(app)
        print(f"PALM 本地访问地址：{URL}", flush=True)
        print("关闭此窗口或按 Ctrl+C 可停止服务。", flush=True)
        if open_browser:
            try:
                if not webbrowser.open(URL, new=2):
                    print("浏览器未能自动打开，请手动访问上方地址。", flush=True)
            except Exception as exc:
                print(f"浏览器未能自动打开：{exc}。请手动访问上方地址。", flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nPALM 已停止。", flush=True)
    finally:
        server.server_close()
    return 0


def main(argv=None):
    # Redirected Windows output may default to a code page without Chinese.
    # Configure the actual streams; frozen executables need this too.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser(description="PALM Windows 安装版")
    parser.add_argument("--migrate", action="store_true", help="选择旧版 instance 并迁移")
    parser.add_argument("--migrate-from", metavar="DIRECTORY", help="从指定旧版 instance 迁移")
    parser.add_argument("--no-browser", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.migrate and args.migrate_from:
        parser.error("--migrate 与 --migrate-from 不能同时使用")
    try:
        if args.migrate or args.migrate_from:
            source = Path(args.migrate_from) if args.migrate_from else choose_source_folder()
            if source is None:
                print("已取消迁移，未更改任何数据。")
                return 0
            backup = migrate_instance(source, instance_directory())
            print("迁移完成。请重新启动 PALM，使用原账号登录。")
            if backup:
                print(f"安装版原空数据备份：{backup}")
            return 0
        return run_service(open_browser=not args.no_browser)
    except (MigrationError, OSError, RuntimeError, ValueError) as exc:
        print(f"操作失败：{exc}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())

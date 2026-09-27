"""Exercise a bundled or silently installed PALM in an isolated temp profile."""

import argparse
import http.cookiejar
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from palm import create_app, initialize_app

URL = "http://127.0.0.1:5000"


def request(opener, path, data=None, token=None):
    body = None if data is None else json.dumps(data).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-CSRF-Token"] = token
    with opener.open(urllib.request.Request(URL + path, data=body, headers=headers), timeout=3) as response:
        payload = response.read()
        return json.loads(payload) if payload else None


def run_server(executable, data_dir, log_path):
    data_dir.parent.mkdir(parents=True, exist_ok=True)
    environment = dict(os.environ)
    environment["PALM_PACKAGE_DATA_DIR"] = str(data_dir)
    environment.pop("PYTHONPATH", None)
    log = open(log_path, "wb")
    try:
        process = subprocess.Popen([str(executable), "--no-browser"], cwd=data_dir.parent,
                                   env=environment, stdout=log, stderr=subprocess.STDOUT)
    except Exception:
        log.close()
        raise
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    try:
        for _ in range(100):
            if process.poll() is not None:
                raise RuntimeError(f"PALM 提前退出，退出码 {process.returncode}: {log_path.read_text(encoding='utf-8', errors='replace')}")
            try:
                request(opener, "/api/auth/me")
                return process, log, opener
            except (urllib.error.URLError, TimeoutError):
                time.sleep(0.2)
        raise RuntimeError(f"PALM 启动超时: {log_path.read_text(encoding='utf-8', errors='replace')}")
    except Exception:
        process.terminate()
        process.wait(timeout=10)
        log.close()
        raise


def stop_server(process, log):
    process.terminate()
    process.wait(timeout=15)
    log.close()
    try:
        urllib.request.urlopen(URL, timeout=1)
    except urllib.error.URLError:
        return
    raise AssertionError("服务进程结束后仍可访问本地网址")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=Path)
    parser.add_argument("--installer", type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="PALM 安装 验收 ") as directory:
        base = Path(directory)
        executable = args.exe.resolve()
        installed = None
        if args.installer:
            installed = base / "PALM 安装 空格"
            subprocess.run([str(args.installer.resolve()), "/VERYSILENT", "/SUPPRESSMSGBOXES",
                            "/NORESTART", f"/DIR={installed}"], check=True, timeout=180)
            executable = installed / "PALM.exe"
            assert executable.is_file(), "安装后缺少 PALM.exe"
            assert (installed / "start.cmd").is_file(), "安装后缺少终端启动脚本"
            group = (Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" /
                     "Start Menu" / "Programs" / "PALM")
            for shortcut in ("启动 PALM.lnk", "迁移旧数据.lnk", "卸载 PALM.lnk"):
                assert (group / shortcut).is_file(), f"开始菜单缺少 {shortcut}"

        data_dir = base / "用户 数据" / "instance"
        process, log, opener = run_server(executable, data_dir, base / "server.log")
        try:
            token = request(opener, "/api/auth/me")["csrf_token"]
            registered = request(opener, "/api/auth/register", {
                "username": "smoke_owner", "password": "smoke-password-123",
            }, token)
            assert registered["user"]["username"] == "smoke_owner"
            assert request(opener, "/api/items") == []
            with opener.open(URL + "/static/images/palm-logo.svg", timeout=3) as response:
                assert b"<svg" in response.read()
        finally:
            stop_server(process, log)
        assert (data_dir / "palm.sqlite3").is_file()
        assert (data_dir / "session.key").is_file()

        process, log, opener = run_server(executable, data_dir, base / "restart.log")
        try:
            token = request(opener, "/api/auth/me")["csrf_token"]
            logged_in = request(opener, "/api/auth/login", {
                "username": "smoke_owner", "password": "smoke-password-123",
            }, token)
            assert logged_in["user"]["username"] == "smoke_owner"
        finally:
            stop_server(process, log)

        source = base / "旧版 instance"
        source_app = initialize_app(create_app({
            "TESTING": True,
            "DATABASE": str(source / "palm.sqlite3"),
            "KEY_PATH": str(source / "session.key"),
            "PHOTO_DIR": str(source / "uploads" / "items"),
        }))
        client = source_app.test_client()
        token = client.get("/api/auth/me").json["csrf_token"]
        assert client.post("/api/auth/register", json={
            "username": "legacy_owner", "password": "legacy-password-123",
        }, headers={"X-CSRF-Token": token}).status_code == 201
        imported_dir = base / "迁移 数据" / "instance"
        environment = dict(os.environ)
        environment["PALM_PACKAGE_DATA_DIR"] = str(imported_dir)
        subprocess.run([str(executable), "--migrate-from", str(source)], cwd=base, env=environment,
                       check=True, timeout=60)
        process, log, opener = run_server(executable, imported_dir, base / "migrated.log")
        try:
            token = request(opener, "/api/auth/me")["csrf_token"]
            logged_in = request(opener, "/api/auth/login", {
                "username": "legacy_owner", "password": "legacy-password-123",
            }, token)
            assert logged_in["user"]["username"] == "legacy_owner"
        finally:
            stop_server(process, log)

        if installed:
            uninstaller = installed / "unins000.exe"
            assert uninstaller.is_file(), "缺少卸载程序"
            subprocess.run([str(uninstaller), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"],
                           check=True, timeout=120)
            assert (data_dir / "palm.sqlite3").is_file(), "卸载误删了个人数据"
            assert (imported_dir / "palm.sqlite3").is_file(), "卸载误删了迁移数据"
    print("Installed PALM smoke checks passed")


if __name__ == "__main__":
    main()

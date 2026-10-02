"""Loopback-only development entry point with explicit simulated login."""

from palm import create_app, initialize_app


def create_dev_app(test_config=None):
    config = dict(test_config or {})
    config["DEV_LOGIN"] = True
    return create_app(config)


def main():
    app = initialize_app(create_dev_app())
    print("物物记：本地模拟登录已开启", flush=True)
    print("后端地址：http://127.0.0.1:5001", flush=True)
    print("请在开发者工具选择本地体验；保持此窗口打开，按 Ctrl+C 停止。", flush=True)
    app.run(host="127.0.0.1", port=5001, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()

# PALM：个人物品资产生命周期管理平台

![PALM Logo：手账里长出新芽](static/images/palm-logo.svg)

PALM 是本地运行的个人物品手账。按账号记录购买、使用、维修、闲置、处置、照片与回收站，并查看日均成本、月度回顾和智能分析。技术栈为 Flask、SQLite、HTML、CSS 和原生 JavaScript；日常运行只需 Python 3.10 或更新版本。

## 启动

Windows 双击 [启动 PALM.bat](<启动 PALM.bat>)。首次启动需要联网安装 `requirements-lock.txt` 中固定的 Python 依赖；完成后可以断网使用。浏览器打开 <http://127.0.0.1:5000>，关闭启动窗口即可停止服务。若 5000 端口被占用，脚本会显示提示。

也可以在 PowerShell 中手动启动：

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-lock.txt
.venv\Scripts\python.exe app.py
```

首次启动创建 `instance/palm.sqlite3` 与 `instance/session.key`。照片保存在 `instance/uploads/items`。现有数据不会因源码目录整理而迁移；备份时请同时保存这三处内容。导入演示数据前先注册空账号，再运行 `.venv\Scripts\python.exe seed_demo.py`。

## 目录

- `app.py`、`启动 PALM.bat`、`seed_demo.py`：运行与演示入口。
- `palm/`：应用工厂、路由、业务规则、数据访问与数据库升级。
- `templates/`：HTML 模板；`static/css/`、`static/js/`、`static/images/`：浏览器资源。
- `tests/`：Python、前端模块及隔离数据库的浏览器回归。
- `docs/`：详细使用、接口、架构、备份与验收资料。
- `requirements.txt`：允许的运行依赖范围；`requirements-lock.txt`：已验证的精确版本。

## 文档与测试

[使用说明](docs/user-guide.md) · [接口](docs/api.md) · [架构](docs/architecture.md) · [备份与升级](docs/backup-restore.md) · [测试与演示](docs/testing.md) · [版本记录](CHANGELOG.md) · [v1.0.0 验收报告](docs/release-report.md)

```powershell
.venv\Scripts\python.exe -m unittest discover -s tests -q
node --test tests/frontend.test.mjs
npm install
npx playwright install chromium
npm run test:browser
```

浏览器测试使用临时数据库、照片目录和密钥。Node.js 与 Playwright 仅在开发测试时需要；日常运行无需安装它们。

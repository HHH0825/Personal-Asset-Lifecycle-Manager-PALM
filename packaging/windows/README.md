# PALM Windows 安装版

此目录只负责制作 Windows x64 安装包。原有 `app.py`、`启动 PALM.bat`、网页和源码版 `instance` 不会被安装版更改。

## 用户安装与使用

1. 在项目的 GitHub Releases 下载 `PALM-Setup-vX.Y.Z-windows-x64.exe`，运行安装。首次正式安装版计划为 `v1.0.0`。
2. 从开始菜单的 **PALM → 启动 PALM** 打开。终端显示 `http://127.0.0.1:5000`，并尝试自动打开浏览器。关闭终端或按 `Ctrl+C` 即停止服务。端口 5000 被占用时，请先关闭占用它的程序。
3. 安装版的数据存放在 `%LOCALAPPDATA%\PALM\instance`，包括 `palm.sqlite3`、`session.key` 和 `uploads\items`。安装、覆盖升级和卸载均不删除这个目录。需要完整备份时，先停止服务，再一起复制这三部分。

安装版包含 Python 与项目运行依赖，日常使用无需另装 Python、Node.js，也无需联网；需要一款本机浏览器。服务仅监听 `127.0.0.1`，不会发布到公网。首版安装程序未进行代码签名。

## 迁移源码版数据

先关闭旧版和安装版的终端，再从开始菜单选择 **PALM → 迁移旧数据**，在文件夹选择器中选择旧项目中的 `instance` 文件夹。工具验证数据库、密钥及已引用照片，在安装版数据目录旁准备临时副本，并先测试数据库升级。迁移完成后启动安装版，用原账号登录。

如果安装版只有首次启动生成的空数据库，工具会先将其完整移到带 `.pre-import-时间` 后缀的备份目录；如果安装版已有账号、物品、记录或照片，工具会拒绝覆盖。本工具不合并两套数据，也不修改所选的旧目录。取消选择或校验失败时不会替换目标数据。旧版 `session.key` 若不存在，请先从完整备份中找回；仅复制数据库可能导致旧登录会话失效。

也可以在终端运行 `PALM.exe --migrate-from "旧版 instance 的绝对路径"`；这个参数供自动化验收和高级用户使用。

## 本地构建

在 Windows x64 上使用 Python 3.14.3，安装 `requirements-lock.txt` 及 `pyinstaller==6.22.3`，并安装 Inno Setup 6（需要 `ISCC.exe`）。从项目根目录执行：

```powershell
python -m pip install -r requirements-lock.txt "pyinstaller==6.22.3"
./packaging/windows/build.ps1 -Version v1.0.0
```

生成的安装包、SHA-256 文件和中间产物只写入 `packaging/windows/out/`，已由本目录的 `.gitignore` 排除。没有 Inno Setup 时可用 `-BundleOnly` 先构建目录版进行验证。`build.ps1` 从标签参数提取安装包版本，不修改原有源文件。

测试命令：

```powershell
python -m unittest discover -s tests -q
python -m unittest discover -s packaging/windows/tests -p "test_*.py" -q
npm install --no-package-lock
npm run test:modules
$env:PALM_BROWSER_CHANNEL = 'msedge'
npm run test:browser
python packaging/windows/tests/smoke_installed.py --exe packaging/windows/out/bundle/PALM/PALM.exe
```

完整发布流程由新增的 `.github/workflows/palm-windows-release.yml` 完成。将已提交的代码打上 `vX.Y.Z` 标签并推送后，工作流运行测试、构建与安装版冒烟检查，再创建含安装包和校验文件的**草稿 Release**。请检查草稿后手动发布。标签构建只包含该提交，不包含本机未提交文件及 `instance` 数据。

校验下载文件：

```powershell
Get-FileHash -Algorithm SHA256 .\PALM-Setup-v1.0.0-windows-x64.exe
```

将输出与同名 `.sha256` 文件中的哈希值比较。

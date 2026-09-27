## PALM Windows 安装版

下载本次 Release 的 `PALM-Setup-…-windows-x64.exe` 并运行安装。无需单独安装 Python 或 Node.js。安装后从开始菜单的 **PALM → 启动 PALM** 打开，浏览器将访问本机 `http://127.0.0.1:5000`；关闭终端即可停止。

已有源码版数据可从开始菜单的 **迁移旧数据** 入口导入。请先关闭旧版和安装版，再选择旧项目的 `instance` 文件夹。安装版已有用户数据时，迁移会拒绝覆盖。

数据库、密钥和照片保存在 `%LOCALAPPDATA%\PALM\instance`。安装和卸载不会删除个人数据。下载后可用同名 `.sha256` 文件核对安装包完整性。详细步骤见仓库 `packaging/windows/README.md`。

此版本仅供 Windows x64 单机本地使用；安装程序暂未进行代码签名。

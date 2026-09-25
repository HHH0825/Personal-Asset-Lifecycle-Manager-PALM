@echo off
chcp 65001 >nul
setlocal
title PALM 个人物品资产生命周期管理平台

cd /d "%~dp0"
if errorlevel 1 goto directory_error

set "VENV_PY=%CD%\.venv\Scripts\python.exe"
if exist ".venv\" goto check_venv

call :find_python
if errorlevel 1 goto python_error
echo 首次启动：正在创建 Python 虚拟环境...
%BASE_PY% -m venv ".venv"
if errorlevel 1 goto setup_error
set "NEEDS_INSTALL=1"

:check_venv
if not exist "%VENV_PY%" goto venv_error
"%VENV_PY%" -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
if errorlevel 1 goto venv_error
if defined NEEDS_INSTALL goto install_dependencies

rem Compare installed versions with requirements.txt and repair a missing or broken installation.
"%VENV_PY%" -c "import importlib.metadata as m, sys; f=tuple(map(int,m.version('Flask').split('.')[:2])); p=tuple(map(int,m.version('Pillow').split('.')[:2])); sys.exit(0 if (3,1) <= f < (4,0) and (11,0) <= p < (13,0) else 1)" >nul 2>&1
if errorlevel 1 goto install_dependencies
"%VENV_PY%" -m pip check >nul 2>&1
if errorlevel 1 goto install_dependencies
goto launch

:install_dependencies
echo 正在安装或补全项目依赖，首次运行需要联网...
"%VENV_PY%" -m pip install -r requirements.txt
if errorlevel 1 goto install_error

:launch
"%VENV_PY%" -c "import socket, sys; s=socket.socket(); s.settimeout(1); occupied=(s.connect_ex(('127.0.0.1', 5000)) == 0); s.close(); sys.exit(1 if occupied else 0)" >nul 2>&1
if errorlevel 1 goto port_error
echo.
echo PALM 本地访问地址：http://127.0.0.1:5000
echo 在浏览器中打开上方地址。关闭此窗口或按 Ctrl+C 可停止服务。
echo.
"%VENV_PY%" app.py
if errorlevel 1 goto app_error
echo PALM 已停止。
exit /b 0

:find_python
where py >nul 2>&1
if not errorlevel 1 (
    py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
    if not errorlevel 1 (
        set "BASE_PY=py -3"
        exit /b 0
    )
)
where python >nul 2>&1
if not errorlevel 1 (
    python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
    if not errorlevel 1 (
        set "BASE_PY=python"
        exit /b 0
    )
)
exit /b 1

:directory_error
echo 无法进入项目目录。请确认启动脚本位于项目根目录。
goto failed
:python_error
echo 未找到 Python 3.10 或更新版本。请安装 Python 并将其加入 PATH，然后重试。
goto failed
:setup_error
echo 虚拟环境创建失败。请查看上方错误信息后重试。
goto failed
:venv_error
echo .venv 虚拟环境不完整或 Python 版本低于 3.10，请重建该环境后重试。
goto failed
:install_error
echo 依赖安装失败。请检查网络和 requirements.txt，然后重试。
goto failed
:app_error
echo 服务启动失败。请查看上方错误信息，例如 5000 端口是否已被占用。
goto failed
:port_error
echo 5000 端口已被占用。请先关闭占用该端口的程序，再重新启动 PALM。
goto failed
:failed
echo.
pause
exit /b 1

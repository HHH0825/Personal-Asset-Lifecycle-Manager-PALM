# 物物记：真机部署步骤

## 1. 准备

准备小程序 AppID 和 AppSecret、一台能运行 Python 3.10+ 的 Linux 服务器，以及指向该服务器的 HTTPS 域名。微信后台的 request、uploadFile、downloadFile 合法域名均填写该 HTTPS 域名；正式域名须满足微信平台当前要求。仓库不提供共享服务器、域名或密钥。

将整个 `wechat/` 复制到服务器，例如 `/opt/palm-wechat`。不要将本机 `instance/`、`.venv/`、`.env` 或真实 AppSecret 提交到 GitHub。创建独立系统用户，并让它拥有 `wechat/instance/` 的写权限。

## 2. 启动独立服务

以下命令在服务器的 `wechat/` 目录执行：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-lock.txt
.venv/bin/python -m pip install 'gunicorn>=23,<24'
```

将 [环境变量模板](../deploy/palm-wechat.env.example) 复制为 `/etc/palm-wechat.env` 并填入凭证，设置仅管理员可读（例如 `chmod 600`）。将 [systemd 模板](../deploy/palm-wechat.service.example) 中的路径、运行用户替换成自己的值，保存至 `/etc/systemd/system/palm-wechat.service`，然后执行 `sudo systemctl daemon-reload && sudo systemctl enable --now palm-wechat`。模板将服务时区设为 `Asia/Shanghai`，供持有天数、纪念与月报截止日期计算使用；其他地区部署时改为实际时区。生产入口是 `backend/wsgi.py`，它强制关闭开发模拟登录。后端只监听服务器本机 `127.0.0.1:5001`；不要直接将此端口开放到公网。

将 [Nginx 模板](../deploy/nginx.conf.example) 的域名和证书路径换成实际值并启用反向代理。确认 HTTPS 的 `/healthz` 返回 `{ "ok": true }`。证书、域名备案及微信后台配置应按当前平台要求自行核对。

## 3. 配置小程序并上传

在 `miniprogram/project.config.json` 填入自己的 AppID，在 `miniprogram/config.js` 将 `API_BASE` 改为 HTTPS 域名并设 `DEV_LOGIN: false`。真实登录调用 `wx.login`，小程序只传临时 code；服务器凭 AppID 和 AppSecret 调微信接口。用微信开发者工具上传代码，在小程序管理后台设置体验成员并发布体验版。

分别用 Android 和 iPhone 测试登录、相机/相册选图、照片读取、维修记录、处置、回收站及退出登录。测试两个微信账号相互看不到数据。若上传照片失败，检查 Nginx 的请求体大小是否超过 6 MB；模板设为 6 MB。独立测试配置与逐项记录表见 [真机验收](device-check.md)。

## 4. 维护

定期备份 `wechat/instance/palm.sqlite3` 和 `wechat/instance/uploads/`。升级前停止服务并备份整个 `instance/`；部署新代码后再启动。回收站到期清理在启动及打开回收站时执行。开发版与单机网页版之间没有自动代码或数据同步。

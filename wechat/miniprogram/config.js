// 本机模拟器：localhost + DEV_LOGIN。真机请改为已备案的 HTTPS 域名并关闭 DEV_LOGIN。
// backend/dev.py 使用 5001；修改地址后请完整编译，避免沿用旧的编译缓存。
module.exports = {
  API_BASE: 'http://127.0.0.1:5001',
  DEV_LOGIN: true,
  DEV_ACCOUNT: 'student'
}

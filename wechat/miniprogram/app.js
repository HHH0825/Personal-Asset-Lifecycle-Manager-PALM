const config = require('./config')

// 正常本地会话使用 palmSession；临时界面测试须在独立项目中进行。
App({
  globalData: { token: '', expiresAt: 0, user: null },
  onLaunch() {
    const saved = wx.getStorageSync('palmSession')
    if (saved && saved.expiresAt * 1000 > Date.now()) {
      this.globalData = { token: saved.token, expiresAt: saved.expiresAt, user: saved.user }
    } else {
      wx.removeStorageSync('palmSession')
    }
  },
  hasSession() {
    return !!this.globalData.token && this.globalData.expiresAt * 1000 > Date.now()
  },
  requireSession() {
    if (this.hasSession()) return true
    wx.reLaunch({ url: '/pages/login/index' })
    return false
  },
  async login() {
    let code = `dev:${config.DEV_ACCOUNT}`
    if (!config.DEV_LOGIN) {
      const result = await new Promise((resolve, reject) => wx.login({ success: resolve, fail: reject }))
      code = result.code
    }
    const api = require('./utils/api')
    const session = await api.request('/auth/login', { method: 'POST', data: { code }, anonymous: true })
    this.globalData = { token: session.token, expiresAt: session.expires_at, user: session.user }
    wx.setStorageSync('palmSession', this.globalData)
    return session.user
  },
  clearSession() {
    this.globalData = { token: '', expiresAt: 0, user: null }
    wx.removeStorageSync('palmSession')
  },
  updateUser(user, token) {
    if (!this.hasSession() || this.globalData.token !== token) return false
    this.globalData = { ...this.globalData, user }
    wx.setStorageSync('palmSession', this.globalData)
    return true
  }
})

const api = require('../../utils/api')
const view = require('../../utils/view')
const { navigate, resetNavigation } = require('../../utils/navigation')
const { avatarState, avatarError, isCurrent } = require('../../utils/profile')

Page({
  data: { user: null, avatarSymbol: '芽', avatarPath: '', avatarFailed: false, loading: true, error: '' },
  onLoad() { this._sequence = 0 },
  onShow() {
    this._visible = true
    resetNavigation(this)
    if (getApp().requireSession()) this.load()
  },
  onHide() {
    this._visible = false
    this._sequence += 1
    this.setData({ user: null, avatarSymbol: '芽', avatarPath: '', avatarFailed: false, loading: true, error: '' })
  },
  onUnload() { this._visible = false; this._sequence += 1 },
  async load() {
    const sequence = ++this._sequence
    const token = getApp().globalData.token
    this.setData({ loading: true, error: '' })
    try {
      const result = await api.request('/auth/me')
      if (!isCurrent(this, sequence, token)) return
      this.setData({ user: result.user, ...avatarState(result.user), loading: false })
    } catch (error) {
      if (isCurrent(this, sequence, token)) this.setData({ loading: false, error: view.errorMessage(error) })
    }
  },
  avatarError,
  profile() { navigate(this, '/pages/profile/index') },
  keepsakes() { navigate(this, '/pages/keepsakes/index') },
  trash() { navigate(this, '/pages/trash/index') },
  async logout() {
    if (this._loggingOut) return
    this._loggingOut = true
    const token = getApp().globalData.token
    try { await api.request('/auth/logout', { method: 'POST' }) } catch (_) { /* local sign-out still applies */ }
    finally { this._loggingOut = false }
    if (getApp().globalData.token !== token) return
    getApp().clearSession()
    wx.reLaunch({ url: '/pages/login/index' })
  }
})

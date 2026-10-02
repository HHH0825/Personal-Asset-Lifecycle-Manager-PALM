const api = require('../../utils/api')
const view = require('../../utils/view')
const { AVATAR_KEYS, AVATAR_LABELS, avatarState, isCurrent } = require('../../utils/profile')

Page({
  data: { user: null, name: '', avatarSymbol: '芽', avatarLabels: AVATAR_LABELS,
    avatarIndex: 0, loading: true, loaded: false, busy: false, focused: false, error: '' },
  onLoad() { this._sequence = 0 },
  onShow() {
    this._visible = true
    if (getApp().requireSession()) this.load()
  },
  onHide() {
    this._visible = false
    this._sequence += 1
    this.setData({ user: null, name: '', avatarSymbol: '芽', avatarIndex: 0, loading: true,
      loaded: false, busy: false, focused: false, error: '' })
  },
  onUnload() { this._visible = false; this._sequence += 1 },
  async load() {
    if (this.data.busy) return
    const sequence = ++this._sequence
    const token = getApp().globalData.token
    this.setData({ loading: true, loaded: false, error: '' })
    try {
      const result = await api.request('/auth/me')
      if (!isCurrent(this, sequence, token)) return
      this.setData({ user: result.user, name: result.user.username, ...avatarState(result.user),
        loaded: true, loading: false })
    } catch (error) {
      if (isCurrent(this, sequence, token)) this.setData({ loading: false, error: view.errorMessage(error) })
    }
  },
  nameInput(event) { this.setData({ name: event.detail.value }) },
  focus() { this.setData({ focused: true }) },
  blur() { this.setData({ focused: false }) },
  avatarChange(event) {
    const index = Number(event.detail.value)
    if (!AVATAR_KEYS[index]) return
    this.setData(avatarState({ avatar_key: AVATAR_KEYS[index] }))
  },
  async save() {
    if (!this._visible || !this.data.loaded || this.data.loading || this.data.busy) return
    const sequence = ++this._sequence
    const token = getApp().globalData.token
    this.setData({ busy: true, error: '' })
    let saved = false
    try {
      const result = await api.request('/profile', { method: 'PUT', data: {
        username: this.data.name, avatar_key: AVATAR_KEYS[this.data.avatarIndex] } })
      if (!isCurrent(this, sequence, token)) return
      saved = true
      if (!getApp().updateUser(result.user, token)) return
      wx.showToast({ title: '已保存', icon: 'success' })
      this.back()
    } catch (error) {
      if (isCurrent(this, sequence, token)) this.setData({ error: saved
        ? '资料已保存，但本地显示更新失败。返回“我的”可重新读取。' : view.errorMessage(error) })
    } finally {
      if (isCurrent(this, sequence, token)) this.setData({ busy: false })
    }
  },
  back() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/me/index' }) })
    } else wx.switchTab({ url: '/pages/me/index' })
  }
})

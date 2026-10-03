const api = require('../../utils/api')
const { keepsakes } = require('../../utils/collection')
const { errorMessage } = require('../../utils/view')
const { navigate, resetNavigation } = require('../../utils/navigation')
Page({
  data: { entries: [], loading: true, error: '' },
  onLoad() { this._sequence = 0 },
  onShow() { this._visible = true; resetNavigation(this); if (getApp().requireSession()) this.load() },
  onHide() { this._visible = false; this._sequence++; this.setData({ entries: [], loading: true, error: '' }) },
  onUnload() { this._visible = false; this._sequence++ },
  async load() {
    const sequence = ++this._sequence, token = getApp().globalData.token
    const current = () => this._visible && sequence === this._sequence && token === getApp().globalData.token
    this.setData({ loading: true, error: '' })
    try { const items = await api.request('/items'); if (current()) this.setData({ entries: keepsakes(items), loading: false }) }
    catch (error) { if (current()) this.setData({ loading: false, error: errorMessage(error) }) }
  },
  open(e) { navigate(this, '/pages/item/index?id=' + e.currentTarget.dataset.id) }
})

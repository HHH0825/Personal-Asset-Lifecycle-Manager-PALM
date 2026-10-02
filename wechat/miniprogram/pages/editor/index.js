const api = require('../../utils/api')
const view = require('../../utils/view')
const defaults = () => ({ name: '', category: '', icon_type: 'other', purchase_date: view.today(),
  purchase_price: '', warranty_expires_on: '', notes: '', status: 'active' })
Page({
  data: { itemId: 0, today: view.today(), form: defaults(), types: view.TYPE_OPTIONS.map(row => row[1]), typeIndex: 8,
    statuses: ['使用中', '闲置'], statusIndex: 0, photoPath: '', busy: false, loading: false, loadFailed: false, focusField: '', error: '' },
  onLoad(options) { this.itemId = Number(options.id || 0); this.setData({ itemId: this.itemId }); if (getApp().requireSession() && this.itemId) this.load() },
  async load() {
    this.setData({ loading: true, loadFailed: false, error: '' })
    try {
      const item = await api.request(`/items/${this.itemId}`)
      const typeIndex = Math.max(0, view.TYPE_OPTIONS.findIndex(row => row[0] === item.icon_type))
      this.setData({ form: { name: item.name, category: item.category, icon_type: item.icon_type,
        purchase_date: item.purchase_date, purchase_price: item.purchase_price,
        warranty_expires_on: item.warranty_expires_on || '', notes: item.notes,
        status: item.status }, typeIndex, statusIndex: item.status === 'idle' ? 1 : 0 })
    } catch (error) { this.setData({ loadFailed: true, error: view.errorMessage(error) }) }
    finally { this.setData({ loading: false }) }
  },
  input(event) { this.setData({ [`form.${event.currentTarget.dataset.key}`]: event.detail.value }) },
  focus(event) { this.setData({ focusField: event.currentTarget.dataset.key }) },
  blur() { this.setData({ focusField: '' }) },
  typeChange(event) { const index = Number(event.detail.value); this.setData({ typeIndex: index, 'form.icon_type': view.TYPE_OPTIONS[index][0] }) },
  statusChange(event) { const index = Number(event.detail.value); this.setData({ statusIndex: index, 'form.status': index ? 'idle' : 'active' }) },
  clearWarranty() { this.setData({ 'form.warranty_expires_on': '' }) },
  choosePhoto() {
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'],
      success: result => this.setData({ photoPath: result.tempFiles[0].tempFilePath }) })
  },
  async save() {
    if (this.data.busy || this.data.loading || this.data.loadFailed) return
    this.setData({ busy: true, error: '' })
    try {
      const form = this.data.form
      const payload = { ...form, warranty_expires_on: form.warranty_expires_on || null }
      const item = this.itemId
        ? await api.request(`/items/${this.itemId}`, { method: 'PUT', data: payload })
        : await api.request('/items', { method: 'POST', data: payload })
      if (this.data.photoPath) {
        try { await api.uploadPhoto(item.id, this.data.photoPath) }
        catch (error) {
          await new Promise(resolve => wx.showModal({ title: '物品已保存', content: `照片上传失败：${view.errorMessage(error)}。可进入详情后重新编辑上传。`, showCancel: false, complete: resolve }))
        }
      }
      wx.navigateBack()
    } catch (error) { this.setData({ error: view.errorMessage(error) }) }
    finally { this.setData({ busy: false }) }
  }
})

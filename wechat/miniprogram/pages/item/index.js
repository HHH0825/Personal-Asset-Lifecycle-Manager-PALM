const api = require('../../utils/api')
const view = require('../../utils/view')
Page({
  data: { item: null, timeline: [], photoPath: '', loading: true, busy: false, error: '' },
  onLoad(options) { this.itemId = Number(options.id); this._sequence = 0 },
  onShow() { this._visible = true; if (getApp().requireSession() && this.itemId) this.load() },
  onHide() { this._visible = false; this._sequence += 1; this.setData({ photoPath: '', item: null, timeline: [] }) },
  onUnload() { this._visible = false; this._sequence += 1 },
  async load() {
    const id = this.itemId
    const sequence = ++this._sequence
    this.setData({ loading: true, error: '', photoPath: '' })
    try {
      const raw = await api.request(`/items/${id}`)
      if (sequence !== this._sequence || !this._visible) return
      const item = view.decorate(raw)
      const timeline = [
        ...item.usage_records.map(r => ({ ...r, kind: 'usage', kindText: '使用', day: r.used_on, text: r.notes || '记录了一次使用' })),
        ...item.maintenance_records.map(r => ({ ...r, kind: 'maintenance', kindText: '维修', day: r.maintained_on, text: `${r.description} · ¥${r.cost}` })),
        ...(item.disposal ? [{ ...item.disposal, kind: 'disposal', kindText: '处置', day: item.disposal.disposed_on,
          text: `${view.METHODS[item.disposal.method]} · 回收 ¥${item.disposal.proceeds}` }] : [])
      ].sort((a, b) => b.day.localeCompare(a.day) || b.id - a.id).map(entry => ({ ...entry, key: `${entry.kind}-${entry.id}` }))
      this.setData({ item, timeline, loading: false })
      if (item.photo_url) api.downloadPhoto(id).then(photoPath => {
        if (sequence === this._sequence && this._visible) this.setData({ photoPath })
      }).catch(() => {})
    } catch (error) { if (sequence === this._sequence && this._visible) this.setData({ loading: false, error: view.errorMessage(error), item: null }) }
  },
  edit() { wx.navigateTo({ url: `/pages/editor/index?id=${this.itemId}` }) },
  photoFailed() { this.setData({ photoPath: '' }) },
  record(event) { wx.navigateTo({ url: `/pages/record/index?itemId=${this.itemId}&kind=${event.currentTarget.dataset.kind}` }) },
  editRecord(event) {
    const record = this.data.timeline.find(r => r.id === Number(event.currentTarget.dataset.id) && r.kind === event.currentTarget.dataset.kind)
    if (record) wx.navigateTo({ url: `/pages/record/index?itemId=${this.itemId}&kind=${record.kind}&id=${record.id}` })
  },
  async quickUse() {
    if (this.data.busy) return
    this.setData({ busy: true })
    try {
      const result = await api.request(`/items/${this.itemId}/usage/today`, { method: 'POST' })
      wx.showToast({ title: result.created ? '已记录今天使用' : '今天已记录', icon: 'none' }); await this.load()
    } catch (error) { wx.showToast({ title: view.errorMessage(error), icon: 'none' }) }
    finally { this.setData({ busy: false }) }
  },
  async togglePin() {
    try { await api.request(`/items/${this.itemId}/pin`, { method: 'PUT', data: { is_pinned: !this.data.item.is_pinned } }); await this.load() }
    catch (error) { wx.showToast({ title: view.errorMessage(error), icon: 'none' }) }
  },
  async removePhoto() {
    const confirm = await new Promise(resolve => wx.showModal({ title: '移除照片？', success: result => resolve(result.confirm) }))
    if (!confirm) return
    try { await api.request(`/items/${this.itemId}/photo`, { method: 'DELETE' }); await this.load() }
    catch (error) { wx.showToast({ title: view.errorMessage(error), icon: 'none' }) }
  },
  async remove() {
    const confirm = await new Promise(resolve => wx.showModal({ title: '移入回收站？', content: '30 天内可在“我的”中恢复。', success: result => resolve(result.confirm) }))
    if (!confirm) return
    try { await api.request(`/items/${this.itemId}`, { method: 'DELETE' }); wx.showToast({ title: '已移入回收站' }); wx.navigateBack() }
    catch (error) { wx.showToast({ title: view.errorMessage(error), icon: 'none' }) }
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) }
})

const api = require('../../utils/api')
const view = require('../../utils/view')
const { navigate, resetNavigation } = require('../../utils/navigation')
Page({
  data: { item: null, timeline: [], photoPath: '', loading: true, busy: false, error: '', stamps: [], allStamps: [], expanded: false, targetEditing: false, targetInput: '', targetBusy: false, targetError: '' },
  onLoad(options) { this.itemId = Number(options.id); this._sequence = 0 },
  onShow() { this._visible = true; resetNavigation(this); if (getApp().requireSession() && this.itemId) this.load() },
  onHide() { this._visible = false; this._sequence += 1; this.setData({ photoPath: '', item: null, timeline: [], stamps: [], allStamps: [], targetEditing: false, targetInput: '', targetError: '', targetBusy: false }) },
  onUnload() { this._visible = false; this._sequence += 1 },
  async load() {
    const id = this.itemId
    const sequence = ++this._sequence, token = getApp().globalData.token
    this.setData({ loading: true, error: '', photoPath: '', artFailed: false })
    try {
      const raw = await api.request(`/items/${id}`)
      if (sequence !== this._sequence || !this._visible || token !== getApp().globalData.token) return
      const item = view.decorate(raw)
      const timeline = [
        ...item.usage_records.map(r => ({ ...r, kind: 'usage', kindText: '使用', day: r.used_on, text: r.notes || '记录了一次使用' })),
        ...item.maintenance_records.map(r => ({ ...r, kind: 'maintenance', kindText: '维修', day: r.maintained_on, text: `${r.description} · ¥${r.cost}` })),
        ...(item.disposal ? [{ ...item.disposal, kind: 'disposal', kindText: '处置', day: item.disposal.disposed_on,
          text: `${view.METHODS[item.disposal.method]} · 回收 ¥${item.disposal.proceeds}` }] : [])
      ].sort((a, b) => b.day.localeCompare(a.day) || b.id - a.id).map(entry => ({ ...entry, key: `${entry.kind}-${entry.id}` }))
      const allStamps = [...item.milestones.earned].reverse()
      this.setData({ item, timeline, loading: false, allStamps, stamps: this.data.expanded ? allStamps : allStamps.slice(0, 3) })
      if (item.photo_url) api.downloadPhoto(id).then(photoPath => {
        if (sequence === this._sequence && this._visible && token === getApp().globalData.token) this.setData({ photoPath })
      }).catch(() => {})
    } catch (error) { if (sequence === this._sequence && this._visible && token === getApp().globalData.token) this.setData({ loading: false, error: view.errorMessage(error), item: null }) }
  },
  edit() { navigate(this, `/pages/editor/index?id=${this.itemId}`) },
  photoFailed() { this.setData({ photoPath: '' }) },
  artFailed() { this.setData({ artFailed: true }) },
  toggleStamps() { const expanded = !this.data.expanded; this.setData({ expanded, stamps: expanded ? this.data.allStamps : this.data.allStamps.slice(0, 3) }) },
  editTarget() { this.setData({ targetEditing: true, targetError: '', targetInput: this.data.item.daily_target ? this.data.item.daily_target.amount : '' }) },
  targetInput(e) { this.setData({ targetInput: e.detail.value, targetError: '' }) },
  closeTarget() { if (!this.data.targetBusy) this.setData({ targetEditing: false, targetError: '' }) },
  saveTarget() { return this.writeTarget(this.data.targetInput.trim()) },
  cancelTarget() { return this.writeTarget(null) },
  async writeTarget(amount) {
    if (this.data.targetBusy || !this.data.item || this.data.item.status === 'disposed' || !getApp().requireSession()) return
    if (amount !== null && (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0)) {
      this.setData({ targetError: '请填写大于 0、最多两位小数的金额' }); return
    }
    const sequence = this._sequence, token = getApp().globalData.token
    const current = () => this._visible && sequence === this._sequence && token === getApp().globalData.token
    this.setData({ targetBusy: true, targetError: '' })
    try {
      const raw = await api.request(`/items/${this.itemId}/daily-target`, { method: 'PUT', data: { amount } })
      if (current()) this.setData({ item: view.decorate(raw), targetEditing: false, targetInput: '' })
    } catch (error) { if (current()) this.setData({ targetError: view.errorMessage(error) }) }
    finally { if (current()) this.setData({ targetBusy: false }) }
  },
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

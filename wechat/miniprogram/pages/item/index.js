const api = require('../../utils/api')
const view = require('../../utils/view')
const { navigate, resetNavigation } = require('../../utils/navigation')
Page({
  data: { item: null, timeline: [], allTimeline: [], photoPath: '', photoLoading: false, photoError: false, loading: true, busy: false, error: '', stamps: [], allStamps: [], expanded: false,
    factsExpanded: false, timelineExpanded: false, historyExpanded: false, historyUsage: [], targetEditing: false, targetInput: '', targetBusy: false, targetError: '' },
  onLoad(options) { this.itemId = Number(options.id); this._sequence = 0; this._token = getApp().globalData.token; this._scrollTop = 0; this._photoOwner = {}; this._photos = api.photoCache(); this._photoRead = 0 },
  onShow() {
    this._visible = true; resetNavigation(this)
    if (this._token !== getApp().globalData.token) {
      this._token = getApp().globalData.token; this._returnScroll = null; this._scrollTop = 0
      this.setData({ item: null, photoPath: '', timeline: [], allTimeline: [], stamps: [], allStamps: [],
        expanded: false, factsExpanded: false, timelineExpanded: false, historyExpanded: false, historyUsage: [], targetEditing: false })
    }
    if (getApp().requireSession() && this.itemId) this.load()
  },
  onPageScroll(event) { this._scrollTop = event.scrollTop },
  onHide() { this._returnScroll = this._scrollTop; this._visible = false; this._sequence += 1; this._photos.release(this._photoOwner); this._mutation = null; this.setData({ photoPath: '', photoLoading: false, photoError: false, targetEditing: false, targetInput: '', targetError: '', targetBusy: false, busy: false }) },
  onUnload() { this._visible = false; this._sequence += 1; this._photos.release(this._photoOwner) },
  async load() {
    const id = this.itemId
    const sequence = ++this._sequence, token = getApp().globalData.token
    this._photos.release(this._photoOwner)
    this.setData({ loading: !this.data.item, error: '', photoLoading: false, photoError: false, artFailed: false })
    try {
      const raw = await api.request(`/items/${id}`)
      if (sequence !== this._sequence || !this._visible || token !== getApp().globalData.token) return
      const item = view.decorate(raw)
      this._photos.sync([item])
      if (!this.data.item || this.data.item.photo_version !== item.photo_version || !item.photo_url) this.setData({ photoPath: '' })
      const timeline = [
        ...item.maintenance_records.map(r => ({ ...r, kind: 'maintenance', kindText: '维修', day: r.maintained_on, text: `${r.description} · ¥${r.cost}` })),
        ...(item.disposal ? [{ ...item.disposal, kind: 'disposal', kindText: '处置', day: item.disposal.disposed_on,
          text: `${view.METHODS[item.disposal.method]} · 回收 ¥${item.disposal.proceeds}` }] : [])
      ].sort((a, b) => b.day.localeCompare(a.day) || b.id - a.id).map(entry => ({ ...entry, key: `${entry.kind}-${entry.id}` }))
      const allStamps = [...item.milestones.earned].reverse()
      const historyUsage = (item.usage_records || []).slice().sort((a, b) => b.used_on.localeCompare(a.used_on) || b.id - a.id)
      this.setData({ item, historyUsage, allTimeline: timeline, timeline: this.data.timelineExpanded ? timeline : timeline.slice(0, 3), loading: false,
        allStamps, stamps: this.data.expanded ? allStamps : allStamps.slice(0, 1) }, () => this.restoreScroll(sequence, token))
      if (item.photo_url) this.readPhoto()
    } catch (error) {
      if (sequence === this._sequence && this._visible && token === getApp().globalData.token) {
        this.setData({ loading: false, error: view.errorMessage(error), ...(error.status ? { item: null, photoPath: '' } : {}) })
      }
    }
  },
  restoreScroll(sequence, token) {
    if (this._returnScroll == null || !wx.pageScrollTo) return
    const top = this._returnScroll; this._returnScroll = null
    const restore = rect => {
      if (!this._visible || sequence !== this._sequence || token !== getApp().globalData.token) return
      let height
      try { height = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).windowHeight } catch (_) {}
      // Native scrolling also clamps to the page when measurement is unavailable.
      const limit = rect && Number.isFinite(height) ? rect.height - height : top
      wx.pageScrollTo({ scrollTop: Math.max(0, Math.min(top, limit)), duration: 0 })
    }
    try {
      if (wx.createSelectorQuery) wx.createSelectorQuery().in(this).select('.detail-page').boundingClientRect(restore).exec()
      else restore(null)
    } catch (_) { restore(null) }
  },
  edit() { navigate(this, `/pages/editor/index?id=${this.itemId}`) },
  async readPhoto() {
    if (!this._visible || !this.data.item || !this.data.item.photo_url || this.data.photoLoading) return
    const item = this.data.item, sequence = this._sequence, token = getApp().globalData.token, read = ++this._photoRead
    const current = () => this._visible && sequence === this._sequence && read === this._photoRead && token === getApp().globalData.token
    this.setData({ photoLoading: true, photoError: false })
    let fullReady = false
    this._photos.peek(item).then(path => { if (path && !fullReady && current()) this.setData({ photoPath: path }) }).catch(() => {})
    try {
      const path = await this._photos.load(item, this._photoOwner, 'full')
      fullReady = true
      if (current()) this.setData({ photoPath: path })
    } catch (error) { if (!error.cancelled && current()) this.setData({ photoError: true }) }
    finally { if (current()) this.setData({ photoLoading: false }) }
  },
  retryPhoto() { return this.readPhoto() },
  photoFailed() {
    this._photoRead++; this._photos.release(this._photoOwner); this._photos.invalidate(this.itemId)
    this.setData({ photoPath: '', photoLoading: false, photoError: true })
  },
  artFailed() { this.setData({ artFailed: true }) },
  toggleStamps() { const expanded = !this.data.expanded; this.setData({ expanded, stamps: expanded ? this.data.allStamps : this.data.allStamps.slice(0, 1) }) },
  toggleFacts() { this.setData({ factsExpanded: !this.data.factsExpanded }) },
  toggleHistory() { this.setData({ historyExpanded: !this.data.historyExpanded }) },
  toggleTimeline() { const timelineExpanded = !this.data.timelineExpanded; this.setData({ timelineExpanded, timeline: timelineExpanded ? this.data.allTimeline : this.data.allTimeline.slice(0, 3) }) },
  editTarget() { this.setData({ targetEditing: true, targetError: '', targetInput: this.data.item.daily_target ? this.data.item.daily_target.amount : '' }) },
  targetInput(e) { this.setData({ targetInput: e.detail.value, targetError: '' }) },
  closeTarget() { if (!this.data.targetBusy) this.setData({ targetEditing: false, targetError: '' }) },
  saveTarget() { return this.writeTarget(this.data.targetInput.trim()) },
  cancelTarget() { return this.writeTarget(null) },
  async writeTarget(amount) {
    if (this.data.targetBusy || this.data.busy || !this._visible || !this.data.item || this.data.item.status === 'disposed' || !getApp().requireSession()) return
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
  record(event) {
    const kind = event.currentTarget.dataset.kind
    if (['maintenance', 'disposal'].includes(kind)) navigate(this, `/pages/record/index?itemId=${this.itemId}&kind=${kind}`)
  },
  editRecord(event) {
    const record = this.data.allTimeline.find(r => r.id === Number(event.currentTarget.dataset.id) && r.kind === event.currentTarget.dataset.kind)
    if (record) navigate(this, `/pages/record/index?itemId=${this.itemId}&kind=${record.kind}&id=${record.id}`)
  },
  async togglePin() {
    return this.mutate(() => api.request(`/items/${this.itemId}/pin`, { method: 'PUT', data: { is_pinned: !this.data.item.is_pinned } }))
  },
  async more() {
    if (this.data.busy || this.data.targetBusy || !this._visible || !this.data.item) return
    const token = getApp().globalData.token, sequence = this._sequence
    const actions = [{ text: this.data.item.is_pinned ? '取消置顶' : '置顶', method: 'togglePin' }]
    if (this.data.item.photo_url) actions.push({ text: '移除照片', method: 'removePhoto' })
    actions.push({ text: '移入回收站', method: 'remove' })
    try {
      const result = await new Promise((resolve, reject) => wx.showActionSheet({ itemList: actions.map(row => row.text), itemColor: '#493B35', success: resolve, fail: reject }))
      if (this._visible && sequence === this._sequence && token === getApp().globalData.token && actions[result.tapIndex]) return this[actions[result.tapIndex].method]()
    } catch (_) { /* Dismissal leaves the item unchanged. */ }
  },
  async mutate(action, after, confirm) {
    if (this.data.busy || this.data.targetBusy || !this._visible || !this.data.item || !getApp().requireSession()) return
    const token = getApp().globalData.token, sequence = this._sequence
    const attempt = {}; this._mutation = attempt
    const current = () => this._mutation === attempt && this._visible && token === getApp().globalData.token && sequence === this._sequence
    this.setData({ busy: true })
    try {
      if (confirm) {
        const agreed = await new Promise(resolve => wx.showModal({ ...confirm, success: result => resolve(result.confirm), fail: () => resolve(false) }))
        if (!agreed || !current()) return
      }
      const result = await action()
      if (!current()) return
      if (after) after(result)
      if (!confirm || !confirm.leavesPage) await this.load()
    } catch (error) { if (current()) wx.showToast({ title: view.errorMessage(error), icon: 'none' }) }
    finally { if (this._mutation === attempt && this._visible && token === getApp().globalData.token) { this._mutation = null; this.setData({ busy: false }) } }
  },
  async removePhoto() {
    return this.mutate(() => api.request(`/items/${this.itemId}/photo`, { method: 'DELETE' }), null, { title: '移除照片？' })
  },
  async remove() {
    return this.mutate(() => api.request(`/items/${this.itemId}`, { method: 'DELETE' }), () => {
      wx.showToast({ title: '已移入回收站' }); wx.navigateBack()
    }, { title: '移入回收站？', content: '30 天内可在“我的”中恢复。', leavesPage: true })
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) }
})

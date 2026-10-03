const api = require('../../utils/api')
const view = require('../../utils/view')
const collection = require('../../utils/collection')
const { navigate, resetNavigation } = require('../../utils/navigation')
const { createThumbnailLoader } = require('../../utils/thumbnails')
const initial = () => ({ items: [], shown: [], query: '', status: '', statusIndex: 0, category: '', categoryIndex: 0,
  categories: ['全部分类'], layout: 'list', sortIndex: 0, sortOptions: collection.SORTS, photoPaths: {}, artErrors: {}, pending: {},
  statusOptions: ['全部状态', '使用中', '闲置', '已处置'], loading: true, error: '' })
Page({
  data: initial(),
  onLoad() {
    this._sequence = 0; this._scroll = 0; this._anchor = null
    this._photos = createThumbnailLoader({ download: api.downloadPhoto, getSession: () => getApp().globalData.token })
  },
  onShow() {
    this._visible = true; resetNavigation(this)
    if (!getApp().requireSession()) return
    const token = getApp().globalData.token
    if (this._token !== token) {
      this._token = token; this._scroll = 0; this._anchor = null
      this.setData({ ...initial(), ...collection.preferences(getApp().globalData.user) })
    }
    this.load()
  },
  onPageScroll(e) { this._scroll = e.scrollTop },
  onHide() {
    this._visible = false; this._sequence++; this.disconnectPhotos(); this._photos.reset()
    this.setData({ photoPaths: {}, items: [], shown: [], pending: {} })
  },
  onUnload() { this._visible = false; this._sequence++; this.disconnectPhotos(); this._photos.dispose() },
  current(seq, token) { return seq === this._sequence && this._visible && getApp().globalData.token === token },
  disconnectPhotos() { if (this._observer) this._observer.disconnect(); this._observer = null },
  async load() {
    const seq = ++this._sequence, token = getApp().globalData.token
    this.disconnectPhotos(); this._photos.reset()
    this.setData({ loading: true, error: '', photoPaths: {}, artErrors: {} })
    try {
      const items = await api.request('/items')
      if (!this.current(seq, token)) return
      const categories = ['全部分类', ...new Set(items.map(i => i.category).sort())]
      const category = categories.includes(this.data.category) ? this.data.category : ''
      this.setData({ items: items.map(i => ({ ...view.decorate(i), art: collection.art(i.icon_type) })),
        categories, category, categoryIndex: category ? categories.indexOf(category) : 0, loading: false })
      this.apply(true)
    } catch (error) { if (this.current(seq, token)) this.setData({ loading: false, error: view.errorMessage(error) }) }
  },
  apply(restore = false) {
    const seq = this._sequence, token = getApp().globalData.token
    this.disconnectPhotos()
    this.setData({ shown: collection.select(this.data.items, this.data.query, this.data.status, this.data.category, this.data.sortIndex) }, () => {
      if (!this.current(seq, token)) return
      this.observePhotos(); if (restore) this.restorePosition()
    })
  },
  rememberPosition(done) {
    if (!wx.createSelectorQuery) { if (done) done(); return }
    const seq = this._sequence, token = getApp().globalData.token
    wx.createSelectorQuery().in(this).selectAll('.item-card').boundingClientRect(rects => {
      if (!this.current(seq, token)) return
      const first = (rects || []).find(r => r.bottom > 0)
      this._anchor = first ? { id: first.dataset.id, offset: first.top,
        index: this.data.shown.findIndex(i => i.id === Number(first.dataset.id)) } : null
      if (done) done()
    }).exec()
  },
  restorePosition() {
    if (!wx.createSelectorQuery || !wx.pageScrollTo) return
    const seq = this._sequence, token = getApp().globalData.token, anchor = this._anchor
    const id = anchor && (this.data.shown.some(i => i.id === Number(anchor.id)) ? anchor.id :
      (this.data.shown[Math.min(anchor.index, this.data.shown.length - 1)] || {}).id)
    const q = wx.createSelectorQuery().in(this)
    q.select(id ? '#item-' + id : '.page').boundingClientRect()
    q.selectViewport().scrollOffset()
    q.exec(results => {
      if (!this.current(seq, token)) return
      const rect = results && results[0], viewport = results && results[1]
      const top = id && rect && viewport ? viewport.scrollTop + rect.top - anchor.offset : this._scroll
      wx.pageScrollTo({ scrollTop: Math.max(0, top || 0), duration: 0 })
    })
  },
  observePhotos() {
    this.disconnectPhotos()
    if (!this._visible || !wx.createIntersectionObserver || !this.data.shown.some(i => i.photo_url)) return
    const seq = this._sequence, token = getApp().globalData.token
    this._observer = wx.createIntersectionObserver(this, { observeAll: true })
    this._observer.relativeToViewport().observe('.photo-target', e => {
      if (e.intersectionRatio <= 0 || !this.current(seq, token)) return
      const id = Number(e.dataset.id)
      if (!id || this.data.photoPaths[id]) return
      this._photos.load(id).then(path => {
        if (path && this.current(seq, token)) this.setData({ photoPaths: { ...this.data.photoPaths, [id]: path } })
      })
    })
  },
  photoFailed(e) { const paths = { ...this.data.photoPaths }; delete paths[e.currentTarget.dataset.id]; this.setData({ photoPaths: paths }) },
  artFailed(e) { this.setData({ ['artErrors.' + e.currentTarget.dataset.id]: true }) },
  search(e) { this._anchor = null; this._scroll = 0; this.setData({ query: e.detail.value }); this.apply() },
  statusChange(e) { const index = Number(e.detail.value); this._anchor = null; this._scroll = 0; this.setData({ statusIndex: index, status: ['', 'active', 'idle', 'disposed'][index] }); this.apply() },
  categoryChange(e) { const index = Number(e.detail.value); this._anchor = null; this._scroll = 0; this.setData({ categoryIndex: index, category: index ? this.data.categories[index] : '' }); this.apply() },
  clearFilters() { this._anchor = null; this._scroll = 0; this.setData({ query: '', status: '', statusIndex: 0, category: '', categoryIndex: 0 }); this.apply() },
  sortChange(e) { this.setData({ sortIndex: Number(e.detail.value) }); collection.savePreferences(getApp().globalData.user, this.data); this._anchor = null; this._scroll = 0; this.apply() },
  changeLayout(e) {
    const layout = e.currentTarget.dataset.layout
    if (layout === this.data.layout) return
    this.rememberPosition(() => {
      this.setData({ layout }, () => { this.observePhotos(); this.restorePosition() })
      collection.savePreferences(getApp().globalData.user, this.data)
    })
  },
  open(e) { const id = e.currentTarget.dataset.id; this.rememberPosition(() => navigate(this, '/pages/item/index?id=' + id)) },
  add() { this.rememberPosition(() => navigate(this, '/pages/editor/index')) },
  async quickUse(e) {
    const id = Number(e.currentTarget.dataset.id), item = this.data.items.find(i => i.id === id)
    if (!item || item.status === 'disposed' || item.used_today || this.data.pending[id] || !getApp().requireSession()) return
    const seq = this._sequence, token = getApp().globalData.token
    this.setData({ ['pending.' + id]: true })
    try {
      const result = await api.request('/items/' + id + '/usage/today', { method: 'POST' })
      if (!this.current(seq, token)) return
      this.setData({ items: this.data.items.map(row => row.id === id ? { ...row, used_today: true,
        usage_count: row.usage_count + (result.created ? 1 : 0) } : row) })
      this.apply(); wx.showToast({ title: result.created ? '已记录今天使用' : '今天已记录', icon: 'none' })
    } catch (error) { if (this.current(seq, token)) wx.showToast({ title: view.errorMessage(error), icon: 'none' }) }
    finally { if (this.current(seq, token)) this.setData({ ['pending.' + id]: false }) }
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) }
})

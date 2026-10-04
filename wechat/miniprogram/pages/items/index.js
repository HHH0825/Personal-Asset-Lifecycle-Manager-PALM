const api = require('../../utils/api')
const view = require('../../utils/view')
const collection = require('../../utils/collection')
const { navigate, resetNavigation } = require('../../utils/navigation')
const initial = () => ({ items: [], shown: [], query: '', status: '', statusIndex: 0, category: '', categoryIndex: 0,
  categories: ['全部分类'], layout: 'list', sortIndex: 0, sortOptions: collection.SORTS, photoPaths: {}, photoStates: {}, artErrors: {},
  statusOptions: ['全部状态', '使用中', '闲置', '已处置'], loading: true, error: '' })
Page({
  data: initial(),
  onLoad() {
    this._sequence = 0; this._scroll = 0; this._anchor = null
    this._photoOwner = {}; this._photos = api.photoCache()
  },
  onShow() {
    this._visible = true; resetNavigation(this)
    if (!getApp().requireSession()) { this.setData(initial()); return }
    const token = getApp().globalData.token
    if (this._token !== token) {
      this._token = token; this._scroll = 0; this._anchor = null
      this.setData({ ...initial(), ...collection.preferences(getApp().globalData.user) })
    }
    this.load()
  },
  onPageScroll(e) { this._scroll = e.scrollTop },
  onHide() {
    this._visible = false; this._sequence++; this.disconnectPhotos(); this._photos.release(this._photoOwner)
    const photoStates = Object.fromEntries(Object.entries(this.data.photoStates).filter(([, state]) => state !== 'loading'))
    this.setData(getApp().globalData.token === this._token ? { photoStates } : initial())
  },
  onUnload() { this._visible = false; this._sequence++; this.disconnectPhotos(); this._photos.release(this._photoOwner) },
  current(seq, token) { return seq === this._sequence && this._visible && getApp().globalData.token === token },
  disconnectPhotos() {
    if (this._observer) this._observer.disconnect()
    if (this._nearObserver) this._nearObserver.disconnect()
    this._observer = null; this._nearObserver = null
  },
  async load() {
    const seq = ++this._sequence, token = getApp().globalData.token
    this._validatedPhotos = new Set()
    this.disconnectPhotos(); this._photos.release(this._photoOwner)
    this.setData({ loading: !this.data.items.length, error: '',
      photoStates: Object.fromEntries(Object.entries(this.data.photoStates).filter(([, state]) => state !== 'loading')) })
    try {
      const items = await api.request('/items')
      if (!this.current(seq, token)) return
      this._photos.sync(items, true)
      const retained = items.filter(item => item.photo_url && this.data.items.some(old => old.id === item.id && old.photo_version === item.photo_version))
      const photoPaths = Object.fromEntries(retained.filter(item => this.data.photoPaths[item.id]).map(item => [item.id, this.data.photoPaths[item.id]]))
      const photoStates = Object.fromEntries(retained.filter(item => this.data.photoStates[item.id] && this.data.photoStates[item.id] !== 'loading').map(item => [item.id, this.data.photoStates[item.id]]))
      const categories = ['全部分类', ...new Set(items.map(i => i.category).sort())]
      const category = categories.includes(this.data.category) ? this.data.category : ''
      this.setData({ items: items.map(i => ({ ...view.decorate(i), art: collection.art(i.icon_type) })),
        categories, category, categoryIndex: category ? categories.indexOf(category) : 0, loading: false, photoPaths, photoStates, artErrors: {} })
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
    const attempt = {}; this._positionAttempt = attempt
    let finished = false
    const finish = rects => {
      if (finished) return
      finished = true; clearTimeout(timer)
      if (this._positionAttempt !== attempt || !this.current(seq, token)) return
      const first = (rects || []).find(r => r.bottom > 0)
      const id = first && (first.dataset && first.dataset.id || (String(first.id || '').match(/^item-(\d+)$/) || [])[1])
      if (id) this._anchor = { id, offset: first.top, index: this.data.shown.findIndex(i => i.id === Number(id)) }
      if (done) done()
    }
    // Position measurement is optional; a stalled renderer must not block navigation.
    const timer = setTimeout(() => finish(), 150)
    try { wx.createSelectorQuery().in(this).selectAll('.item-card').boundingClientRect(finish).exec() }
    catch (_) { finish() }
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
    this._photos.release(this._photoOwner)
    const photoStates = Object.fromEntries(Object.entries(this.data.photoStates).filter(([, state]) => state !== 'loading'))
    this.setData({ photoStates })
    if (!this._visible || !wx.createIntersectionObserver || !this.data.shown.some(i => i.photo_url)) return
    const seq = this._sequence, token = getApp().globalData.token
    this._observer = wx.createIntersectionObserver(this, { observeAll: true })
    this._observer.relativeToViewport().observe('.photo-target', e => {
      if (e.intersectionRatio <= 0 || !this.current(seq, token)) return
      this.readPhoto(Number(e.dataset.id), 0)
    })
    let height = 700
    try { height = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).windowHeight || height } catch (_) {}
    this._nearObserver = wx.createIntersectionObserver(this, { observeAll: true })
    this._nearObserver.relativeToViewport({ bottom: height }).observe('.photo-target', e => {
      if (e.intersectionRatio > 0 && this.current(seq, token)) this.readPhoto(Number(e.dataset.id), 1)
    })
  },
  readPhoto(id, priority = 0, retry = false) {
    const item = this.data.shown.find(row => row.id === id)
    if (!item || !item.photo_url || !this._visible) return
    if (this.data.photoStates[id] === 'loading') { if (!priority) this._photos.promote(id, this._photoOwner); return }
    if (!retry && this.data.photoStates[id] === 'error') return
    if (!retry && this.data.photoPaths[id]) {
      if (this._validatedPhotos && this._validatedPhotos.has(id)) return
      if (!this._validatedPhotos) this._validatedPhotos = new Set()
      this._validatedPhotos.add(id)
      const seq = this._sequence, token = getApp().globalData.token
      this._photos.peek(item).then(path => {
        if (!path && this.current(seq, token)) {
          this.setData({ ['photoPaths.' + id]: '', ['photoStates.' + id]: '' })
          this.readPhoto(id, priority)
        }
      }).catch(() => {})
      return
    }
    const seq = this._sequence, token = getApp().globalData.token
    this.setData({ ['photoStates.' + id]: 'loading' })
    this._photos.load(item, this._photoOwner, 'thumb', priority).then(path => {
      if (this.current(seq, token)) this.setData({ ['photoPaths.' + id]: path, ['photoStates.' + id]: 'ready' })
    }).catch(error => {
      if (!error.cancelled && this.current(seq, token)) this.setData({ ['photoStates.' + id]: 'error' })
    })
  },
  retryPhoto(e) { this.readPhoto(Number(e.currentTarget.dataset.id), 0, true) },
  photoFailed(e) {
    const id = Number(e.currentTarget.dataset.id)
    this._photos.invalidate(id)
    this.setData({ ['photoPaths.' + id]: '', ['photoStates.' + id]: 'error' })
  },
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
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) }
})

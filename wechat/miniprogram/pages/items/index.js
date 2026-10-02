const api = require('../../utils/api')
const view = require('../../utils/view')
const { createThumbnailLoader } = require('../../utils/thumbnails')

Page({
  data: { items: [], shown: [], query: '', status: '', statusIndex: 0, photoPaths: {},
    statusOptions: ['全部状态', '使用中', '闲置', '已处置'], loading: true, error: '' },
  onLoad() {
    this._sequence = 0
    this._photos = createThumbnailLoader({ download: api.downloadPhoto, getSession: () => getApp().globalData.token })
  },
  onShow() { this._visible = true; if (getApp().requireSession()) this.load() },
  onHide() {
    this._visible = false
    this._sequence += 1
    this.disconnectPhotos()
    this._photos.reset()
    this.setData({ photoPaths: {}, items: [], shown: [] })
  },
  onUnload() { this.disconnectPhotos(); this._photos.dispose() },
  disconnectPhotos() { if (this._observer) this._observer.disconnect(); this._observer = null },
  async load() {
    const sequence = ++this._sequence
    this.disconnectPhotos()
    this._photos.reset()
    this.setData({ loading: true, error: '', photoPaths: {} })
    try {
      const items = await api.request('/items')
      if (sequence !== this._sequence || !this._visible) return
      this.setData({ items: items.map(view.decorate), loading: false })
      this.apply()
    } catch (error) {
      if (sequence === this._sequence && this._visible) this.setData({ loading: false, error: view.errorMessage(error) })
    }
  },
  apply() {
    this.disconnectPhotos()
    this.setData({ shown: view.filterItems(this.data.items, this.data.query, this.data.status) }, () => this.observePhotos())
  },
  observePhotos() {
    if (!this._visible || !wx.createIntersectionObserver || !this.data.shown.some(item => item.photo_url)) return
    const sequence = this._sequence
    this._observer = wx.createIntersectionObserver(this, { observeAll: true })
    this._observer.relativeToViewport().observe('.photo-target', entry => {
      if (entry.intersectionRatio <= 0 || sequence !== this._sequence || !this._visible) return
      const id = Number(entry.dataset.id)
      if (!id || this.data.photoPaths[id]) return
      this._photos.load(id).then(path => {
        if (path && sequence === this._sequence && this._visible) {
          this.setData({ photoPaths: { ...this.data.photoPaths, [id]: path } })
        }
      })
    })
  },
  photoFailed(event) {
    const paths = { ...this.data.photoPaths }
    delete paths[event.currentTarget.dataset.id]
    this.setData({ photoPaths: paths })
  },
  search(event) { this.setData({ query: event.detail.value }); this.apply() },
  statusChange(event) {
    const index = Number(event.detail.value)
    this.setData({ statusIndex: index, status: ['', 'active', 'idle', 'disposed'][index] }); this.apply()
  },
  open(event) { wx.navigateTo({ url: `/pages/item/index?id=${event.currentTarget.dataset.id}` }) },
  add() { wx.navigateTo({ url: '/pages/editor/index' }) },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) }
})

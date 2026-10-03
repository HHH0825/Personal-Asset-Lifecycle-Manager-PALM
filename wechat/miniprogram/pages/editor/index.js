const api = require('../../utils/api')
const view = require('../../utils/view')
const photo = require('../../utils/photo-edit')
const defaults = () => ({ name: '', category: '', icon_type: 'other', purchase_date: view.today(),
  purchase_price: '', warranty_expires_on: '', notes: '', status: 'active' })
Page({
  data: { itemId: 0, today: view.today(), form: defaults(), types: view.TYPE_OPTIONS.map(row => row[1]), typeIndex: 8,
    statuses: ['使用中', '闲置'], statusIndex: 0, photoPath: '', previewPath: '', photoBusy: false,
    photoLoading: false, photoError: '', hasPhoto: false, busy: false, loading: false, loadFailed: false, focusField: '', error: '' },
  onLoad(options) {
    this._alive = true; this._visible = true; this._sequence = 0; this._photoSequence = 0
    this._token = getApp().globalData.token
    this.itemId = Number(options.id || 0); this.setData({ itemId: this.itemId })
    if (getApp().requireSession() && this.itemId) this.load()
  },
  onShow() {
    this._visible = true
    if (getApp().globalData.token !== this._token) {
      this._sequence += 1; this._photoSequence += 1
      this.setData({ form: defaults(), photoPath: '', previewPath: '', hasPhoto: false, photoBusy: false,
        photoLoading: false, photoError: '', loading: false, loadFailed: true, error: '登录账户已切换，请重新打开物品表单。' })
    }
  },
  onHide() {
    this._visible = false
    // Native camera/crop screens may hide the page without navigating away.
    // current() also checks the page stack before accepting their callbacks.
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    if (pages[pages.length - 1] !== this) {
      this._sequence += 1; this._photoSequence += 1
      this.setData({ photoBusy: false, photoLoading: false })
    }
  },
  onUnload() { this._alive = false; this._sequence += 1; this._photoSequence += 1 },
  current(token = this._token) {
    if (!this._alive || token !== this._token || getApp().globalData.token !== token) return false
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    return this._visible !== false || pages[pages.length - 1] === this
  },
  async load() {
    if (this.data.busy || this.data.photoBusy || !this.current()) return
    const sequence = ++this._sequence, token = this._token
    this.setData({ loading: true, loadFailed: false, error: '' })
    try {
      const item = await api.request(`/items/${this.itemId}`)
      if (!this.current(token) || sequence !== this._sequence) return
      const typeIndex = Math.max(0, view.TYPE_OPTIONS.findIndex(row => row[0] === item.icon_type))
      this.setData({ form: { name: item.name, category: item.category, icon_type: item.icon_type,
        purchase_date: item.purchase_date, purchase_price: item.purchase_price,
        warranty_expires_on: item.warranty_expires_on || '', notes: item.notes,
        status: item.status }, typeIndex, statusIndex: item.status === 'idle' ? 1 : 0,
        hasPhoto: Boolean(item.photo_url), photoPath: '', previewPath: '', photoError: '' })
      if (item.photo_url) this.loadPhoto()
    } catch (error) { if (this.current(token) && sequence === this._sequence) this.setData({ loadFailed: true, error: view.errorMessage(error) }) }
    finally { if (this.current(token) && sequence === this._sequence) this.setData({ loading: false }) }
  },
  input(event) { this.setData({ [`form.${event.currentTarget.dataset.key}`]: event.detail.value }) },
  focus(event) { this.setData({ focusField: event.currentTarget.dataset.key }) },
  blur() { this.setData({ focusField: '' }) },
  typeChange(event) { const index = Number(event.detail.value); this.setData({ typeIndex: index, 'form.icon_type': view.TYPE_OPTIONS[index][0] }) },
  statusChange(event) { const index = Number(event.detail.value); this.setData({ statusIndex: index, 'form.status': index ? 'idle' : 'active' }) },
  clearWarranty() { this.setData({ 'form.warranty_expires_on': '' }) },
  async loadPhoto() {
    if (!this.current() || !this.data.hasPhoto || this.data.photoBusy || this.data.photoPath) return
    const sequence = ++this._photoSequence, token = this._token
    this.setData({ photoLoading: true, photoError: '' })
    try {
      const path = await api.downloadPhoto(this.itemId)
      if (this.current(token) && sequence === this._photoSequence) this.setData({ previewPath: path })
    } catch (_) {
      if (this.current(token) && sequence === this._photoSequence) this.setData({ photoError: '原照片读取失败，可重试或重新选择；保存其他信息不会删除原照片。' })
    } finally {
      if (this.current(token) && sequence === this._photoSequence) this.setData({ photoLoading: false })
    }
  },
  previewFailed() {
    this.setData({ previewPath: '', photoError: this.data.photoPath ? '照片预览失败，请重新选择照片。'
      : '原照片读取失败，可重试或重新选择；保存其他信息不会删除原照片。' })
  },
  async photoOperation(action) {
    if (!this.current() || this.data.busy || this.data.photoBusy || this.data.loading || this.data.loadFailed) return
    const sequence = ++this._photoSequence, token = this._token
    this.setData({ photoBusy: true, photoLoading: false, photoError: '' })
    const active = () => this.current(token) && sequence === this._photoSequence
    try {
      const path = await action(active)
      if (path && active()) this.setData({ photoPath: path, previewPath: path })
    } catch (error) {
      if (active() && !photo.cancelled(error)) this.setData({ photoError: photo.photoError(error) })
    } finally {
      if (active()) this.setData({ photoBusy: false })
    }
  },
  choosePhoto() {
    return this.photoOperation(async active => {
      const choice = await photo.nativeCall('showActionSheet', { itemList: ['从相册选择', '拍一张照片'], itemColor: '#493B35' })
      if (!active() || ![0, 1].includes(choice.tapIndex)) return
      const result = await photo.nativeCall('chooseMedia', { count: 1, mediaType: ['image'],
        sourceType: [choice.tapIndex ? 'camera' : 'album'], camera: 'back', sizeType: ['compressed'] })
      const path = result.tempFiles && result.tempFiles[0] && result.tempFiles[0].tempFilePath
      if (!path) throw new Error('没有读取到照片')
      return path
    })
  },
  cropPhoto() {
    if (!this.data.previewPath) return
    return this.photoOperation(() => photo.cropPhoto(this.data.previewPath))
  },
  rotatePhoto() {
    if (!this.data.previewPath) return
    return this.photoOperation(active => photo.rotatePhoto(this, this.data.previewPath, active))
  },
  async save() {
    if (!this.current() || this.data.busy || this.data.photoBusy || this.data.loading || this.data.loadFailed) return
    const token = this._token
    this.setData({ busy: true, error: '' })
    try {
      const form = this.data.form
      const payload = { ...form, warranty_expires_on: form.warranty_expires_on || null }
      const item = this.itemId
        ? await api.request(`/items/${this.itemId}`, { method: 'PUT', data: payload })
        : await api.request('/items', { method: 'POST', data: payload })
      if (!this.current(token)) return
      if (this.data.photoPath) {
        try { await api.uploadPhoto(item.id, this.data.photoPath) }
        catch (error) {
          if (!this.current(token)) return
          await new Promise(resolve => wx.showModal({ title: '物品已保存', content: `照片上传失败：${view.errorMessage(error)}。可进入详情后重新编辑上传。`, showCancel: false, complete: resolve }))
        }
      }
      if (this.current(token)) wx.navigateBack()
    } catch (error) { if (this.current(token)) this.setData({ error: view.errorMessage(error) }) }
    finally { if (this.current(token)) this.setData({ busy: false }) }
  }
})

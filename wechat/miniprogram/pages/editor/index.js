const api = require('../../utils/api')
const view = require('../../utils/view')
const photo = require('../../utils/photo-edit')
const drafts = require('../../utils/drafts')
const config = require('../../config')
const defaults = () => ({ name: '', category: '', icon_type: 'other', purchase_date: view.today(),
  purchase_price: '', warranty_expires_on: '', notes: '', status: 'active' })
Page({
  data: { itemId: 0, today: view.today(), form: defaults(), types: view.TYPE_OPTIONS.map(row => row[1]), typeIndex: 8,
    statuses: ['使用中', '闲置'], statusIndex: 0, photoPath: '', previewPath: '', photoBusy: false,
    photoLoading: false, photoError: '', hasPhoto: false, busy: false, loading: false, loadFailed: false, focusField: '', error: '',
    draftPrompt: false, draftName: '', draftTime: '', draftStatus: '', draftReady: true, draftWorking: false },
  onLoad(options) {
    this._alive = true; this._visible = true; this._sequence = 0; this._photoSequence = 0
    this._token = getApp().globalData.token
    this._photoOwner = {}; this._photos = api.photoCache()
    this.itemId = Number(options.id || 0); this.setData({ itemId: this.itemId })
    if (getApp().requireSession()) {
      if (this.itemId) this.load()
      else this.initDraft()
    }
  },
  onShow() {
    this._visible = true
    if (getApp().globalData.token !== this._token) {
      this._photos.release(this._photoOwner)
      clearTimeout(this._draftTimer)
      this._sequence += 1; this._photoSequence += 1
      this.setData({ form: defaults(), photoPath: '', previewPath: '', hasPhoto: false, photoBusy: false,
        photoLoading: false, photoError: '', loading: false, loadFailed: true, draftPrompt: false,
        draftReady: false, draftStatus: '', error: '登录账户已切换，请重新打开物品表单。' })
    }
  },
  onHide() {
    this.flushDraft()
    this._visible = false
    // Native camera/crop screens may hide the page without navigating away.
    // current() also checks the page stack before accepting their callbacks.
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    if (pages[pages.length - 1] !== this) {
      this._photos.release(this._photoOwner)
      this._sequence += 1; this._photoSequence += 1
      this.setData({ photoBusy: false, photoLoading: false })
    }
  },
  onUnload() { this.flushDraft(); this._alive = false; this._sequence += 1; this._photoSequence += 1; this._photos.release(this._photoOwner) },
  initDraft() {
    this._draft = drafts.createStore(drafts.scope(config.API_BASE, getApp().globalData.user))
    this._draftDirty = false; this._draftRevision = 0
    try {
      const row = this._draft && this._draft.read()
      if (!row) return
      this._restoringDraft = row
      const date = new Date(row.savedAt)
      const pad = value => String(value).padStart(2, '0')
      const time = Number.isNaN(date.getTime()) ? '上次填写' : `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
      this.setData({ draftPrompt: true, draftReady: false, draftName: row.form.name || '未命名物品', draftTime: time })
    } catch (_) { this.setData({ draftStatus: '草稿未保存：本机存储不可用，仍可正式提交。' }) }
  },
  changed() {
    if (this.itemId || !this.data.draftReady) return
    this._draftDirty = true; this._draftRevision += 1
    this.setData({ draftStatus: '正在保存草稿…' })
    clearTimeout(this._draftTimer)
    this._draftTimer = setTimeout(() => this.flushDraft(), 500)
  },
  async flushDraft() {
    clearTimeout(this._draftTimer)
    if (this.itemId || !this._draftDirty || !this.data.draftReady || this._created) return
    const token = this._token, revision = this._draftRevision, source = this.data.photoPath
    if (this._draftPending && this._draftPending.revision === revision) return this._draftPending.task.catch(() => null)
    const active = () => token === getApp().globalData.token && !this._created && revision === this._draftRevision
    try {
      if (!this._draft) throw new Error('账户编号不可用')
      const task = this._draft.save(this.data.form, source, active)
      this._draftPending = { revision, task }
      const row = await task
      if (row && active()) {
        this._draftDirty = false
        if (this._alive) this.setData({ photoPath: row.photoPath, previewPath: row.photoPath || this.data.previewPath, draftStatus: '草稿已保存到本机' })
      }
    } catch (_) {
      if (active() && this._alive) this.setData({ draftStatus: '草稿未保存：请检查本机存储，仍可正式提交。' })
    } finally { if (this._draftPending && this._draftPending.revision === revision) this._draftPending = null }
  },
  async continueDraft() {
    if (this.data.draftWorking || !this.current()) return
    const token = this._token
    this.setData({ draftWorking: true })
    try {
      const row = await this._draft.restore(this._restoringDraft)
      if (!this.current(token)) return
      const form = { ...defaults(), ...row.form }
      const typeIndex = view.TYPE_OPTIONS.findIndex(option => option[0] === form.icon_type)
      if (typeIndex < 0) form.icon_type = 'other'
      if (!['active', 'idle'].includes(form.status)) form.status = 'active'
      this.setData({ form, typeIndex: typeIndex < 0 ? 8 : typeIndex, statusIndex: form.status === 'idle' ? 1 : 0,
        photoPath: row.photoPath, previewPath: row.photoPath, draftPrompt: false, draftReady: true,
        draftStatus: '草稿已保存到本机', photoError: row.missingPhoto ? '草稿照片已丢失，请重新选图；其他填写内容已恢复。' : '' })
      if (row.missingPhoto) this.changed()
    } catch (_) { if (this.current(token)) this.setData({ draftStatus: '草稿读取失败，请重试。' }) }
    finally { if (this.current(token)) this.setData({ draftWorking: false }) }
  },
  closeDraft() {
    if (this.data.draftWorking) return
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/items/index' }) })
  },
  restartDraft() { return this.discardDraft(true) },
  async discardDraft(restart = false) {
    if (!this.current() || this.data.busy || this.data.photoBusy || this.data.draftWorking) return
    const token = this._token
    this.setData({ draftWorking: true })
    try {
      const confirm = await new Promise(resolve => wx.showModal({ title: restart === true ? '重新填写？' : '丢弃草稿？',
        content: '本机保存的填写内容和草稿照片将被清除。', success: result => resolve(result.confirm), fail: () => resolve(false) }))
      if (!confirm || !this.current(token)) return
      clearTimeout(this._draftTimer); this._draftRevision += 1
      await this._draft.discard(() => token === getApp().globalData.token)
      if (!this.current(token)) return
      this._draftDirty = false; this._restoringDraft = null
      this.setData({ form: defaults(), typeIndex: 8, statusIndex: 0, photoPath: '', previewPath: '', photoError: '',
        error: '', draftPrompt: false, draftReady: true, draftStatus: '' })
    } catch (_) { if (this.current(token)) this.setData({ draftStatus: '草稿清理失败，请重试。' }) }
    finally { if (this.current(token)) this.setData({ draftWorking: false }) }
  },
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
      this._photoItem = item; this._photos.sync([item])
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
  input(event) { this.setData({ [`form.${event.currentTarget.dataset.key}`]: event.detail.value }); this.changed() },
  focus(event) { this.setData({ focusField: event.currentTarget.dataset.key }) },
  blur() { this.setData({ focusField: '' }) },
  typeChange(event) { const index = Number(event.detail.value); this.setData({ typeIndex: index, 'form.icon_type': view.TYPE_OPTIONS[index][0] }); this.changed() },
  statusChange(event) { const index = Number(event.detail.value); this.setData({ statusIndex: index, 'form.status': index ? 'idle' : 'active' }); this.changed() },
  clearWarranty() { this.setData({ 'form.warranty_expires_on': '' }); this.changed() },
  async loadPhoto() {
    if (!this.current() || !this.data.hasPhoto || this.data.photoBusy || this.data.photoPath) return
    const sequence = ++this._photoSequence, token = this._token
    this.setData({ photoLoading: true, photoError: '' })
    try {
      const path = await api.downloadPhoto(this.itemId, { owner: this._photoOwner, version: this._photoItem && this._photoItem.photo_version })
      if (this.current(token) && sequence === this._photoSequence) this.setData({ previewPath: path })
    } catch (_) {
      if (this.current(token) && sequence === this._photoSequence) this.setData({ photoError: '原照片读取失败，可重试或重新选择；保存其他信息不会删除原照片。' })
    } finally {
      if (this.current(token) && sequence === this._photoSequence) this.setData({ photoLoading: false })
    }
  },
  previewFailed() {
    if (!this.data.photoPath) this._photos.invalidate(this.itemId)
    this.setData({ previewPath: '', photoError: this.data.photoPath ? '照片预览失败，请重新选择照片。'
      : '原照片读取失败，可重试或重新选择；保存其他信息不会删除原照片。' })
  },
  async photoOperation(action) {
    if (!this.current() || this.data.busy || this.data.photoBusy || this.data.loading || this.data.loadFailed || !this.data.draftReady) return
    const sequence = ++this._photoSequence, token = this._token
    this.setData({ photoBusy: true, photoLoading: false, photoError: '' })
    const active = () => this.current(token) && sequence === this._photoSequence
    try {
      const path = await action(active)
      if (path && active()) {
        this.setData({ photoPath: path, previewPath: path }); this.changed()
        await this.flushDraft()
      }
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
    if (!this.current() || this.data.busy || this.data.photoBusy || this.data.loading || this.data.loadFailed || !this.data.draftReady || this.data.draftWorking) return
    const token = this._token
    this.setData({ busy: true, error: '' })
    try {
      const form = this.data.form, uploadPath = this.data.photoPath, creating = !this.itemId
      const payload = { ...form, warranty_expires_on: form.warranty_expires_on || null }
      const item = this.itemId
        ? await api.request(`/items/${this.itemId}`, { method: 'PUT', data: payload })
        : await api.request('/items', { method: 'POST', data: payload })
      if (creating) {
        this._created = true; clearTimeout(this._draftTimer)
        // Subsequent attempts on this page edit the created item, never POST again.
        this.itemId = item.id
        try { if (this._draft) this._draft.complete() }
        catch (_) { if (this.current(token)) this.setData({ draftStatus: '物品已创建，但草稿清理失败，请丢弃残留草稿。' }) }
      }
      try {
        if (!this.current(token)) return
        if (uploadPath) {
          try { await api.uploadPhoto(item.id, uploadPath) }
          catch (error) {
            if (!this.current(token)) return
            await new Promise(resolve => wx.showModal({ title: '物品已保存', content: `照片上传失败：${view.errorMessage(error)}。可进入详情后重新编辑上传。`, showCancel: false, complete: resolve }))
          }
        }
        if (this.current(token)) wx.navigateBack()
      } finally {
        if (creating && this._draft) await this._draft.cleanup().catch(() => {})
      }
    } catch (error) { if (this.current(token)) this.setData({ error: view.errorMessage(error) }) }
    finally { if (this.current(token)) this.setData({ busy: false }) }
  }
})

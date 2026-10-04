const api = require('../../utils/api')
const { today, errorMessage } = require('../../utils/view')
const { readMonthly, presentMonthly } = require('../../utils/monthly')
const { reportImage } = require('../../utils/report-image')
const { nativeCall } = require('../../utils/photo-edit')
const { navigate, resetNavigation } = require('../../utils/navigation')
Page({
  data: { month: '', maxMonth: '', report: null, edition: null, loading: true, error: '', imageError: '', imagePath: '', imageBusy: false },
  onLoad(options = {}) { this._sequence = 0; this._requested = /^\d{4}-\d{2}$/.test(options.month || '') ? options.month : '' },
  onShow() { this._visible = true; resetNavigation(this); if (getApp().requireSession()) this.load() },
  onHide() { this._visible = false; this._sequence++; this.setData({ report: null, edition: null, imagePath: '', imageError: '', imageBusy: false }) },
  onUnload() { this._visible = false; this._sequence++ },
  current(sequence, token) { return this._visible && sequence === this._sequence && token === getApp().globalData.token },
  async load() {
    const sequence = ++this._sequence, token = getApp().globalData.token
    this.setData({ loading: true, error: '', report: null, edition: null, imagePath: '', imageError: '', imageBusy: false })
    try {
      const report = readMonthly(await api.request('/reports/monthly' + (this._requested ? '?month=' + this._requested : '')))
      if (!this.current(sequence, token)) return
      this._requested = report.month
      this.setData({ month: report.month, maxMonth: report.today.slice(0, 7), report, edition: presentMonthly(report), loading: false })
    } catch (error) { if (this.current(sequence, token)) this.setData({ loading: false, error: errorMessage(error), maxMonth: this.data.maxMonth || today().slice(0, 7) }) }
  },
  changeMonth(e) { this._requested = e.detail.value; this.setData({ month: e.detail.value }); this.load() },
  open(e) { navigate(this, '/pages/item/index?id=' + e.currentTarget.dataset.id) },
  add() { navigate(this, '/pages/editor/index') },
  preview() { return this.exportImage('preview') },
  saveImage() { return this.exportImage('save') },
  async exportImage(action) {
    if (!this.data.report || this.data.loading || this.data.imageBusy || !getApp().requireSession()) return
    const sequence = this._sequence, token = getApp().globalData.token
    const current = () => this.current(sequence, token)
    this.setData({ imageBusy: true, imageError: '' })
    try {
      const path = this.data.imagePath || await reportImage(this, this.data.report, current)
      if (!current()) return
      this.setData({ imagePath: path })
      if (action === 'preview') await nativeCall('previewImage', { current: path, urls: [path] })
      else { await nativeCall('saveImageToPhotosAlbum', { filePath: path }); if (current()) wx.showToast({ title: '已保存到相册', icon: 'success' }) }
    } catch (error) {
      if (current()) this.setData({ imageError: /auth|deny|denied|permission|privacy/i.test(error.errMsg || '') ?
        '没有相册保存权限。可先预览图片，或在微信设置中允许后重试。' : /cancel/i.test(error.errMsg || '') ? '已取消保存，可稍后重试。' : '图片生成或保存失败，请重试。' })
    } finally { if (current()) this.setData({ imageBusy: false }) }
  }
})

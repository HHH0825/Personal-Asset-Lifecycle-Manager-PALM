const { errorMessage } = require('../../utils/view')
const { welcomeLayout, readWindowInfo } = require('../../utils/layout')
const config = require('../../config')
Page({
  data: { busy: false, error: '', logoFailed: false, devLogin: config.DEV_LOGIN, ...welcomeLayout() },
  onLoad() { this.updateLayout(); if (getApp().hasSession()) wx.switchTab({ url: '/pages/items/index' }) },
  onResize(event) { this.updateLayout(event.size) },
  updateLayout(size) { this.setData(welcomeLayout(size || readWindowInfo())) },
  logoError() { this.setData({ logoFailed: true }) },
  async login() {
    if (this.data.busy) return
    this.setData({ busy: true, error: '' })
    try { await getApp().login(); wx.switchTab({ url: '/pages/items/index' }) }
    catch (error) { this.setData({ error: errorMessage(error) }) }
    finally { this.setData({ busy: false }) }
  }
})

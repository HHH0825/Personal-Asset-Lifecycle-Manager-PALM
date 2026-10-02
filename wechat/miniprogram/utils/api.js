const { API_BASE } = require('../config')

function sessionExpired() {
  getApp().clearSession()
  wx.reLaunch({ url: '/pages/login/index' })
}

function errorFrom(body, status) {
  const error = new Error((body && body.error) || `请求失败（${status}）`)
  error.status = status
  return error
}

function request(path, options = {}) {
  const token = getApp().globalData.token
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE}/api/mp${path}`,
      method: options.method || 'GET',
      data: options.data,
      header: { 'Content-Type': 'application/json', ...(options.anonymous ? {} : { Authorization: `Bearer ${token}` }) },
      success(response) {
        if (!options.anonymous && getApp().globalData.token !== token) { reject(new Error('登录账户已切换')); return }
        if (response.statusCode === 401 && !options.anonymous) sessionExpired()
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data)
        else reject(errorFrom(response.data, response.statusCode))
      },
      fail() { reject(new Error('连接失败，请检查网络和后端地址')) }
    })
  })
}

function uploadPhoto(itemId, filePath) {
  const token = getApp().globalData.token
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${API_BASE}/api/mp/items/${itemId}/photo`, filePath, name: 'photo',
      header: { Authorization: `Bearer ${token}` },
      success(response) {
        if (getApp().globalData.token !== token) { reject(new Error('登录账户已切换')); return }
        if (response.statusCode === 401) sessionExpired()
        let body = {}
        try { body = JSON.parse(response.data) } catch (_) { /* error handled below */ }
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(body)
        else reject(errorFrom(body, response.statusCode))
      },
      fail() { reject(new Error('照片上传失败，请检查网络')) }
    })
  })
}

function downloadPhoto(itemId) {
  const token = getApp().globalData.token
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: `${API_BASE}/api/mp/items/${itemId}/photo`,
      header: { Authorization: `Bearer ${token}` },
      success(response) {
        if (getApp().globalData.token !== token) { reject(new Error('登录账户已切换')); return }
        if (response.statusCode === 401) sessionExpired()
        if (response.statusCode === 200) resolve(response.tempFilePath)
        else reject(errorFrom({}, response.statusCode))
      }, fail() { reject(new Error('照片读取失败')) }
    })
  })
}

module.exports = { request, uploadPhoto, downloadPhoto }

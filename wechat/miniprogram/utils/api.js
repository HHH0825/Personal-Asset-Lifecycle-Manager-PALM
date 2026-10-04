const { API_BASE } = require('../config')
const { createPhotoCache } = require('./photo-cache')
let photos

function photoStat(path) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().stat({ path, success: result => resolve(result.stats), fail: reject })
  })
}
function removeDownload(path) {
  return new Promise(resolve => {
    try { wx.getFileSystemManager().unlink({ filePath: path, complete: resolve }) } catch (_) { resolve() }
  })
}
function photoCache() {
  if (!photos) photos = createPhotoCache({ download: startPhotoDownload, stat: photoStat, remove: removeDownload,
    getScope: () => getApp().globalData.token ? JSON.stringify([API_BASE, getApp().globalData.token]) : '' })
  return photos
}
function clearPhotos() { if (photos) photos.reset() }

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
        if (response.statusCode >= 200 && response.statusCode < 300) {
          const removed = (options.method === 'DELETE') && path.match(/^\/items\/(\d+)(?:\/photo)?$/)
          if (removed && photos) photos.invalidate(Number(removed[1]))
          resolve(response.data)
        }
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
        if (response.statusCode >= 200 && response.statusCode < 300) {
          if (photos) photos.invalidate(itemId)
          resolve(body)
        }
        else reject(errorFrom(body, response.statusCode))
      },
      fail() { reject(new Error('照片上传失败，请检查网络')) }
    })
  })
}

function startPhotoDownload(spec) {
  const token = getApp().globalData.token
  let task
  const promise = new Promise((resolve, reject) => {
    task = wx.downloadFile({
      url: `${API_BASE}/api/mp/items/${spec.id}/photo?size=${spec.size}&v=${encodeURIComponent(spec.version)}`,
      timeout: 15000,
      header: { Authorization: `Bearer ${token}` },
      success(response) {
        if (getApp().globalData.token !== token) {
          if (response.tempFilePath) removeDownload(response.tempFilePath)
          reject(new Error('登录账户已切换')); return
        }
        if (response.statusCode === 401) sessionExpired()
        if (response.statusCode === 200) resolve(response.tempFilePath)
        else { if (response.tempFilePath) removeDownload(response.tempFilePath); reject(errorFrom({}, response.statusCode)) }
      }, fail() { reject(new Error('照片读取失败')) }
    })
  })
  return { promise, abort() { if (task && task.abort) task.abort() } }
}

function downloadPhoto(itemId, options = {}) {
  return photoCache().load({ id: itemId, photo_version: options.version }, options.owner || 'legacy-reader', options.size || 'full', options.priority || 0)
}

module.exports = { request, uploadPhoto, downloadPhoto, photoCache, clearPhotos }

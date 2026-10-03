// Work only on temporary files. Selection and editing never upload a photo.
function nativeCall(name, options, context) {
  return new Promise((resolve, reject) => {
    try { wx[name]({ ...options, success: resolve, fail: reject }, context) }
    catch (error) { reject(error) }
  })
}

function cancelled(error) { return /cancel/i.test(error && error.errMsg || '') }

function photoError(error) {
  const message = String(error && (error.errMsg || error.message) || '')
  if (/auth|permission|deny|denied|privacy/i.test(message)) return '无法使用相机或相册，请检查微信及手机的权限设置。也可以稍后再添加照片。'
  if (/camera|相机/i.test(message)) return '相机暂时不可用，请重试或从相册选择照片。'
  return message.includes('当前微信版本') ? message : '照片读取或处理失败，请重试或换一张照片。'
}

function cropPhoto(src) {
  if (typeof wx.cropImage !== 'function' || (wx.canIUse && !wx.canIUse('cropImage'))) {
    return Promise.reject(new Error('当前微信版本不支持裁剪，请更新微信'))
  }
  return nativeCall('cropImage', { src, cropScale: '1:1' }).then(result => {
    if (!result.tempFilePath) throw new Error('没有生成裁剪照片')
    return result.tempFilePath
  })
}

function rotationSize(width, height, orientation = 'up') {
  if (!(width > 0 && height > 0)) throw new Error('照片尺寸无效')
  const sideways = /^(left|right)/.test(orientation)
  const orientedWidth = sideways ? height : width, orientedHeight = sideways ? width : height
  const scale = Math.min(1, 1600 / Math.max(width, height))
  return { width: Math.max(1, Math.round(orientedHeight * scale)),
    height: Math.max(1, Math.round(orientedWidth * scale)), scale, orientedHeight }
}

// Normalize camera EXIF orientation before applying the requested clockwise turn.
function orientationMatrix(width, height, orientation) {
  return ({
    'up': [1, 0, 0, 1, 0, 0], 'up-mirrored': [-1, 0, 0, 1, width, 0],
    'down': [-1, 0, 0, -1, width, height], 'down-mirrored': [1, 0, 0, -1, 0, height],
    'left-mirrored': [0, 1, 1, 0, 0, 0], 'right': [0, 1, -1, 0, height, 0],
    'right-mirrored': [0, -1, -1, 0, height, width], 'left': [0, -1, 1, 0, 0, width]
  })[orientation] || [1, 0, 0, 1, 0, 0]
}

async function rotatePhoto(page, src, isCurrent = () => true) {
  const check = () => { if (!isCurrent()) throw new Error('照片编辑已取消') }
  const info = await nativeCall('getImageInfo', { src })
  check()
  const size = rotationSize(info.width, info.height, info.orientation)
  const canvas = await new Promise((resolve, reject) => {
    wx.createSelectorQuery().in(page).select('#photo-edit-canvas').fields({ node: true, size: true }, rows => {
      if (rows && rows.node) resolve(rows.node)
      else reject(new Error('照片编辑画布不可用'))
    }).exec()
  })
  check()
  canvas.width = size.width; canvas.height = size.height
  const context = canvas.getContext('2d')
  const image = canvas.createImage()
  await new Promise((resolve, reject) => {
    image.onload = resolve; image.onerror = reject; image.src = info.path || src
  })
  check()
  context.fillStyle = '#FFFCF7'
  context.fillRect(0, 0, size.width, size.height)
  context.scale(size.scale, size.scale)
  context.translate(size.orientedHeight, 0)
  context.rotate(Math.PI / 2)
  context.transform(...orientationMatrix(info.width, info.height, info.orientation))
  context.drawImage(image, 0, 0, info.width, info.height)
  const result = await nativeCall('canvasToTempFilePath', { canvas, width: size.width, height: size.height,
    destWidth: size.width, destHeight: size.height, fileType: 'jpg', quality: 0.85 }, page)
  check()
  if (!result.tempFilePath) throw new Error('没有生成旋转照片')
  return result.tempFilePath
}

module.exports = { nativeCall, cancelled, photoError, cropPhoto, rotatePhoto, rotationSize, orientationMatrix }

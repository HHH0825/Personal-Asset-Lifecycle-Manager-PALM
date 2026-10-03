// One pending navigation per source page; returning to it releases the lock.
function resetNavigation(page) { page._navigation = null }

function navigate(page, url) {
  if (page._visible === false || page._navigation || !getApp().requireSession()) return
  const attempt = { token: getApp().globalData.token }
  page._navigation = attempt
  const fail = error => {
    if (page._navigation !== attempt) return
    page._navigation = null
    if (page._visible === false || getApp().globalData.token !== attempt.token) return
    console.warn('[页面跳转]', url, error && error.errMsg ? error.errMsg : '未知跳转错误')
    wx.showModal({ title: '无法打开页面', content: '页面暂时无法打开，请重试', showCancel: false })
  }
  try { wx.navigateTo({ url, fail }) } catch (error) { fail(error) }
}

module.exports = { navigate, resetNavigation }

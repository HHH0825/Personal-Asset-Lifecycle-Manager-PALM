// Use CSS pixels, never physical screen resolution or a device-name list.
const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
function welcomeLayout(info = {}) {
  const width = Number.isFinite(info.windowWidth) && info.windowWidth > 0 ? info.windowWidth : 375
  const height = Number.isFinite(info.windowHeight) && info.windowHeight > 0 ? info.windowHeight : 640
  const contentWidth = Math.min(width, 480)
  const compact = height < 640
  const padding = Math.round(clamp(contentWidth * 0.045, 16, 24))
  return {
    compact,
    pageStyle: `--welcome-gap:${compact ? 12 : 18}px;--welcome-title:${contentWidth < 350 ? 28 : contentWidth < 410 ? 32 : 34}px;padding-left:${padding}px;padding-right:${padding}px;min-height:${height}px;`,
    heroStyle: `height:${Math.round(clamp(height * 0.24, 140, 220))}px;`
  }
}
function readWindowInfo() {
  try { return typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : {} } catch (_) { return {} }
}
module.exports = { welcomeLayout, readWindowInfo }

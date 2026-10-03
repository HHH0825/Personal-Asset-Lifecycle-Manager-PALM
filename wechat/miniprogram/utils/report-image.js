const { nativeCall } = require('./photo-edit')
const { wrapLines } = require('./monthly')
async function reportImage(page, report, current) {
  const check = () => { if (!current()) throw new Error('本次图片生成已取消') }
  const canvas = await new Promise((resolve, reject) => {
    wx.createSelectorQuery().in(page).select('#report-canvas').fields({ node: true, size: true }, result => {
      if (result && result.node) resolve(result.node); else reject(new Error('图片画布暂不可用，请重试'))
    }).exec()
  })
  check()
  const width = 720, height = 1580
  canvas.width = width; canvas.height = height
  const c = canvas.getContext('2d')
  const logo = canvas.createImage()
  await new Promise((resolve, reject) => { logo.onload = resolve; logo.onerror = () => reject(new Error('Logo 读取失败，请重试')); logo.src = '/assets/paper/logo.png' })
  check()
  c.fillStyle = '#F2EADF'; c.fillRect(0, 0, width, height)
  c.fillStyle = '#FFFCF7'; c.fillRect(24, 24, width - 48, height - 48)
  c.strokeStyle = '#D9CCBB'; c.lineWidth = 1
  c.drawImage(logo, 50, 50, 64, 64)
  function text(value, x, y, size = 24, color = '#493B35') { c.font = size + 'px sans-serif'; c.fillStyle = color; c.fillText(value, x, y) }
  function rule(y) { c.beginPath(); c.moveTo(52, y); c.lineTo(668, y); c.stroke() }
  function lines(value, y, size = 26, max = 2) { c.font = size + 'px sans-serif'; wrapLines(c, value, 600, max).forEach((line, i) => text(line, 56, y + i * (size + 10), size)) }
  text('物物记', 128, 91, 30); text('每月一页 · 物品记录', 52, 153, 20, '#635147')
  text(report.month.replace('-', ' / '), 52, 218, 42)
  text('收藏小报', 52, 267, 30)
  text(report.is_current ? '截至 ' + report.cutoff_date : '记录截止 ' + report.cutoff_date, 52, 308, 20, '#635147')
  rule(334)
  const t = report.totals
  const rows = [['购入物品', t.purchase_count + ' 件'], ['购置支出', '¥' + t.purchase_total],
    ['维修支出', '¥' + t.maintenance_total], ['处置回收', '¥' + t.disposal_total], ['记录的使用', t.usage_count + ' 次']]
  rows.forEach((row, i) => { text(row[0], 52, 376 + i * 45, 23, '#635147'); c.textAlign = 'right'; text(row[1], 664, 376 + i * 45, 25); c.textAlign = 'left' })
  rule(582); text('本月购入', 52, 629, 27)
  if (!report.purchases.length) text('这个月没有购入记录', 56, 678, 22, '#635147')
  report.purchases.slice(0, 3).forEach((item, i) => {
    const y = 675 + i * 112; lines(item.name, y)
    text(item.purchase_date + '   ¥' + item.purchase_price, 56, y + 77, 20, '#635147')
  })
  if (report.purchases.length > 3) text('另有 ' + (report.purchases.length - 3) + ' 件，见小程序完整记录', 56, 1018, 20, '#635147')
  rule(1040); text('本月陪伴', 52, 1084, 27)
  if (!report.memories.length) text('这个月没有达成的纪念', 56, 1136, 22, '#635147')
  report.memories.slice(0, 3).forEach((item, i) => {
    const y = 1127 + i * 108; lines(item.name, y, 24, 1); lines(item.label, y + 32, 20, 1)
    text(item.date, 56, y + 60, 18, '#635147')
  })
  if (report.memories.length > 3) text('另有 ' + (report.memories.length - 3) + ' 条纪念', 56, 1448, 20, '#635147')
  rule(1466); text('按当前保存的记录整理，历史结果可能随更正变化。', 52, 1504, 18, '#635147')
  check()
  const result = await nativeCall('canvasToTempFilePath', { canvas, width, height, destWidth: width, destHeight: height, fileType: 'png' }, page)
  check()
  if (!result.tempFilePath) throw new Error('没有生成图片，请重试')
  return result.tempFilePath
}
module.exports = { reportImage }

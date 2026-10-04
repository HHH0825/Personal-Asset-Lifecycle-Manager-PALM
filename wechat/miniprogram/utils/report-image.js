const { nativeCall } = require('./photo-edit')
const { wrapLines, presentMonthly, PALETTE } = require('./monthly')

// Measure every dynamic text block before allocating the final canvas.
// The page and PNG use the same edition artwork, colours and expense ratios.
function planReport(context, report) {
  const edition = presentMonthly(report), commands = [], width = 720, left = 52, right = 668, inner = right - left
  let y = 420
  const font = size => { context.font = size + 'px sans-serif' }
  function text(value, x, top, size = 24, color = PALETTE.ink, max = 2, available = inner, align = 'left') {
    font(size)
    const lines = wrapLines(context, value, available, max)
    commands.push({ kind: 'text', lines, x, y: top, size, color, align, available })
    return lines.length * (size + 10)
  }
  function paragraph(value, size = 22, color = PALETTE.muted, max = 4) {
    y += text(value, left, y, size, color, max) + 8
  }
  function line(top, color = PALETTE.line) { commands.push({ kind: 'line', x: left, y: top, width: inner, color }) }
  function heading(number, label) {
    y += 35
    text(number, left, y, 20, '#845645', 1, 50)
    text(label, left + 55, y, 29, PALETTE.ink, 1, inner - 55)
    y += 45
  }
  function image(src, x, top, w, h) { commands.push({ kind: 'image', src, x, y: top, width: w, height: h }) }
  image('/assets/paper/logo.png', left, 50, 52, 52)
  image('/assets/report/masthead.png', 120, 61, 208, 48)
  text('物物记 · 收藏小报', right, 77, 20, PALETTE.muted, 1, 270, 'right')
  line(123, PALETTE.ink)
  text(edition.year + ' / 第 ' + edition.monthNumber + ' 页', left, 165, 20, PALETTE.muted, 1)
  image(edition.monthArt, left - 6, 180, 278, 218)
  image('/assets/report/archive-sketch.png', right - 238, 151, 238, 271)
  text(edition.monthNumber + ' 月', left, 413, 19, PALETTE.muted, 1)
  y = 460
  paragraph((report.is_current ? '截至今天 · ' : '记录截止 · ') + report.cutoff_date, 19, PALETTE.muted, 1)
  line(y); y += 5

  if (!report.has_activity) {
    y += 48
    paragraph('这一页，暂时留白。', 34, PALETTE.ink, 2)
    paragraph('这个月没有购入、维修、处置或纪念记录。', 22, PALETTE.muted, 3)
    y += 15
  } else {
    heading('01', '本月账目')
    paragraph('购入 ' + report.totals.purchase_count + ' 件', 20, PALETTE.muted, 1)
    const rows = [['购置支出', report.totals.purchase_total], ['维修支出', report.totals.maintenance_total],
      ['处置回收', report.totals.disposal_total], ['本月收支差额', report.totals.cashflow_net]]
    for (const [label, amount] of rows) {
      text(label, left, y, 25, label === '本月收支差额' ? PALETTE.ink : PALETTE.muted, 1, 220)
      let size = 27
      font(size)
      while (context.measureText('¥' + amount).width > 360 && size > 18) font(--size)
      const used = text('¥' + amount, right, y, size, PALETTE.ink, 2, 360, 'right')
      y += Math.max(used, 37) + 18; line(y - 10)
    }
    y += 8
    paragraph(edition.cashflowNote, 22, PALETTE.muted, 3)
    paragraph('此处为月内收支，不是物品累计净成本。', 22, PALETTE.muted, 2)

    heading('02', '钱花在哪里')
    for (const bar of edition.bars) {
      text(bar.label, left, y, 23, PALETTE.ink, 1, 170)
      let size = 23
      font(size)
      while (context.measureText('¥' + bar.amount).width > 400 && size > 17) font(--size)
      y += Math.max(text('¥' + bar.amount, right, y, size, PALETTE.ink, 2, 400, 'right'), 33) + 12
      line(y + 9)
      if (bar.width > 0) commands.push({ kind: 'rect', x: left, y, width: inner * bar.width / 100, height: 7, color: bar.color })
      y += 39
    }
    paragraph('购置、维修与回收按金额比例对照。', 22, PALETTE.muted, 2)
    if (edition.finding) {
      y += 15
      const start = y
      paragraph('这月的一笔', 20, '#845645', 1)
      paragraph(edition.finding, 25, PALETTE.ink, 3)
      if (edition.findingBasis) paragraph(edition.findingBasis, 22, PALETTE.muted, 3)
      commands.push({ kind: 'rect', x: left - 12, y: start - 17, width: 3, height: y - start + 12, color: '#DDE4D7' })
    }

    if (report.purchases.length) {
      heading('03', '本月收藏')
      for (const item of edition.purchases.slice(0, 3)) {
        const top = y - 20
        commands.push({ kind: 'rect', x: left, y: top, width: 108, height: 120, color: '#F5EFE5' })
        image(item.art, left, top, 108, 108)
        text(item.purchase_date, left + 133, y, 18, PALETTE.muted, 1, inner - 133)
        const nameTop = y + 35
        const nameHeight = text(item.name, left + 133, nameTop, 26, PALETTE.ink, 2, inner - 133)
        const amountTop = nameTop + nameHeight + 7
        const amountHeight = text('¥' + item.purchase_price, left + 133, amountTop, 21, PALETTE.muted, 2, inner - 133)
        y = Math.max(top + 130, amountTop + amountHeight) + 22
        line(y - 10)
      }
      if (report.purchases.length > 3) paragraph('另有 ' + (report.purchases.length - 3) + ' 件，见小程序完整记录。', 22, PALETTE.muted, 2)
    }
    if (report.memories.length) {
      heading(report.purchases.length ? '04' : '03', '陪伴纪念')
      for (const item of report.memories.slice(0, 3)) {
        commands.push({ kind: 'stamp', x: left, y: y - 21, width: 150, height: 30 })
        text(item.date, left + 7, y, 18, '#845645', 1, 140)
        y += 39
        paragraph(item.label, 21, PALETTE.muted, 2)
        paragraph(item.name, 25, PALETTE.ink, 2)
        line(y); y += 26
      }
      if (report.memories.length > 3) paragraph('另有 ' + (report.memories.length - 3) + ' 条纪念。', 22, PALETTE.muted, 2)
    }
  }
  y += 24; line(y, PALETTE.ink); y += 37
  paragraph('每月一页，按当前保存的记录整理。', 22, PALETTE.muted, 2)
  paragraph('费用按事件日期归月；更正记录、修改目标、删除或恢复物品后，历史结果可能变化。', 22, PALETTE.muted, 3)
  return { width, height: Math.ceil(y + 40), commands }
}

async function reportImage(page, report, current) {
  const check = () => { if (!current()) throw new Error('本次图片生成已取消') }
  const canvas = await new Promise((resolve, reject) => {
    wx.createSelectorQuery().in(page).select('#report-canvas').fields({ node: true, size: true }, result => {
      if (result && result.node) resolve(result.node); else reject(new Error('图片画布暂不可用，请重试'))
    }).exec()
  })
  check()
  const c = canvas.getContext('2d'), layout = planReport(c, report)
  canvas.width = layout.width; canvas.height = layout.height
  const sources = [...new Set(layout.commands.filter(command => command.kind === 'image').map(command => command.src))]
  const images = new Map()
  await Promise.all(sources.map(async src => {
    const image = canvas.createImage()
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('画页素材读取失败，请重试')); image.src = src })
    check(); images.set(src, image)
  }))
  check()
  c.fillStyle = PALETTE.border; c.fillRect(0, 0, layout.width, layout.height)
  c.fillStyle = PALETTE.paper; c.fillRect(24, 24, layout.width - 48, layout.height - 48)
  for (const command of layout.commands) {
    c.fillStyle = command.color || PALETTE.ink
    c.strokeStyle = command.color || PALETTE.line
    if (command.kind === 'image') c.drawImage(images.get(command.src), command.x, command.y, command.width, command.height)
    else if (command.kind === 'rect') c.fillRect(command.x, command.y, command.width, command.height)
    else if (command.kind === 'line') { c.lineWidth = 1; c.beginPath(); c.moveTo(command.x, command.y); c.lineTo(command.x + command.width, command.y); c.stroke() }
    else if (command.kind === 'stamp') {
      c.strokeStyle = '#845645'; c.lineWidth = 1
      c.beginPath(); c.moveTo(command.x, command.y); c.lineTo(command.x + command.width, command.y)
      c.lineTo(command.x + command.width, command.y + command.height); c.lineTo(command.x, command.y + command.height); c.lineTo(command.x, command.y); c.stroke()
    } else if (command.kind === 'text') {
      c.font = command.size + 'px sans-serif'; c.textAlign = command.align
      command.lines.forEach((line, i) => c.fillText(line, command.x, command.y + i * (command.size + 10)))
    }
  }
  c.textAlign = 'left'
  check()
  const result = await nativeCall('canvasToTempFilePath', { canvas, width: layout.width, height: layout.height,
    destWidth: layout.width, destHeight: layout.height, fileType: 'png' }, page)
  check()
  if (!result.tempFilePath) throw new Error('没有生成图片，请重试')
  return result.tempFilePath
}
module.exports = { reportImage, planReport }

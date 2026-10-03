function readMonthly(data) {
  const money = value => typeof value === 'string' && /^\d+\.\d{2}$/.test(value)
  const count = value => Number.isSafeInteger(value) && value >= 0
  const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  if (!data || !/^\d{4}-\d{2}$/.test(data.month) || !day(data.today) || !day(data.cutoff_date) ||
      typeof data.is_current !== 'boolean' || typeof data.has_activity !== 'boolean' || !data.totals ||
      !count(data.totals.purchase_count) || !count(data.totals.usage_count) ||
      !['purchase_total', 'maintenance_total', 'disposal_total'].every(k => money(data.totals[k])) ||
      !Array.isArray(data.purchases) || !data.purchases.every(i => i && count(i.id) && i.id > 0 && typeof i.name === 'string' && day(i.purchase_date) && money(i.purchase_price)) ||
      !Array.isArray(data.memories) || !data.memories.every(i => i && typeof i.key === 'string' && count(i.item_id) && i.item_id > 0 && typeof i.name === 'string' && typeof i.label === 'string' && day(i.date))) {
    throw new Error('月度数据格式异常，请重试')
  }
  return data
}
// Measure native canvas text; use an ellipsis only when the reserved line count is exhausted.
function wrapLines(context, text, width, maxLines) {
  const chars = Array.from(String(text).replace(/\s+/g, ' ')), lines = []
  let line = ''
  for (let index = 0; index < chars.length; index++) {
    const next = line + chars[index]
    if (context.measureText(next).width > width && line) {
      lines.push(line); line = ''
      if (lines.length === maxLines) {
        let last = lines.pop()
        while (last && context.measureText(last + '…').width > width) last = Array.from(last).slice(0, -1).join('')
        lines.push(last + '…'); return lines
      }
    }
    line += chars[index]
  }
  if (line) lines.push(line)
  return lines
}
module.exports = { readMonthly, wrapLines }

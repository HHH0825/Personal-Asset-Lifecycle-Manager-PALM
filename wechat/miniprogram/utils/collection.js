const { filterItems, TYPE_OPTIONS } = require('./view')
const SORTS = ['最近添加', '持有最久', '购买价格从高到低', '净成本/天从高到低']
function select(items, query, status, category, sort = 0) {
  return filterItems(items, query, status).filter(i => !category || i.category === category).sort((a, b) => {
    const pin = Number(!!b.is_pinned) - Number(!!a.is_pinned)
    if (pin) return pin
    const key = [null, 'holding_days', 'purchase_price', 'daily_net_cost'][sort]
    if (key) {
      if (a[key] == null && b[key] != null) return 1
      if (b[key] == null && a[key] != null) return -1
      const difference = Number(b[key]) - Number(a[key])
      if (difference) return difference
    }
    return b.id - a.id
  })
}
function art(type) { return '/assets/paper/type-' + (TYPE_OPTIONS.some(r => r[0] === type) ? type : 'other') + '.png' }
function preferences(user) {
  let s
  try { s = user && user.id && wx.getStorageSync('wwjCollection:' + user.id) } catch (_) {}
  return { layout: s && s.layout === 'wall' ? 'wall' : 'list',
    sortIndex: s && Number.isInteger(s.sortIndex) && s.sortIndex >= 0 && s.sortIndex < SORTS.length ? s.sortIndex : 0 }
}
function savePreferences(user, data) {
  try { if (user && user.id) wx.setStorageSync('wwjCollection:' + user.id, { layout: data.layout, sortIndex: data.sortIndex }) } catch (_) {}
}
function keepsakes(items) {
  return items.flatMap(i => ((i.milestones || {}).earned || []).map(s => ({
    ...s, key: i.id + '-' + s.id, itemId: i.id, name: i.name
  }))).sort((a, b) => b.date.localeCompare(a.date) || b.itemId - a.itemId)
}
module.exports = { SORTS, select, art, preferences, savePreferences, keepsakes }

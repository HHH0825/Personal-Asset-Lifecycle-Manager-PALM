const TYPE_OPTIONS = [
  ['digital', '数码', '▣'], ['home', '家居', '⌂'], ['daily', '日用', '◈'],
  ['clothing', '衣物', '♧'], ['books', '书籍文具', '▤'], ['mobility', '出行', '◉'],
  ['sports', '运动', '◇'], ['tools', '工具', '⚒'], ['other', '其他', '✦']
]
const STATUS = { active: '使用中', idle: '闲置', disposed: '已处置' }
const METHODS = { sold: '出售', gifted: '赠送', discarded: '丢弃', other: '其他' }

function icon(type) { return (TYPE_OPTIONS.find(row => row[0] === type) || TYPE_OPTIONS[8])[2] }
function decorate(item) {
  return { ...item, icon: icon(item.icon_type), statusText: STATUS[item.status] || item.status,
    dailyNet: item.daily_net_cost == null ? '暂无' : `¥${item.daily_net_cost}`,
    dailyPurchase: item.daily_purchase_cost == null ? '暂无' : `¥${item.daily_purchase_cost}` }
}
function filterItems(items, query, status) {
  const term = (query || '').trim().toLocaleLowerCase()
  return items.filter(item => (!status || item.status === status) &&
    (!term || `${item.name} ${item.category} ${item.notes || ''}`.toLocaleLowerCase().includes(term)))
}
function errorMessage(error) { return error && error.message ? error.message : '操作失败，请重试' }
function today() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

module.exports = { TYPE_OPTIONS, STATUS, METHODS, icon, decorate, filterItems, errorMessage, today }

const test = require('node:test')
const assert = require('node:assert/strict')
const { select, keepsakes, preferences, savePreferences } = require('../miniprogram/utils/collection')
test('collection combines filters, pin priority, numeric sorts and missing daily cost', () => {
  const items = [
    { id: 1, name: '相机', category: '摄影', status: 'active', daily_net_cost: '-2.00', purchase_price: '900.00', holding_days: 100 },
    { id: 2, name: '相机新', category: '摄影', status: 'active', daily_net_cost: null, purchase_price: '100.00', holding_days: 0 },
    { id: 3, name: '书', category: '阅读', status: 'idle', daily_net_cost: '1.00', purchase_price: '50.00', holding_days: 50, is_pinned: true },
    { id: 4, name: '相机旧', category: '摄影', status: 'active', daily_net_cost: '-2.00', purchase_price: '900.00', holding_days: 100 }
  ]
  assert.deepEqual(select(items, '', '', '', 3).map(i => i.id), [3, 4, 1, 2])
  assert.deepEqual(select(items, '相机', 'active', '摄影', 2).map(i => i.id), [4, 1, 2])
  assert.deepEqual(select(items, '', '', '', 1).map(i => i.id), [3, 4, 1, 2])
  assert.deepEqual(select(items, '', 'active', '阅读'), [])
  assert.deepEqual(items.map(i => i.id), [1, 2, 3, 4])
})
test('preferences contain no item data and remain separate per user', () => {
  const storage = new Map()
  global.wx = { setStorageSync: (k, v) => storage.set(k, v), getStorageSync: k => storage.get(k) }
  savePreferences({ id: 1 }, { layout: 'wall', sortIndex: 3, items: [{ secret: true }] })
  assert.deepEqual(preferences({ id: 1 }), { layout: 'wall', sortIndex: 3 })
  assert.deepEqual(preferences({ id: 2 }), { layout: 'list', sortIndex: 0 })
  assert.equal(JSON.stringify([...storage.values()]).includes('secret'), false)
})
test('keepsakes sort all supplied items by occurrence date and link to the right item', () => {
  const result = keepsakes([{ id: 1, name: '相机', milestones: { earned: [{ id: 'hundred', date: '2024-02-01' }] } },
    { id: 2, name: '书', milestones: { earned: [{ id: 'year-1', date: '2025-01-01' }] } }])
  assert.deepEqual(result.map(i => i.itemId), [2, 1])
})
test('type illustrations provide transparent triple-size fallback assets', () => {
  const fs = require('node:fs'), path = require('node:path')
  const { art } = require('../miniprogram/utils/collection')
  for (const type of ['digital', 'home', 'daily', 'clothing', 'books', 'mobility', 'sports', 'tools', 'other']) {
    const png = fs.readFileSync(path.join(__dirname, '../miniprogram', art(type)))
    assert.equal(png.readUInt32BE(16), 288); assert.equal(png.readUInt32BE(20), 288)
    assert.equal(png[25], 6)
  }
  assert.equal(art('unknown'), art('other'))
})
function pageHarness(name, options = {}) {
  const requests = [], toasts = []
  const app = { globalData: { token: 'alice', user: { id: 1 } }, requireSession() { return !!this.globalData.token } }
  global.getApp = () => app
  global.wx = { request: o => requests.push(o), showToast: o => toasts.push(o), getStorageSync() {} }
  let definition
  global.Page = p => { definition = p }
  const path = '../miniprogram/pages/' + name + '/index'
  delete require.cache[require.resolve(path)]; require(path)
  const page = { ...definition, data: structuredClone(definition.data), setData(patch, callback) {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split('.'); let target = this.data
      while (parts.length > 1) { const part = parts.shift(); target = target[part] || (target[part] = {}) }
      target[parts[0]] = value
    }
    if (callback) callback()
  } }
  page.onLoad(options); page._visible = true
  return { page, app, requests, toasts, respond(index, data) { requests[index].success({ statusCode: 200, data }) } }
}
test('return position selects a nearby surviving item and rejects old-account callbacks', () => {
  const h = pageHarness('items'), calls = [], scrolls = []
  h.page.data.shown = [{ id: 1 }, { id: 3 }]
  h.page._anchor = { id: 2, offset: 20, index: 1 }
  global.wx.pageScrollTo = o => scrolls.push(o)
  global.wx.createSelectorQuery = () => ({ in() { return this }, select(selector) { calls.push(selector); return this },
    boundingClientRect() { return this }, selectViewport() { return this }, scrollOffset() { return this }, exec(callback) {
      calls.push(callback)
    } })
  h.page.restorePosition()
  assert.equal(calls[0], '#item-3')
  calls[1]([{ top: 50 }, { scrollTop: 100 }])
  assert.equal(scrolls[0].scrollTop, 130)
  h.page.restorePosition(); h.app.globalData.token = 'bob'
  calls[3]([{ top: 200 }, { scrollTop: 100 }])
  assert.equal(scrolls.length, 1)
})
test('collection and detail no longer expose daily-use actions', () => {
  const h = pageHarness('items')
  assert.equal(h.page.quickUse, undefined)
  const detail = pageHarness('item', { id: 1 })
  assert.equal(detail.page.quickUse, undefined)
  assert.equal(h.requests.length, 0)
})

test('daily target validates, prevents duplicate saves and discards switched-account results', async () => {
  const h = pageHarness('item', { id: 1 })
  h.page.data.item = { id: 1, status: 'active' }
  await h.page.writeTarget('0'); assert.equal(h.requests.length, 0)
  const pending = h.page.writeTarget('5.00')
  await h.page.writeTarget('6'); assert.equal(h.requests.length, 1)
  h.respond(0, { id: 1, status: 'active', daily_target: { amount: '5.00' } }); await pending
  assert.equal(h.page.data.item.daily_target.amount, '5.00')
  const cancel = h.page.cancelTarget()
  assert.equal(h.requests[1].data.amount, null)
  h.app.globalData.token = 'bob'; h.respond(1, { id: 1, status: 'active', daily_target: null }); await cancel
  assert.equal(h.page.data.item.daily_target.amount, '5.00')
})
const monthlyFixture = (month = '2025-01') => ({ month, today: '2026-01-01', cutoff_date: month + '-31', is_current: false,
  has_activity: false, totals: { purchase_count: 0, purchase_total: '0.00', maintenance_total: '0.00', disposal_total: '0.00', cashflow_net: '0.00' }, purchases: [], memories: [], purchase_leaders: [] })
test('monthly reload clears old export and earlier month responses cannot replace a new month', async () => {
  const h = pageHarness('monthly')
  h.page.data.imagePath = 'old-image.png'
  const first = h.page.load()
  assert.equal(h.page.data.imagePath, '')
  h.page._requested = '2025-03'
  const second = h.page.load()
  h.respond(1, monthlyFixture('2025-03')); await second
  h.respond(0, monthlyFixture('2025-01')); await first
  assert.equal(h.page.data.report.month, '2025-03')
  const failed = h.page.load()
  h.requests[2].fail({ errMsg: 'failed' }); await failed
  assert.equal(h.page.data.report, null)
  await h.page.saveImage()
  assert.equal(h.requests.length, 3)
})
test('monthly section failure keeps valid discovery stats and text wrap never exceeds reserved lines', async () => {
  const { wrapLines } = require('../miniprogram/utils/monthly')
  const context = { measureText: s => ({ width: Array.from(s).length * 10 }) }
  const lines = wrapLines(context, '一个非常非常长的中文物品名字和 emoji 📷📷📷', 60, 2)
  assert.equal(lines.length, 2); assert.ok(lines[1].endsWith('…'))
  assert.ok(lines.every(line => context.measureText(line).width <= 60))
  const h = pageHarness('insights')
  h.page.data.stats = { total_items: 7 }
  const pending = h.page.loadMonthly()
  h.respond(0, { month: '2025-01' }); await pending
  assert.equal(h.page.data.stats.total_items, 7)
  assert.match(h.page.data.monthlyError, /格式异常/)
})
test('report PNG keeps long entries inside reserved rows and only includes three of each kind', async () => {
  const { reportImage } = require('../miniprogram/utils/report-image')
  const drawn = [], exports = []
  const context = { fillRect() {}, drawImage() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    measureText(text) { const size = parseInt(this.font) || 24; return { width: Array.from(text).length * size } },
    fillText(text, x, y) { drawn.push({ text, x, y, size: parseInt(this.font) }) } }
  const canvas = { getContext: () => context, createImage() { const image = {}; Object.defineProperty(image, 'src', { set() { image.onload() } }); return image } }
  global.wx = { createSelectorQuery() { return { in() { return this }, select() { return this },
    fields(options, callback) { callback({ node: canvas }); return this }, exec() {} } },
    canvasToTempFilePath(options) { exports.push(options); options.success({ tempFilePath: 'report.png' }) } }
  const report = monthlyFixture()
  report.has_activity = true
  report.purchases = Array.from({ length: 5 }, (_, i) => ({ name: '独立测试长名称'.repeat(20) + i, purchase_date: '2025-01-01', purchase_price: '0.00' }))
  report.memories = Array.from({ length: 5 }, (_, i) => ({ name: '长名字'.repeat(20) + i, label: '相伴 1 年', date: '2025-01-01' }))
  assert.equal(await reportImage({}, report, () => true), 'report.png')
  assert.equal(exports[0].fileType, 'png')
  assert.equal(exports[0].destWidth, 720)
  assert.ok(exports[0].destHeight > 1000)
  assert.ok(drawn.some(i => /另有 2 件/.test(i.text)))
  assert.ok(drawn.some(i => /另有 2 条/.test(i.text)))
  assert.ok(drawn.every(i => i.y < exports[0].destHeight - 24))
  const empty = monthlyFixture()
  await reportImage({}, empty, () => true)
  assert.ok(exports[1].destHeight < exports[0].destHeight)
  assert.equal(drawn.some(i => /记录的使用/.test(i.text)), false)
  await assert.rejects(reportImage({}, report, () => false), /取消/)
})

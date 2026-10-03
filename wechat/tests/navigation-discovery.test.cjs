const test = require('node:test')
const assert = require('node:assert/strict')
const { resetNavigation } = require('../miniprogram/utils/navigation')

const stats = (count = 0) => ({ total_items: count, net_cost_total: '-10.00', purchase_total: '20.00',
  maintenance_total: '0.00', disposal_total: '30.00' })
const insights = (name = '相机') => ({ analysis_cards: [{ kind: 'unknown_use', label: '记录缺口',
  headline: name, explanation: '依据已保存记录', items: [{ id: 3, name, icon_type: 'digital' }] }] })

function harness(name) {
  const requests = [], navigation = [], messages = []
  const app = { globalData: { token: 'alice' }, requireSession() { return !!this.globalData.token },
    clearSession() { this.globalData.token = '' } }
  global.getApp = () => app
  global.wx = { request(options) { requests.push(options) }, navigateTo(options) { navigation.push(options) },
    showModal(options) { messages.push(options) }, reLaunch() {}, stopPullDownRefresh() {} }
  let definition
  global.Page = value => { definition = value }
  const path = `../miniprogram/pages/${name}/index`
  delete require.cache[require.resolve(path)]
  require(path)
  const page = { ...definition, data: structuredClone(definition.data), setData(patch, done) {
    Object.assign(this.data, patch); if (done) done()
  } }
  page.onLoad()
  page._visible = true
  return { page, app, requests, navigation, messages,
    respond(index, data, statusCode = 200) { requests[index].success({ statusCode, data }) },
    fail(index) { requests[index].fail({ errMsg: 'request:fail connection refused' }) } }
}

test('entry navigation blocks duplicate taps, reports failure and retries on returning', () => {
  for (const name of ['items', 'me', 'insights']) {
    const h = harness(name), page = h.page
    const click = name === 'items' ? () => page.add() : name === 'me' ? () => page.profile()
      : () => page.open({ currentTarget: { dataset: { id: 3 } } })
    click(); click()
    assert.equal(h.navigation.length, 1)
    const originalWarn = console.warn
    try {
      console.warn = () => {}
      h.navigation[0].fail({ errMsg: 'navigateTo:fail page not found' })
    } finally { console.warn = originalWarn }
    assert.equal(h.messages[0].content, '页面暂时无法打开，请重试')
    click()
    assert.equal(h.navigation.length, 2)
    page.onHide()
    h.navigation[1].fail({ errMsg: 'late failure' })
    assert.equal(h.messages.length, 1)
    page.onShow()
    click()
    assert.equal(h.navigation.length, 3)
    h.app.globalData.token = 'bob'
    h.navigation[2].fail({ errMsg: 'old account failure' })
    assert.equal(h.messages.length, 1)
    // Pending reads are not settled here; they cannot write after the test finishes.
  }
})

test('item card navigation uses the item id and synchronous failures release the lock', () => {
  const h = harness('items')
  h.page.open({ currentTarget: { dataset: { id: 42 } } })
  assert.equal(h.navigation[0].url, '/pages/item/index?id=42')
  resetNavigation(h.page)
  const originalWarn = console.warn
  try {
    console.warn = () => {}
    wx.navigateTo = () => { throw new Error('bridge unavailable') }
    h.page.add()
  } finally { console.warn = originalWarn }
  assert.equal(h.page._navigation, null)
  assert.equal(h.messages.length, 1)
})

test('discovery keeps the successful section and retries only the failed section', async () => {
  for (const failed of ['stats', 'cards']) {
    const h = harness('insights'), pending = h.page.load()
    h.respond(failed === 'stats' ? 1 : 0, failed === 'stats' ? insights() : stats(2))
    h.fail(failed === 'stats' ? 0 : 1)
    await pending
    assert.match(h.page.data[`${failed}Error`], /连接失败/)
    assert.equal(h.page.data.statsLoading, false)
    assert.equal(h.page.data.cardsLoading, false)
    const preserved = failed === 'stats' ? h.page.data.cards : h.page.data.stats
    const retry = failed === 'stats' ? h.page.loadStats() : h.page.loadCards()
    assert.equal(h.requests.length, 3)
    assert.ok(h.requests[2].url.endsWith(failed === 'stats' ? '/stats' : '/insights'))
    h.respond(2, failed === 'stats' ? stats(2) : insights())
    await retry
    assert.deepEqual(failed === 'stats' ? h.page.data.cards : h.page.data.stats, preserved)
    assert.equal(h.page.data[`${failed}Error`], '')
  }
})

test('discovery distinguishes malformed responses from valid zero stats and empty analyses', async () => {
  const h = harness('insights'), pending = h.page.load()
  h.respond(0, { total_items: 0 }); h.respond(1, { analysis_cards: [{ items: null }] })
  await pending
  assert.match(h.page.data.statsError, /格式异常/)
  assert.match(h.page.data.cardsError, /格式异常/)
  assert.equal(h.page.data.stats, null)
  const retry = h.page.load()
  h.respond(2, stats()); h.respond(3, { analysis_cards: [] })
  await retry
  assert.equal(h.page.data.stats.total_items, 0)
  assert.deepEqual(h.page.data.cards, [])
  assert.equal(h.page.data.statsError, '')
  assert.equal(h.page.data.cardsError, '')
})

test('discovery discards reordered reads, reads after leaving and reads from the old account', async () => {
  const h = harness('insights')
  const first = h.page.load(), second = h.page.load()
  h.respond(2, stats(5)); h.respond(3, insights('新记录'))
  await second
  h.respond(0, stats(1)); h.respond(1, insights('旧记录'))
  await first
  assert.equal(h.page.data.stats.total_items, 5)
  assert.equal(h.page.data.cards[0].headline, '新记录')
  const leaving = h.page.load()
  h.page.onHide()
  const hidden = structuredClone(h.page.data)
  h.respond(4, stats(2)); h.fail(5)
  await leaving
  assert.deepEqual(h.page.data, hidden)
  h.page._visible = true
  const switching = h.page.load()
  h.app.globalData.token = 'bob'
  const before = structuredClone(h.page.data)
  h.respond(6, stats(9)); h.respond(7, insights('旧账号'))
  await switching
  assert.deepEqual(h.page.data, before)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const view = require('../miniprogram/utils/view')
const { createThumbnailLoader } = require('../miniprogram/utils/thumbnails')
const { welcomeLayout, readWindowInfo } = require('../miniprogram/utils/layout')
const tick = () => new Promise(resolve => setImmediate(resolve))

test('ledger theme text remains readable on buttons, paper and small pastel labels', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const css = fs.readFileSync(path.join(__dirname, '../miniprogram/app.wxss'), 'utf8')
  const colors = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)].map(match => [match[1], match[2]]))
  const luminance = color => {
    const linear = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return linear.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
  }
  const pairs = [['ink', 'primary'], ['muted', 'bg'], ['muted', 'paper'], ['accent', 'paper'], ['accent', 'bg'],
    ['peach-ink', 'peach'], ['yellow-ink', 'yellow'], ['mint-ink', 'mint'], ['lavender-ink', 'lavender'],
    ['blue', 'blue-soft'], ['neutral-ink', 'neutral'], ['danger', 'danger-soft'],
    ['ink', 'ledger'], ['muted', 'ledger'], ['ink-soft', 'ledger'],
    ...['paper-dot', 'wash-peach', 'wash-yellow'].flatMap(background => [['ink', background], ['muted', background]]),
    ...['peach', 'yellow', 'mint', 'lavender', 'blue-soft', 'neutral'].map(background => ['ink-soft', background])]
  for (const [foreground, background] of pairs) {
    assert.ok(colors[foreground] && colors[background], `missing color for ${foreground}/${background}`)
    const [dark, light] = [luminance(colors[foreground]), luminance(colors[background])].sort((a, b) => a - b)
    assert.ok((light + 0.05) / (dark + 0.05) >= 4.5, `low contrast: ${foreground}/${background}`)
  }
})

// Use the real request/session/page code with a controlled WeChat runtime.
function profileHarness() {
  const requests = [], navigation = [], storage = new Map()
  let appDefinition
  global.App = definition => { appDefinition = definition }
  global.wx = {
    request(options) { requests.push(options) },
    setStorageSync(key, value) { storage.set(key, structuredClone(value)) },
    getStorageSync(key) { return storage.get(key) },
    removeStorageSync(key) { storage.delete(key) },
    navigateTo(options) { navigation.push(['navigateTo', options.url]) },
    navigateBack(options) { navigation.push(['navigateBack', options.delta]) },
    switchTab(options) { navigation.push(['switchTab', options.url]) },
    reLaunch(options) { navigation.push(['reLaunch', options.url]) },
    showToast() {}
  }
  delete require.cache[require.resolve('../miniprogram/app')]
  require('../miniprogram/app')
  const app = { ...appDefinition, globalData: { token: 'alice-session',
    expiresAt: Math.floor(Date.now() / 1000) + 3600, user: { id: 1, username: '原昵称', avatar_key: 'sprout' } } }
  global.getApp = () => app
  global.getCurrentPages = () => [{ route: 'pages/me/index' }, { route: 'pages/profile/index' }]
  function page(name = 'profile') {
    let definition
    global.Page = value => { definition = value }
    const path = `../miniprogram/pages/${name}/index`
    delete require.cache[require.resolve(path)]
    require(path)
    const instance = { ...definition, data: structuredClone(definition.data),
      setData(patch) { Object.assign(this.data, patch) } }
    instance.onLoad()
    instance._visible = true
    return instance
  }
  function respond(index, data, statusCode = 200) { requests[index].success({ statusCode, data }) }
  async function loaded(name = 'profile') {
    const instance = page(name)
    const index = requests.length
    const promise = instance.load()
    respond(index, { user: structuredClone(app.globalData.user) })
    await promise
    return instance
  }
  return { app, page, loaded, respond, requests, storage, navigation, appDefinition }
}

test('profile saves once, keeps credentials and persists updated user across restart', async () => {
  const h = profileHarness()
  const page = await h.loaded()
  page.nameInput({ detail: { value: '新的手账昵称' } })
  page.avatarChange({ detail: { value: '1' } })
  const expiresAt = h.app.globalData.expiresAt
  const pending = page.save()
  await page.save()
  assert.equal(h.requests.length, 2)
  assert.match(h.requests[1].url, /\/api\/mp\/profile$/)
  assert.equal(h.requests[1].method, 'PUT')
  assert.deepEqual(h.requests[1].data, { username: '新的手账昵称', avatar_key: 'cat' })
  const user = { id: 1, username: '新的手账昵称', avatar_key: 'cat' }
  h.respond(1, { user })
  await pending
  assert.equal(page.data.busy, false)
  assert.deepEqual(h.app.globalData, { token: 'alice-session', expiresAt, user })
  assert.deepEqual(h.storage.get('palmSession'), h.app.globalData)
  assert.deepEqual(h.navigation, [['navigateBack', 1]])
  const restarted = { ...h.appDefinition, globalData: { token: '', expiresAt: 0, user: null } }
  restarted.onLaunch()
  assert.deepEqual(restarted.globalData, h.app.globalData)
})

test('profile blocks saving before a successful read and keeps draft after validation failure', async () => {
  const h = profileHarness()
  const page = h.page()
  await page.save()
  assert.equal(h.requests.length, 0)
  const failed = page.load()
  h.respond(0, { error: '读取失败' }, 503)
  await failed
  assert.equal(page.data.loaded, false)
  assert.equal(page.data.loading, false)
  assert.equal(page.data.error, '读取失败')
  await page.save()
  assert.equal(h.requests.length, 1)
  const retry = page.load()
  h.respond(1, { user: h.app.globalData.user })
  await retry
  page.nameInput({ detail: { value: 'x' } })
  page.avatarChange({ detail: { value: '5' } })
  const save = page.save()
  h.respond(2, { error: '显示名称至少 2 个字符' }, 400)
  await save
  assert.equal(page.data.name, 'x')
  assert.equal(page.data.avatarIndex, 5)
  assert.match(page.data.error, /至少 2/)
  assert.equal(page.data.busy, false)
  assert.equal(h.storage.size, 0)
  assert.deepEqual(h.navigation, [])
})

test('profile return discards draft and standalone page returns to Me tab without writing', async () => {
  const h = profileHarness()
  const page = await h.loaded()
  page.nameInput({ detail: { value: '不保存' } })
  page.back()
  page.onHide()
  assert.equal(page.data.name, '')
  assert.equal(h.requests.length, 1)
  assert.equal(h.app.globalData.user.username, '原昵称')
  global.getCurrentPages = () => [{ route: 'pages/profile/index' }]
  page.back()
  assert.deepEqual(h.navigation, [['navigateBack', 1], ['switchTab', '/pages/me/index']])
})

test('profile reads discard reordered responses and old account data', async () => {
  const h = profileHarness()
  const page = h.page()
  const first = page.load()
  const second = page.load()
  h.respond(1, { user: { id: 1, username: '最新昵称', avatar_key: 'book' } })
  await second
  h.respond(0, { user: { id: 1, username: '旧昵称', avatar_key: 'cat' } })
  await first
  assert.equal(page.data.name, '最新昵称')
  const oldAccount = page.load()
  h.app.globalData = { token: 'bob-session', expiresAt: h.app.globalData.expiresAt, user: { id: 2, username: '乙' } }
  h.respond(2, { user: { id: 1, username: '甲', avatar_key: 'sun' } })
  await oldAccount
  assert.notEqual(page.data.name, '甲')
  assert.equal(h.storage.size, 0)
})

test('profile late reads and saves after leaving do not change page, session or navigation', async () => {
  for (const leave of ['onHide', 'onUnload']) {
    const h = profileHarness()
    const page = await h.loaded()
    const save = page.save()
    page[leave]()
    const snapshot = structuredClone(page.data)
    h.respond(1, { user: { id: 1, username: '迟来的修改', avatar_key: 'cat' } })
    await save
    assert.deepEqual(page.data, snapshot)
    assert.equal(h.app.globalData.user.username, '原昵称')
    assert.equal(h.storage.size, 0)
    assert.deepEqual(h.navigation, [])
    const readPage = h.page()
    const read = readPage.load()
    readPage[leave]()
    h.respond(2, { user: { id: 1, username: '迟来的读取', avatar_key: 'sun' } })
    await read
    assert.equal(readPage.data.user, null)
  }
})

test('profile switched-account save cannot replace the new session or navigate it away', async () => {
  const h = profileHarness()
  const page = await h.loaded()
  const save = page.save()
  const bob = { token: 'bob-session', expiresAt: h.app.globalData.expiresAt, user: { id: 2, username: '乙' } }
  h.app.globalData = bob
  h.respond(1, { user: { id: 1, username: '甲的新昵称' } })
  await save
  assert.deepEqual(h.app.globalData, bob)
  assert.equal(h.storage.size, 0)
  assert.deepEqual(h.navigation, [])
})

test('profile reports partial success when storage fails and refuses expired session updates', async () => {
  const h = profileHarness()
  const page = await h.loaded()
  wx.setStorageSync = () => { throw new Error('storage full') }
  const save = page.save()
  h.respond(1, { user: { id: 1, username: '已保存到服务器', avatar_key: 'cat' } })
  await save
  assert.match(page.data.error, /资料已保存/)
  assert.equal(page.data.busy, false)
  h.app.globalData.expiresAt = 1
  assert.equal(h.app.updateUser({ id: 1, username: '过期资料' }, 'alice-session'), false)
  assert.equal(h.app.globalData.user.username, '已保存到服务器')
})

test('Me enters profile, reloads current user and protects a new account during logout', async () => {
  const h = profileHarness()
  const page = await h.loaded('me')
  page.profile()
  assert.deepEqual(h.navigation, [['navigateTo', '/pages/profile/index']])
  page.onHide()
  assert.equal(page.data.user, null)
  page._visible = true
  const reload = page.load()
  h.respond(1, { user: { id: 1, username: '返回后的昵称', avatar_key: 'star' } })
  await reload
  assert.equal(page.data.user.username, '返回后的昵称')
  assert.equal(page.data.avatarSymbol, '✦')
  const logout = page.logout()
  h.app.globalData.token = 'bob-session'
  h.respond(2, undefined, 204)
  await logout
  assert.equal(h.app.globalData.token, 'bob-session')
  assert.equal(h.navigation.length, 1)
})

test('welcome sizing handles short, tall and wide windows without oversized artwork', () => {
  const small = welcomeLayout({ windowWidth: 320, windowHeight: 504 })
  assert.equal(small.compact, true)
  assert.equal(small.heroStyle, 'height:140px;')
  assert.match(small.pageStyle, /--welcome-title:28px/)
  const tall = welcomeLayout({ windowWidth: 366, windowHeight: 745 })
  assert.equal(tall.compact, false)
  assert.equal(tall.heroStyle, 'height:179px;')
  const large = welcomeLayout({ windowWidth: 1024, windowHeight: 1200 })
  assert.equal(large.heroStyle, 'height:220px;')
  assert.match(large.pageStyle, /--welcome-title:34px/)
  assert.match(large.pageStyle, /padding-left:22px/)
})

test('missing or invalid window data preserves a usable default layout', () => {
  assert.deepEqual(welcomeLayout({ windowWidth: NaN, windowHeight: -1 }), welcomeLayout())
  global.wx = { getWindowInfo() { throw new Error('unavailable') } }
  assert.deepEqual(readWindowInfo(), {})
  global.wx = {}
  assert.deepEqual(readWindowInfo(), {})
})

test('welcome page reflows on window resize without triggering login', () => {
  let definition
  global.Page = page => { definition = page }
  global.getApp = () => ({ hasSession: () => false })
  global.wx = { getWindowInfo: () => ({ windowWidth: 390, windowHeight: 753 }) }
  require('../miniprogram/pages/login/index')
  const page = { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value) } }
  page.onLoad()
  assert.equal(page.data.heroStyle, 'height:181px;')
  page.onResize({ size: { windowWidth: 320, windowHeight: 504 } })
  assert.equal(page.data.heroStyle, 'height:140px;')
  assert.equal(page.data.compact, true)
  assert.equal(page.data.busy, false)
})

test('display costs, status and fallback icon without changing calculations', () => {
  const item = view.decorate({ icon_type: 'digital', status: 'disposed', daily_net_cost: '-0.50', daily_purchase_cost: null })
  assert.equal(item.dailyNet, '¥-0.50')
  assert.equal(item.dailyPurchase, '暂无')
  assert.equal(item.statusText, '已处置')
  assert.equal(view.icon('unsupported'), view.icon('other'))
})

test('search and status filters combine for one account list', () => {
  const items = [
    { name: '相机', category: '数码', notes: '摄影', status: 'active' },
    { name: '旧相机', category: '数码', notes: '', status: 'disposed' },
    { name: '书', category: '纸品', notes: '', status: 'active' }
  ]
  assert.deepEqual(view.filterItems(items, '相机', 'active'), [items[0]])
  assert.deepEqual(view.filterItems(items, '摄影', ''), [items[0]])
  assert.equal(view.filterItems(items, '无结果', '').length, 0)
})

test('in-flight response cannot return old-account data after switching', async () => {
  let respond
  const app = { globalData: { token: 'old' }, clearSession() {} }
  global.getApp = () => app
  global.wx = { request(options) { respond = options.success }, reLaunch() {} }
  const api = require('../miniprogram/utils/api')
  const pending = api.request('/items')
  app.globalData.token = 'new'
  respond({ statusCode: 200, data: [{ name: '旧账户的物品' }] })
  await assert.rejects(pending, /账户已切换/)
})

test('thumbnail reads deduplicate, respect concurrency and fall back on failure', async () => {
  const calls = []
  const gates = new Map()
  const loader = createThumbnailLoader({ getSession: () => 'owner', maxConcurrent: 2,
    download(id) { calls.push(id); return new Promise((resolve, reject) => gates.set(id, { resolve, reject })) } })
  const first = loader.load(1)
  assert.equal(loader.load(1), first)
  const second = loader.load(2)
  const third = loader.load(3)
  await tick()
  assert.deepEqual(calls, [1, 2])
  gates.get(1).resolve('tmp/one.jpg')
  assert.equal(await first, 'tmp/one.jpg')
  await tick()
  assert.deepEqual(calls, [1, 2, 3])
  gates.get(2).reject(new Error('offline'))
  gates.get(3).resolve('tmp/three.jpg')
  assert.equal(await second, '')
  assert.equal(await third, 'tmp/three.jpg')
  assert.equal(await loader.load(1), 'tmp/one.jpg')
  loader.dispose()
})

test('reset and account switching discard old temporary photo paths', async () => {
  let session = 'alice'
  const gates = []
  const loader = createThumbnailLoader({ getSession: () => session, maxConcurrent: 1,
    download() { return new Promise(resolve => gates.push(resolve)) } })
  const old = loader.load(1)
  const queued = loader.load(2)
  await tick()
  session = 'bob'
  loader.reset()
  assert.equal(await queued, '')
  const fresh = loader.load(1)
  gates[0]('alice-photo')
  assert.equal(await old, '')
  await tick()
  gates[1]('bob-photo')
  assert.equal(await fresh, 'bob-photo')
  loader.reset()
  const afterReplacement = loader.load(1)
  await tick()
  gates[2]('replacement-photo')
  assert.equal(await afterReplacement, 'replacement-photo')
  loader.dispose()
})

test('item page loads photos only when visible and clears them when leaving', async () => {
  const api = require('../miniprogram/utils/api')
  const originalRequest = api.request
  const originalDownload = api.downloadPhoto
  let observerCallback
  let downloads = 0
  let definition
  global.getApp = () => ({ globalData: { token: 'owner' } })
  global.Page = page => { definition = page }
  global.wx = { createIntersectionObserver() {
    return { relativeToViewport() { return this }, observe(selector, callback) { observerCallback = callback }, disconnect() {} }
  } }
  api.request = async () => [{ id: 1, name: '相机', category: '数码', status: 'active', icon_type: 'digital', photo_url: '/photo' }]
  api.downloadPhoto = async () => { downloads += 1; return 'temporary-photo' }
  try {
    delete require.cache[require.resolve('../miniprogram/pages/items/index')]
    require('../miniprogram/pages/items/index')
    const page = { ...definition, data: { ...definition.data }, setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() } }
    page.onLoad()
    page._visible = true
    await page.load()
    assert.equal(downloads, 0)
    observerCallback({ intersectionRatio: 0, dataset: { id: 1 } })
    await tick()
    assert.equal(downloads, 0)
    observerCallback({ intersectionRatio: 1, dataset: { id: 1 } })
    await tick()
    assert.equal(downloads, 1)
    assert.equal(page.data.photoPaths[1], 'temporary-photo')
    page.onHide()
    assert.deepEqual(page.data.photoPaths, {})
    assert.deepEqual(page.data.items, [])
    page.onUnload()
  } finally { api.request = originalRequest; api.downloadPhoto = originalDownload }
})

test('login selects the correct credential and preserves session on failure', async () => {
  const config = require('../miniprogram/config')
  const api = require('../miniprogram/utils/api')
  const oldFlag = config.DEV_LOGIN
  const oldRequest = api.request
  let definition
  let wechatCalls = 0
  const saved = []
  global.App = app => { definition = app }
  global.wx = {
    login(options) { wechatCalls += 1; options.success({ code: 'real-wechat-code' }) },
    setStorageSync(key, value) { saved.push({ key, value }) }
  }
  try {
    delete require.cache[require.resolve('../miniprogram/app')]
    require('../miniprogram/app')
    for (const devLogin of [true, false]) {
      config.DEV_LOGIN = devLogin
      let submitted
      const app = { ...definition, globalData: { ...definition.globalData } }
      global.getApp = () => app
      api.request = async (path, options) => {
        assert.equal(path, '/auth/login')
        assert.equal(options.anonymous, true)
        submitted = options.data.code
        return { token: 'test-token', expires_at: 123456, user: { id: 1 } }
      }
      await app.login()
      assert.equal(submitted, devLogin ? `dev:${config.DEV_ACCOUNT}` : 'real-wechat-code')
      assert.equal(app.globalData.token, 'test-token')
      const before = app.globalData
      api.request = async () => { throw new Error('本地调试登录未开启') }
      await assert.rejects(app.login(), /本地调试登录未开启/)
      assert.equal(app.globalData, before)
    }
    assert.equal(wechatCalls, 2)
    assert.equal(saved.length, 2)
    assert.ok(saved.every(entry => entry.key === 'palmSession'))
  } finally { config.DEV_LOGIN = oldFlag; api.request = oldRequest }
})

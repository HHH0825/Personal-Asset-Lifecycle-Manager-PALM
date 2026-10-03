const test = require('node:test')
const assert = require('node:assert/strict')
const view = require('../miniprogram/utils/view')
const { createThumbnailLoader } = require('../miniprogram/utils/thumbnails')
const { welcomeLayout, readWindowInfo } = require('../miniprogram/utils/layout')
const tick = () => new Promise(resolve => setImmediate(resolve))

test('archival theme text remains readable on buttons, textured paper and collages', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const css = fs.readFileSync(path.join(__dirname, '../miniprogram/app.wxss'), 'utf8')
  const colors = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)].map(match => [match[1], match[2]]))
  // The densest grain is #C7B8A5 at 38% over the page; check that composite, not transparent source ink.
  colors.grain = '#' + [1, 3, 5].map(offset => Math.round(parseInt('C7B8A5'.slice(offset - 1, offset + 1), 16) * .38
    + parseInt(colors.bg.slice(offset, offset + 2), 16) * .62).toString(16).padStart(2, '0')).join('')
  for (const [name, ink, base, alpha] of [['rose-lines', 'AA9180', 'rose', .19], ['sage-grid', '9BA48F', 'sage', .26]]) {
    colors[name] = '#' + [1, 3, 5].map(offset => Math.round(parseInt(ink.slice(offset - 1, offset + 1), 16) * alpha
      + parseInt(colors[base].slice(offset, offset + 2), 16) * (1 - alpha)).toString(16).padStart(2, '0')).join('')
  }
  const luminance = color => {
    const linear = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return linear.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
  }
  const pairs = [['ink', 'primary'], ['muted', 'bg'], ['muted', 'paper'], ['accent', 'paper'], ['accent', 'bg'],
    ['peach-ink', 'peach'], ['yellow-ink', 'yellow'], ['mint-ink', 'mint'], ['lavender-ink', 'lavender'],
    ['blue', 'blue-soft'], ['neutral-ink', 'neutral'], ['danger', 'danger-soft'],
    ['ink', 'ledger'], ['muted', 'ledger'], ['ink-soft', 'ledger'],
    ...['grain', 'sage', 'rose', 'tape', 'rose-lines', 'sage-grid'].flatMap(background => [['ink', background], ['muted', background]]),
    ...['peach', 'yellow', 'mint', 'lavender', 'blue-soft', 'neutral'].map(background => ['ink-soft', background])]
  for (const [foreground, background] of pairs) {
    assert.ok(colors[foreground] && colors[background], `missing color for ${foreground}/${background}`)
    const [dark, light] = [luminance(colors[foreground]), luminance(colors[background])].sort((a, b) => a - b)
    assert.ok((light + 0.05) / (dark + 0.05) >= 4.5, `low contrast: ${foreground}/${background}`)
  }
})

test('paper artwork references exist and native label text survives a failed image', () => {
  const fs = require('node:fs'), path = require('node:path')
  const root = path.join(__dirname, '../miniprogram')
  const visit = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? visit(file) : [file]
  })
  for (const file of visit(root).filter(file => /\.(wxml|wxss)$/.test(file))) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/\/assets\/paper\/([^'"\s)]+)/g)) {
      if (!match[1].includes('{{')) assert.ok(fs.existsSync(path.join(root, 'assets/paper', match[1])), file)
    }
  }
  const css = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8')
  const inline = css.match(/url\('data:image\/png;base64,([^']+)'\)/)
  assert.ok(inline, 'WXSS grain must be embedded instead of using a local background URL')
  assert.deepEqual(Buffer.from(inline[1], 'base64'), fs.readFileSync(path.join(root, 'assets/paper/grain.png')))
  for (const file of fs.readdirSync(path.join(root, 'assets/paper')).filter(file => file.endsWith('.svg'))) {
    const svg = fs.readFileSync(path.join(root, 'assets/paper', file), 'utf8')
    const width = Number(svg.match(/width="(\d+)"/)[1]), height = Number(svg.match(/height="(\d+)"/)[1])
    const png = fs.readFileSync(path.join(root, 'assets/paper', file.replace('.svg', '.png')))
    assert.equal(png.readUInt32BE(16), width * 3, file)
    assert.equal(png.readUInt32BE(20), height * 3, file)
    assert.equal(png.readUInt8(25), 6, 'PNG uses RGBA transparency')
    assert.doesNotMatch(svg, /<text\b|<image\b/, 'artwork does not embed fonts or external images')
  }
  let definition
  global.Component = value => { definition = value }
  const modulePath = '../miniprogram/components/paper-label/index'
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)
  const label = { data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch) } }
  for (const variant of ['add', 'collection', 'identity', 'purchase', 'memories', 'login', 'save']) {
    definition.observers.variant.call(label, variant)
    for (const suffix of ['svg', 'png']) {
      const file = path.join(root, 'assets/paper', `${label.data.art}.${suffix}`)
      assert.ok(fs.existsSync(file), file)
      if (suffix === 'png') assert.equal(fs.readFileSync(file).readUInt8(25), 6, 'PNG uses RGBA transparency')
    }
    definition.methods.imageError.call(label)
    assert.equal(label.data.imageFailed, true)
    definition.observers.variant.call(label, variant)
    assert.equal(label.data.imageFailed, false)
  }
  definition.observers.variant.call(label, '../untrusted')
  assert.equal(label.data.art, 'identity')
  const template = fs.readFileSync(path.join(root, 'components/paper-label/index.wxml'), 'utf8')
  assert.match(template, /binderror="imageError"/)
  assert.match(template, /<text class="label-text">\{\{text\}\}<\/text>/)
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
    navigateBack(options = {}) { navigation.push(['navigateBack', options.delta]) },
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
    instance.onLoad(name === 'editor' ? {} : undefined)
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

test('login paper button rejects duplicate taps, recovers from failure and keeps logo fallback local', async () => {
  const h = profileHarness()
  let resolveLogin, rejectLogin, calls = 0
  h.app.login = () => { calls += 1; return new Promise((resolve, reject) => { resolveLogin = resolve; rejectLogin = reject }) }
  const page = h.page('login')
  h.navigation.length = 0
  const pending = page.login()
  assert.equal(page.data.busy, true)
  await page.login()
  assert.equal(calls, 1)
  rejectLogin(new Error('连接失败，请检查网络和后端地址'))
  await pending
  assert.equal(page.data.busy, false)
  assert.match(page.data.error, /连接失败/)
  assert.equal(h.app.globalData.token, 'alice-session')
  assert.deepEqual(h.navigation, [])
  page.logoError()
  assert.equal(page.data.logoFailed, true)
  const retry = page.login()
  resolveLogin()
  await retry
  assert.equal(page.data.busy, false)
  assert.deepEqual(h.navigation, [['switchTab', '/pages/items/index']])
})

test('save ticket preserves validation, duplicate protection and partial photo success', async () => {
  const h = profileHarness()
  const page = h.page('editor')
  page.data.form = { ...page.data.form, name: '相机', category: '收藏', purchase_price: '200' }
  const bad = page.save()
  await page.save()
  assert.equal(h.requests.length, 1)
  h.respond(0, { error: '请检查购买日期' }, 400)
  await bad
  assert.equal(page.data.busy, false)
  assert.equal(page.data.form.name, '相机')
  assert.equal(page.data.error, '请检查购买日期')
  assert.deepEqual(h.navigation, [])
  const uploads = [], notices = []
  global.wx.uploadFile = options => { uploads.push(options) }
  global.wx.showModal = options => { notices.push(options) }
  page.data.photoPath = 'synthetic-photo.png'
  const saved = page.save()
  await page.save()
  assert.equal(h.requests.length, 2)
  assert.equal(h.requests[1].method, 'POST')
  h.respond(1, { id: 12 })
  await tick()
  assert.equal(uploads.length, 1)
  assert.match(uploads[0].url, /\/items\/12\/photo$/)
  uploads[0].fail()
  await tick()
  assert.equal(notices[0].title, '物品已保存')
  assert.match(notices[0].content, /照片上传失败/)
  assert.equal(page.data.busy, true)
  await page.save()
  assert.equal(h.requests.length, 2)
  notices[0].complete()
  await saved
  assert.equal(page.data.busy, false)
  assert.deepEqual(h.navigation, [['navigateBack', undefined]])
  const edited = h.page('editor')
  edited.itemId = 12
  const update = edited.save()
  assert.equal(h.requests[2].method, 'PUT')
  assert.match(h.requests[2].url, /\/items\/12$/)
  h.respond(2, { id: 12 })
  await update
  assert.equal(edited.data.busy, false)
})

test('preset avatars preview all six illustrations and fall back without stale image errors', async () => {
  const { AVATAR_KEYS, avatarState } = require('../miniprogram/utils/profile')
  assert.equal(avatarState(null).avatarPath, '/assets/paper/avatar-sprout.png')
  assert.equal(avatarState({ avatar_key: 'unknown' }).avatarIndex, 0)
  const h = profileHarness(), page = await h.loaded()
  for (const [index, key] of AVATAR_KEYS.entries()) {
    page.avatarChange({ detail: { value: String(index) } })
    const src = `/assets/paper/avatar-${key}.png`
    assert.equal(page.data.avatarPath, src)
    assert.equal(page.data.avatarFailed, false)
    page.avatarError({ currentTarget: { dataset: { src } } })
    assert.equal(page.data.avatarFailed, true)
    assert.ok(page.data.avatarSymbol)
  }
  page.avatarChange({ detail: { value: '1' } })
  page.avatarError({ currentTarget: { dataset: { src: '/assets/paper/avatar-star.png' } } })
  assert.equal(page.data.avatarFailed, false)
})

test('profile saves once, keeps credentials and persists updated user across restart', async () => {
  const h = profileHarness()
  const page = await h.loaded()
  page.nameInput({ detail: { value: '新的手账昵称' } })
  page.avatarChange({ detail: { value: '1' } })
  const expiresAt = h.app.globalData.expiresAt
  assert.equal(page.data.avatarPath, '/assets/paper/avatar-cat.png')
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
  const me = await h.loaded('me')
  assert.equal(me.data.avatarPath, '/assets/paper/avatar-cat.png')
  me.avatarError({ currentTarget: { dataset: { src: me.data.avatarPath } } })
  assert.equal(me.data.avatarFailed, true)
  const reread = me.load()
  h.respond(h.requests.length - 1, { user })
  await reread
  assert.equal(me.data.avatarPath, '/assets/paper/avatar-cat.png')
  assert.equal(me.data.avatarFailed, false)
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
  assert.equal(page.data.avatarPath, '/assets/paper/avatar-star.png')
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
  delete require.cache[require.resolve('../miniprogram/pages/login/index')]
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


test('native tab navigation has six local 81px icons with consistent geometry', () => {
  const fs = require('node:fs'), path = require('node:path')
  const root = path.join(__dirname, '../miniprogram')
  const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json')))
  assert.equal(config.tabBar.custom, undefined)
  assert.deepEqual(config.tabBar.list.map(row => row.text), ['物品', '发现', '我的'])
  for (const row of config.tabBar.list) {
    const sources = []
    for (const key of ['iconPath', 'selectedIconPath']) {
      const png = fs.readFileSync(path.join(root, row[key]))
      assert.equal(png.readUInt32BE(16), 81)
      assert.equal(png.readUInt32BE(20), 81)
      assert.equal(png.readUInt8(25), 6)
      assert.ok(png.length < 40 * 1024)
      sources.push(fs.readFileSync(path.join(root, row[key].replace('.png', '.svg')), 'utf8'))
    }
    assert.notEqual(sources[0], sources[1])
    const geometry = svg => svg.replace(/#[a-f0-9]{6}/gi, '#COLOR')
    assert.equal(geometry(sources[0]), geometry(sources[1]))
  }
})

function photoHarness() {
  const h = profileHarness(), page = h.page('editor')
  global.getCurrentPages = () => [page]
  const sheets = [], selections = [], crops = []
  wx.showActionSheet = options => sheets.push(options)
  wx.chooseMedia = options => selections.push(options)
  wx.cropImage = options => crops.push(options)
  wx.canIUse = () => true
  return { ...h, editor: page, sheets, selections, crops }
}

test('photo picker explicitly selects album or camera, blocks duplicates and does not upload', async () => {
  const h = photoHarness(), page = h.editor
  const pending = page.choosePhoto()
  await page.choosePhoto(); await page.save()
  assert.equal(h.sheets.length, 1)
  assert.deepEqual(h.sheets[0].itemList, ['从相册选择', '拍一张照片'])
  assert.equal(h.requests.length, 0)
  h.sheets[0].success({ tapIndex: 1 })
  await tick()
  assert.deepEqual(h.selections[0].sourceType, ['camera'])
  assert.equal(h.selections[0].camera, 'back')
  assert.equal(h.selections[0].count, 1)
  // A native camera screen can hide the page, without changing the page stack.
  page.onHide()
  h.selections[0].success({ tempFiles: [{ tempFilePath: 'camera.jpg' }] })
  await pending
  page.onShow()
  assert.equal(page.data.previewPath, 'camera.jpg')
  assert.equal(page.data.photoPath, 'camera.jpg')
  const album = page.choosePhoto()
  h.sheets[1].success({ tapIndex: 0 }); await tick()
  assert.deepEqual(h.selections[1].sourceType, ['album'])
  h.selections[1].success({ tempFiles: [{ tempFilePath: 'album.jpg' }] })
  await album
  assert.equal(page.data.photoPath, 'album.jpg')
  assert.equal(page.data.photoBusy, false)
  assert.equal(h.requests.length, 0)
})

test('photo cancellation and permission failure keep the previous image; old callbacks are ignored', async () => {
  const h = photoHarness(), page = h.editor
  page.setData({ photoPath: 'previous.jpg', previewPath: 'previous.jpg' })
  const cancelled = page.choosePhoto()
  h.sheets[0].fail({ errMsg: 'showActionSheet:fail cancel' })
  await cancelled
  assert.equal(page.data.photoError, '')
  const denied = page.choosePhoto()
  h.sheets[1].success({ tapIndex: 1 }); await tick()
  h.selections[0].fail({ errMsg: 'chooseMedia:fail auth deny' })
  await denied
  assert.match(page.data.photoError, /权限/)
  assert.equal(page.data.photoPath, 'previous.jpg')
  const old = page.choosePhoto()
  h.sheets[2].success({ tapIndex: 0 }); await tick()
  global.getCurrentPages = () => [{ route: 'pages/items/index' }]
  page.onHide()
  h.selections[1].success({ tempFiles: [{ tempFilePath: 'late.jpg' }] })
  await old
  assert.equal(page.data.photoPath, 'previous.jpg')
  assert.equal(page.data.photoBusy, false)
  const switched = photoHarness(), other = switched.editor
  const late = other.choosePhoto()
  switched.sheets[0].success({ tapIndex: 1 }); await tick()
  switched.app.globalData.token = 'bob-session'
  other.onShow()
  switched.selections[0].success({ tempFiles: [{ tempFilePath: 'alice-photo.jpg' }] })
  await late
  assert.equal(other.data.photoPath, '')
  assert.equal(other.data.previewPath, '')
  assert.match(other.data.error, /账户已切换/)
})

test('crop uses square selection, keeps images on cancel or failure, and uploads only the final edited file', async () => {
  const h = photoHarness(), page = h.editor, uploads = []
  wx.uploadFile = options => uploads.push(options)
  page.setData({ photoPath: 'original.jpg', previewPath: 'original.jpg' })
  const crop = page.cropPhoto()
  assert.equal(h.crops[0].cropScale, '1:1')
  assert.equal(h.crops[0].src, 'original.jpg')
  h.crops[0].success({ tempFilePath: 'cropped.jpg' })
  await crop
  const cancelled = page.cropPhoto()
  h.crops[1].fail({ errMsg: 'cropImage:fail cancel' })
  await cancelled
  assert.equal(page.data.photoPath, 'cropped.jpg')
  assert.equal(page.data.photoError, '')
  wx.canIUse = () => false
  await page.cropPhoto()
  assert.match(page.data.photoError, /不支持裁剪/)
  assert.equal(page.data.photoPath, 'cropped.jpg')
  const save = page.save()
  h.respond(0, { id: 25 }); await tick()
  assert.equal(uploads[0].filePath, 'cropped.jpg')
  uploads[0].success({ statusCode: 200, data: '{}' })
  await save
  assert.deepEqual(h.navigation, [['navigateBack', undefined]])
})

test('existing photo reads are preview-only, failures can retry and save does not replace a photo', async () => {
  const h = photoHarness(), page = h.editor, downloads = [], uploads = []
  wx.downloadFile = options => downloads.push(options)
  wx.uploadFile = options => uploads.push(options)
  page.itemId = 31
  const loaded = page.load()
  h.respond(0, { id: 31, name: '旧照片', category: '收藏', icon_type: 'other', purchase_date: '2026-01-01',
    purchase_price: '20.00', notes: '', status: 'active', photo_url: '/photo' })
  await loaded
  downloads[0].fail(); await tick()
  assert.match(page.data.photoError, /不会删除原照片/)
  const retry = page.loadPhoto()
  downloads[1].success({ statusCode: 200, tempFilePath: 'existing.jpg' })
  await retry
  assert.equal(page.data.previewPath, 'existing.jpg')
  assert.equal(page.data.photoPath, '')
  const save = page.save()
  h.respond(1, { id: 31 }); await save
  assert.equal(uploads.length, 0)
  assert.equal(h.requests[1].method, 'PUT')
  // Reordered original-photo download cannot overwrite a new selection.
  const reordered = photoHarness(), editor = reordered.editor, pending = []
  wx.downloadFile = options => pending.push(options)
  editor.setData({ hasPhoto: true }); editor.itemId = 32
  const read = editor.loadPhoto()
  const choose = editor.choosePhoto()
  reordered.sheets[0].success({ tapIndex: 0 }); await tick()
  reordered.selections[0].success({ tempFiles: [{ tempFilePath: 'new.jpg' }] }); await choose
  pending[0].success({ statusCode: 200, tempFilePath: 'old.jpg' }); await read
  assert.equal(editor.data.previewPath, 'new.jpg')
})

test('rotation scales without upsampling, swaps axes and applies all EXIF orientations before clockwise turn', async () => {
  const { rotationSize, orientationMatrix, rotatePhoto } = require('../miniprogram/utils/photo-edit')
  assert.deepEqual(rotationSize(4000, 3000), { width: 1200, height: 1600, scale: .4, orientedHeight: 3000 })
  assert.deepEqual(rotationSize(600, 800), { width: 800, height: 600, scale: 1, orientedHeight: 800 })
  assert.deepEqual(rotationSize(4000, 3000, 'right'), { width: 1600, height: 1200, scale: .4, orientedHeight: 4000 })
  for (const direction of ['up', 'up-mirrored', 'down', 'down-mirrored', 'left-mirrored', 'right', 'right-mirrored', 'left']) {
    const [a,b,c,d,e,f] = orientationMatrix(600, 800, direction)
    const size = rotationSize(600, 800, direction)
    const corners = [[0,0], [600,0], [0,800], [600,800]].map(([x,y]) => [size.orientedHeight - (b*x+d*y+f), a*x+c*y+e])
    assert.equal(Math.min(...corners.map(row => row[0])), 0)
    assert.equal(Math.max(...corners.map(row => row[0])), size.width)
    assert.equal(Math.min(...corners.map(row => row[1])), 0)
    assert.equal(Math.max(...corners.map(row => row[1])), size.height)
  }
  const draws = [], outputs = []
  const context = Object.fromEntries(['fillRect', 'scale', 'translate', 'rotate', 'transform', 'drawImage'].map(name => [name, (...args) => draws.push([name, ...args])]))
  const canvas = { getContext: () => context, createImage() { return { set src(value) { this.path = value; this.onload() } } } }
  global.wx = {
    getImageInfo(options) { options.success({ width: 4000, height: 3000, orientation: 'up', path: 'original.jpg' }) },
    createSelectorQuery() { return { in() { return this }, select(id) { assert.equal(id, '#photo-edit-canvas'); return this },
      fields(options, callback) { this.callback = callback; return this }, exec() { this.callback({ node: canvas }) } } },
    canvasToTempFilePath(options) { outputs.push(options); options.success({ tempFilePath: 'rotated.jpg' }) }
  }
  assert.equal(await rotatePhoto({}, 'original.jpg'), 'rotated.jpg')
  assert.equal(canvas.width, 1200); assert.equal(canvas.height, 1600)
  assert.equal(outputs[0].fileType, 'jpg'); assert.equal(outputs[0].quality, .85)
  assert.deepEqual(draws.slice(0,5), [['fillRect', 0,0,1200,1600], ['scale', .4,.4], ['translate',3000,0],
    ['rotate',Math.PI/2], ['transform',1,0,0,1,0,0]])
})


test('rotation failure and unloaded media callbacks keep the previous photo', async () => {
  const h = photoHarness(), page = h.editor
  page.setData({ photoPath: 'before.jpg', previewPath: 'before.jpg' })
  wx.getImageInfo = options => options.fail({ errMsg: 'getImageInfo:fail decode' })
  await page.rotatePhoto()
  assert.equal(page.data.photoPath, 'before.jpg')
  assert.match(page.data.photoError, /处理失败/)
  assert.equal(page.data.photoBusy, false)
  const pending = page.choosePhoto()
  h.sheets[0].success({ tapIndex: 0 }); await tick()
  page.onUnload()
  const snapshot = structuredClone(page.data)
  h.selections[0].success({ tempFiles: [{ tempFilePath: 'late.jpg' }] })
  await pending
  assert.deepEqual(page.data, snapshot)
})

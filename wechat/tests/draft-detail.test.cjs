const test = require('node:test')
const assert = require('node:assert/strict')
const drafts = require('../miniprogram/utils/drafts')
const config = require('../miniprogram/config')
const tick = () => new Promise(resolve => setImmediate(resolve))
function runtime() {
  const storage = new Map(), files = new Map([['temp.jpg', 'original'], ['crop.jpg', 'cropped'], ['rotate.jpg', 'rotated']])
  const requests = [], navigation = [], uploads = [], notices = [], operations = []
  const app = { globalData: { token: 'alice', user: { id: 1 } }, requireSession() { return !!this.globalData.token } }
  global.getApp = () => app
  const fs = {
    copyFile(o) { operations.push(['copy', o.srcPath, o.destPath]); if (!files.has(o.srcPath)) return o.fail({ errMsg: 'missing' }); files.set(o.destPath, files.get(o.srcPath)); o.success() },
    access(o) { files.has(o.path) ? o.success() : o.fail({ errMsg: 'missing' }) },
    unlink(o) { operations.push(['unlink', o.filePath]); files.delete(o.filePath); o.success() }
  }
  global.wx = {
    env: { USER_DATA_PATH: 'wxfile://usr' }, getFileSystemManager: () => fs,
    getStorageSync: key => storage.get(key), setStorageSync: (key, row) => storage.set(key, structuredClone(row)), removeStorageSync: key => storage.delete(key),
    request: o => requests.push(o), uploadFile: o => uploads.push(o),
    showModal: o => notices.push(o), showActionSheet: o => notices.push(o), showToast: o => notices.push(o),
    navigateBack: o => navigation.push(['back', o]), switchTab: o => navigation.push(['tab', o.url]), navigateTo: o => navigation.push(['open', o.url])
  }
  let currentPage
  global.getCurrentPages = () => [currentPage]
  function page(name = 'editor', options = {}) {
    let definition
    global.Page = row => { definition = row }
    const path = `../miniprogram/pages/${name}/index`
    delete require.cache[require.resolve(path)]; require(path)
    const page = { ...definition, data: structuredClone(definition.data), setData(patch, cb) {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.split('.'); let row = this.data
        while (parts.length > 1) row = row[parts.shift()]
        row[parts[0]] = value
      }
      if (cb) cb()
    } }
    currentPage = page; page.onLoad(options); page._visible = true
    return page
  }
  return { app, storage, files, fs, requests, navigation, uploads, notices, operations, page,
    store: () => drafts.createStore(drafts.scope(config.API_BASE, app.globalData.user)),
    respond(index, data, statusCode = 200) { requests[index].success({ statusCode, data }) }
  }
}
const input = (page, key, value) => page.input({ currentTarget: { dataset: { key } }, detail: { value } })
const form = name => ({ name, category: '摄影', icon_type: 'digital', status: 'idle', purchase_date: '2026-01-01', purchase_price: '123.45', warranty_expires_on: '', notes: '换行\n逗号,保留' })
test('drafts separate servers and stable user ids, omit credentials, and survive a fresh store', async () => {
  const h = runtime(), store = h.store()
  await store.save(form('相机'), 'crop.jpg')
  const row = h.store().read()
  assert.deepEqual(row.form, form('相机')); assert.equal(h.files.get(row.photoPath), 'cropped')
  assert.equal(JSON.stringify(row).includes('alice'), false)
  assert.equal(drafts.createStore(drafts.scope(config.API_BASE, { id: 2 })).read(), null)
  assert.equal(drafts.createStore(drafts.scope('https://other.example', { id: 1 })).read(), null)
  assert.equal(drafts.scope(config.API_BASE + '/', { id: 1 }), drafts.scope(config.API_BASE, { id: 1 }))
  assert.equal(drafts.createStore(drafts.scope(config.API_BASE, {})), null)
})
test('draft photo replacement commits new files before cleaning old files and rolls back storage failures', async () => {
  const h = runtime(), store = h.store(), first = await store.save(form('相机'), 'temp.jpg')
  const originalSet = wx.setStorageSync
  wx.setStorageSync = () => { throw new Error('quota') }
  await assert.rejects(store.save(form('改名'), 'crop.jpg'), /quota/)
  assert.equal(store.read().form.name, '相机'); assert.equal(h.files.has(first.photoPath), true)
  assert.equal([...h.files.keys()].filter(p => p.startsWith('wxfile:')).length, 1)
  wx.setStorageSync = originalSet
  const second = await store.save(form('改名'), 'rotate.jpg')
  assert.equal(h.files.has(first.photoPath), false); assert.equal(h.files.get(second.photoPath), 'rotated')
  assert.equal(h.files.get('temp.jpg'), 'original')
  await store.discard(); assert.equal(store.read(), null); assert.equal(h.files.has(second.photoPath), false)
})
test('old-account and completed draft saves cannot commit a slow photo copy', async () => {
  const h = runtime(), store = h.store()
  let copy
  h.fs.copyFile = o => { copy = o }
  const token = h.app.globalData.token
  const pending = store.save(form('慢照片'), 'temp.jpg', () => token === h.app.globalData.token)
  await tick(); h.app.globalData.token = 'bob'
  h.files.set(copy.destPath, 'original'); copy.success()
  assert.equal(await pending, null); assert.equal(store.read(), null); assert.equal(h.files.has(copy.destPath), false)
  h.app.globalData.token = 'alice'
  const next = store.save(form('已创建'), 'temp.jpg'); await tick()
  store.complete(); h.files.set(copy.destPath, 'original'); copy.success()
  assert.equal(await next, null); await store.cleanup(); assert.equal(store.read(), null)
})
test('completed tombstones cannot restore and missing photos restore all text fields', async () => {
  const h = runtime(), store = h.store(), row = await store.save(form('相机'), 'crop.jpg')
  h.files.delete(row.photoPath)
  const restored = await store.restore(store.read())
  assert.deepEqual(restored.form, form('相机')); assert.equal(restored.photoPath, ''); assert.equal(restored.missingPhoto, true)
  store.complete(); assert.equal(h.store().read(), null); await store.cleanup()
  assert.equal(h.storage.size, 0)
})
test('finishing an old upload preserves a newer draft and its photo', async () => {
  const h = runtime(), old = h.store(), first = await old.save(form('已创建相机'), 'temp.jpg')
  old.complete()
  const next = h.store(), second = await next.save(form('下一件物品'), 'rotate.jpg')
  assert.notEqual(first.draftId, second.draftId)
  assert.equal(h.files.has(first.photoPath), true)
  await old.cleanup()
  assert.equal(h.files.has(first.photoPath), false)
  assert.equal(next.read().form.name, '下一件物品')
  assert.equal(h.files.get(second.photoPath), 'rotated')
})
test('blank forms do not create drafts; typing debounces and page exit flushes final fields', async () => {
  const h = runtime(), page = h.page()
  await page.flushDraft(); assert.equal(h.storage.size, 0)
  input(page, 'name', '相机'); assert.equal(h.storage.size, 0)
  await new Promise(resolve => setTimeout(resolve, 520))
  assert.equal(h.store().read().form.name, '相机')
  input(page, 'notes', '最后一行'); page.onHide(); page.onUnload(); await tick()
  assert.equal(h.store().read().form.notes, '最后一行')
  assert.equal(h.requests.length, 0)
})
test('draft prompt can close without deleting, continue with fields and photo, or discard after confirmation', async () => {
  const h = runtime(), row = await h.store().save(form('恢复相机'), 'rotate.jpg')
  const page = h.page(); assert.equal(page.data.draftPrompt, true); assert.equal(page.data.draftReady, false)
  await page.save(); assert.equal(h.requests.length, 0)
  page.closeDraft(); assert.equal(h.navigation[0][0], 'back'); assert.ok(h.store().read())
  await page.continueDraft(); assert.deepEqual(page.data.form, form('恢复相机'))
  assert.equal(page.data.typeIndex, 0); assert.equal(page.data.statusIndex, 1); assert.equal(page.data.photoPath, row.photoPath)
  const discard = page.discardDraft(); h.notices.at(-1).success({ confirm: false }); await discard
  assert.equal(page.data.form.name, '恢复相机')
  const restart = page.restartDraft(); h.notices.at(-1).success({ confirm: true }); await restart
  assert.equal(page.data.form.name, ''); assert.equal(h.store().read(), null); assert.equal(h.files.has(row.photoPath), false)
})
test('missing photos and failed local writes keep usable fields and allow formal submission', async () => {
  const h = runtime(), row = await h.store().save(form('相机'), 'temp.jpg')
  h.files.delete(row.photoPath)
  const page = h.page(); await page.continueDraft(); await page.flushDraft()
  assert.match(page.data.photoError, /丢失/); assert.equal(page.data.form.name, '相机')
  wx.setStorageSync = () => { throw new Error('quota') }
  input(page, 'name', '仍可提交'); await page.flushDraft()
  assert.match(page.data.draftStatus, /草稿未保存/); assert.equal(page.data.form.name, '仍可提交')
  const pending = page.save(); assert.equal(h.requests[0].method, 'POST')
  h.respond(0, { id: 6 }); await pending; assert.equal(h.navigation.length, 1)
})
test('create completes draft before upload, uploads final edited file, and cannot duplicate after partial success', async () => {
  const h = runtime(), page = h.page()
  input(page, 'name', '相机'); page.setData({ photoPath: 'rotate.jpg', previewPath: 'rotate.jpg' }); await page.flushDraft()
  const finalPath = page.data.photoPath
  const pending = page.save(); await page.save(); assert.equal(h.requests.length, 1)
  h.respond(0, { id: 7 }); await tick()
  assert.equal(h.storage.get(h.store().key).completed, true)
  assert.equal(h.uploads[0].filePath, finalPath); assert.equal(h.files.has(finalPath), true)
  const restarted = h.page(); assert.equal(restarted.data.draftPrompt, false)
  await tick(); assert.equal(h.files.has(finalPath), true)
  // Simulate the interrupted upload failing before any automatic cleanup.
  h.uploads[0].fail(); await tick(); h.notices.at(-1).complete(); await pending
  assert.equal(h.files.has(finalPath), false); assert.equal(h.store().read(), null)
  const again = page.save(); assert.equal(h.requests[1].method, 'PUT')
  h.respond(1, { id: 7 }); await tick(); h.uploads[1].fail(); await tick(); h.notices.at(-1).complete(); await again
})
test('successful photo edits persist the latest result immediately and unload does not duplicate copies', async () => {
  const h = runtime(), page = h.page()
  await page.photoOperation(async () => 'crop.jpg')
  const first = page.data.photoPath
  assert.equal(h.files.get(first), 'cropped'); assert.equal(h.store().read().photoPath, first)
  await page.photoOperation(async () => 'rotate.jpg')
  assert.equal(h.files.has(first), false); assert.equal(h.files.get(page.data.photoPath), 'rotated')
  input(page, 'notes', '带照片返回'); page.onHide(); page.onUnload(); await tick()
  assert.equal(h.operations.filter(row => row[0] === 'copy').length, 2)
  const restored = h.page(); await restored.continueDraft()
  assert.equal(h.files.get(restored.data.previewPath), 'rotated'); assert.equal(restored.data.form.notes, '带照片返回')
})
test('editing existing items never reads or overwrites a new-item draft', async () => {
  const h = runtime(); await h.store().save(form('留给新增'), '')
  const page = h.page('editor', { id: 9 }); assert.equal(page.data.draftPrompt, false)
  h.respond(0, form('原物品')); await tick()
  input(page, 'name', '编辑物品'); await page.flushDraft(); page.onUnload(); await tick()
  assert.equal(h.store().read().form.name, '留给新增')
})
const item = () => ({ id: 1, name: '名称很长的相机', status: 'active', photo_url: null, icon_type: 'digital', category: '摄影', purchase_price: '0.00', net_cost: '-20.00', daily_net_cost: null,
  daily_purchase_cost: null, usage_records: Array.from({ length: 5 }, (_, i) => ({ id: i + 1, used_on: `2026-01-0${i + 1}`, notes: `使用 ${i + 1}` })),
  maintenance_records: Array.from({ length: 5 }, (_, i) => ({ id: i + 1, maintained_on: `2026-02-0${i + 1}`, cost: '1.00', description: `维修 ${i + 1}` })), disposal: null,
  milestones: { earned: [{ id: 'a', label: '百日', date: '2026-01-01' }, { id: 'b', label: '周年', date: '2026-02-01' }], next: null }, daily_target: null })
test('detail initially shows one stamp, three records and collapsed facts; folds remain independent', async () => {
  const h = runtime(), page = h.page('item', { id: 1 }), pending = page.load()
  h.respond(0, item()); await pending
  assert.equal(page.data.stamps.length, 1); assert.equal(page.data.timeline.length, 3); assert.equal(page.data.allTimeline.length, 5)
  assert.equal(page.data.factsExpanded, false); assert.equal(page.data.item.dailyPurchase, '暂无'); assert.equal(page.data.item.net_cost, '-20.00')
  assert.equal(page.data.historyExpanded, false); assert.equal(page.data.historyUsage.length, 5)
  assert.ok(page.data.allTimeline.every(row => row.kind === 'maintenance'))
  page.toggleHistory(); assert.equal(page.data.historyExpanded, true)
  page.toggleFacts(); page.toggleStamps(); page.toggleTimeline()
  assert.equal(page.data.timeline.length, 5); assert.equal(page.data.stamps.length, 2)
  page.editRecord({ currentTarget: { dataset: { id: 1, kind: 'usage' } } })
  page.record({ currentTarget: { dataset: { kind: 'usage' } } })
  assert.equal(h.navigation.length, 0)
  page.editRecord({ currentTarget: { dataset: { id: 1, kind: 'maintenance' } } })
  assert.equal(h.navigation[0][1], '/pages/record/index?itemId=1&kind=maintenance&id=1')
  page.toggleTimeline(); assert.equal(page.data.timeline.length, 3); assert.equal(page.data.factsExpanded, true)
})
test('return restores folds and clamps scroll; stale measurements and new accounts cannot restore old positions', async () => {
  const h = runtime(), page = h.page('item', { id: 1 }), callbacks = [], scrolls = []
  wx.createSelectorQuery = () => ({ in() { return this }, select() { return this }, boundingClientRect(cb) { callbacks.push(cb); return this }, exec() {} })
  wx.getWindowInfo = () => ({ windowHeight: 500 }); wx.pageScrollTo = o => scrolls.push(o)
  page.setData({ factsExpanded: true, expanded: true, timelineExpanded: true, historyExpanded: true }); page.onPageScroll({ scrollTop: 800 }); page.onHide(); page.onShow()
  h.respond(0, item()); await tick(); callbacks[0]({ height: 900 })
  assert.equal(scrolls[0].scrollTop, 400); assert.equal(page.data.timeline.length, 5); assert.equal(page.data.stamps.length, 2)
  assert.equal(page.data.historyExpanded, true)
  page.onHide(); page.onShow(); h.respond(1, item()); await tick()
  h.app.globalData.token = 'bob'; h.app.globalData.user = { id: 2 }; callbacks[1]({ height: 1800 })
  assert.equal(scrolls.length, 1)
  page.onShow(); assert.equal(page.data.item, null); assert.equal(page.data.factsExpanded, false); assert.equal(page.data.timelineExpanded, false)
  assert.equal(page.data.historyExpanded, false); assert.equal(page.data.historyUsage.length, 0)
  h.respond(2, item()); await tick(); assert.equal(page.data.timeline.length, 3)
  wx.getWindowInfo = () => { throw new Error('window info unavailable') }
  page._returnScroll = 120; page.restoreScroll(page._sequence, 'bob'); callbacks.at(-1)({ height: 900 })
  assert.equal(scrolls.at(-1).scrollTop, 120)
  delete wx.createSelectorQuery
  page._returnScroll = 80; page.restoreScroll(page._sequence, 'bob')
  assert.equal(scrolls.at(-1).scrollTop, 80)
  const reopened = h.page('item', { id: 1 }); assert.equal(reopened.data.expanded, false)
})
test('more menu includes unread photos; disposed restrictions and old confirmation callbacks remain safe', async () => {
  const h = runtime(), page = h.page('item', { id: 1 }); page.setData({ item: { ...item(), photo_url: '/photo', status: 'disposed' } })
  assert.equal(page.quickUse, undefined); await page.writeTarget('5'); assert.equal(h.requests.length, 0)
  const more = page.more(); assert.deepEqual(h.notices[0].itemList, ['置顶', '移除照片', '移入回收站'])
  h.notices[0].success({ tapIndex: 1 }); await tick()
  h.app.globalData.token = 'bob'; h.notices[1].success({ confirm: true }); await more
  assert.equal(h.requests.length, 0)
})
test('list navigation continues if position reads stall or omit dataset, without accepting late callbacks', async () => {
  const h = runtime(), page = h.page('items'), callbacks = []
  page._token = 'alice'; page.data.shown = [{ id: 7 }]
  wx.createSelectorQuery = () => ({ in() { return this }, selectAll() { return this }, boundingClientRect(cb) { callbacks.push(cb); return this }, exec() {} })
  page.add(); await new Promise(resolve => setTimeout(resolve, 170))
  assert.equal(h.navigation[0][1], '/pages/editor/index')
  callbacks[0]([{ id: 'item-7', top: 20, bottom: 90 }]); assert.equal(h.navigation.length, 1)
  page._navigation = null
  page.open({ currentTarget: { dataset: { id: 7 } } })
  callbacks[1]([{ id: 'item-7', top: 20, bottom: 90 }])
  assert.equal(h.navigation[1][1], '/pages/item/index?id=7'); assert.equal(page._anchor.id, '7')
  page._navigation = null; page.add(); h.app.globalData.token = 'bob'
  await new Promise(resolve => setTimeout(resolve, 170)); assert.equal(h.navigation.length, 2)
})

test('legacy usage entry is read-only and cannot submit, reload or delete', async () => {
  const h = runtime(), page = h.page('record', { itemId: 1, kind: 'usage', id: 7 })
  assert.equal(page.data.retired, true)
  assert.match(h.notices[0].content, /不再新增或修改/)
  await page.load(); await page.save(); await page.remove()
  assert.equal(h.requests.length, 0)
  h.notices[0].success({ confirm: true }); assert.equal(h.navigation[0][0], 'back')
  h.navigation[0][1].fail(); assert.equal(h.navigation[1][1], '/pages/items/index')
})

test('only historic usage records produce an empty maintenance timeline and a folded archive', async () => {
  const h = runtime(), page = h.page('item', { id: 1 }), pending = page.load()
  h.respond(0, { ...item(), maintenance_records: [] }); await pending
  assert.equal(page.data.timeline.length, 0); assert.equal(page.data.allTimeline.length, 0)
  assert.equal(page.data.historyUsage.length, 5); assert.equal(page.data.historyExpanded, false)
  assert.equal(page.data.historyUsage[0].used_on, '2026-01-05')
})

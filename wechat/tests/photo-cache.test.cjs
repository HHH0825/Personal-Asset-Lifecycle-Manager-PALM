const test = require('node:test')
const assert = require('node:assert/strict')
const { createPhotoCache } = require('../miniprogram/utils/photo-cache')
const tick = () => new Promise(resolve => setImmediate(resolve))
const item = (id, version = 'v1') => ({ id, photo_url: '/photo', photo_version: version })
function harness(options = {}) {
  let scope = 'server-a/alice'
  const calls = [], removed = [], files = new Map(), gates = []
  const cache = createPhotoCache({ getScope: () => scope, stat: async path => {
    if (!files.has(path)) throw new Error('missing')
    return { size: files.get(path) }
  }, remove: async path => { removed.push(path); files.delete(path) }, download(spec) {
    calls.push(spec)
    let resolve, reject
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    const defaultPath = 'download-' + gates.length
    const gate = { resolve(path = defaultPath, bytes = 100) { files.set(path, bytes); resolve(path) }, reject,
      abort() { gate.aborted = true; if (!options.ignoreAbort) reject(new Error('aborted')) } }
    gates.push(gate)
    return { promise, abort: gate.abort }
  }, ...options })
  return { cache, calls, gates, files, removed, switch(value) { scope = value } }
}

test('shared downloads deduplicate by version/size and prioritize visible requests within three slots', async () => {
  const h = harness(), owner = {}, secondOwner = {}
  const reads = [h.cache.load(item(1), owner), h.cache.load(item(2), owner), h.cache.load(item(3), owner)]
  await tick()
  const prefetch = h.cache.load(item(4), owner, 'thumb', 1)
  const visible = h.cache.load(item(5), owner)
  const shared = h.cache.load(item(1), secondOwner)
  await tick(); assert.equal(h.calls.length, 3)
  h.gates[0].resolve('one'); assert.equal(await reads[0], 'one'); assert.equal(await shared, 'one')
  await tick(); assert.equal(h.calls[3].id, 5)
  h.gates[1].resolve(); h.gates[2].resolve(); h.gates[3].resolve(); await tick()
  assert.equal(h.calls[4].id, 4); h.gates[4].resolve()
  await Promise.all([...reads, prefetch, visible])
  assert.equal(await h.cache.load(item(1), owner), 'one')
  assert.equal(h.calls.length, 5, 'returning to a page does not re-download')
  const full = h.cache.load(item(1), owner, 'full'); await tick(); h.gates[5].resolve('full')
  assert.equal(await full, 'full'); assert.equal(h.calls[5].size, 'full')
})

test('page release cancels its queue but preserves another reader and valid cached photos', async () => {
  const h = harness({ maxConcurrent: 1 }), a = {}, b = {}
  const sharedA = h.cache.load(item(1), a).catch(e => e.cancelled)
  const sharedB = h.cache.load(item(1), b)
  const queued = h.cache.load(item(2), a).catch(e => e.cancelled)
  await tick(); h.cache.release(a)
  assert.equal(await sharedA, true); assert.equal(await queued, true)
  assert.equal(h.gates[0].aborted, undefined)
  h.gates[0].resolve('shared'); assert.equal(await sharedB, 'shared')
  assert.equal(await h.cache.load(item(1), a), 'shared'); assert.equal(h.calls.length, 1)
})

test('versions, removal, account and backend changes discard stale files and late callbacks', async () => {
  const h = harness({ ignoreAbort: true }), owner = {}
  h.cache.sync([item(1)])
  const old = h.cache.load(item(1), owner).catch(e => e.cancelled)
  await tick(); h.cache.sync([item(1, 'v2')]); assert.equal(await old, true)
  h.gates[0].resolve('stale'); await tick(); assert.ok(h.removed.includes('stale'))
  const fresh = h.cache.load(item(1, 'v2'), owner); await tick(); h.gates[1].resolve('new'); await fresh
  h.cache.sync([], true); await tick(); assert.ok(h.removed.includes('new'))
  const late = h.cache.load(item(2), owner).catch(e => e.cancelled); await tick()
  h.switch('server-b/bob'); h.cache.reset(); assert.equal(await late, true)
  h.gates[2].resolve('alice'); await tick(); assert.ok(h.removed.includes('alice'))
  assert.equal(await h.cache.peek(item(2)), '')
})

test('LRU budgets count both variants and only remove cache-owned files; missing files re-download', async () => {
  const h = harness({ maxEntries: 2, maxBytes: 250 }), owner = {}
  h.files.set('draft-photo', 999)
  for (let id = 1; id <= 2; id++) { const read = h.cache.load(item(id), owner); await tick(); h.gates[id - 1].resolve(); await read }
  await h.cache.peek(item(1))
  const third = h.cache.load(item(3), owner); await tick(); h.gates[2].resolve('third'); await third; await tick()
  assert.ok(h.removed.includes('download-1')); assert.equal(h.cache.snapshot().entries, 2)
  h.files.delete('third')
  const missing = h.cache.load(item(3), owner); await tick(); h.gates[3].resolve('recovered'); assert.equal(await missing, 'recovered')
  const large = h.cache.load(item(4), owner); await tick(); h.gates[4].resolve('large', 200); await large; await tick()
  assert.ok(h.cache.snapshot().bytes <= 250)
  h.cache.reset(); await tick(); assert.equal(h.files.get('draft-photo'), 999)
  assert.ok(!h.removed.includes('draft-photo'))
})

test('errors require explicit retry and cancelled downloads cannot leave detached files', async () => {
  const h = harness({ ignoreAbort: true }), owner = {}
  const failed = h.cache.load(item(1), owner); await tick(); h.gates[0].reject(new Error('offline'))
  await assert.rejects(failed, /offline/); await tick(); assert.equal(h.calls.length, 1)
  const retry = h.cache.load(item(1), owner); await tick(); h.gates[1].resolve('ok'); await retry
  const late = h.cache.load(item(2), owner).catch(e => e.cancelled); await tick()
  h.cache.release(owner); assert.equal(await late, true)
  h.gates[2].resolve('late'); await tick(); assert.ok(h.removed.includes('late'))
})

test('requesting an obsolete version settles as cancelled rather than hanging in the queue', async () => {
  const h = harness()
  h.cache.sync([item(1, 'v2')])
  await assert.rejects(h.cache.load(item(1, 'v1'), {}), error => error.cancelled === true)
  assert.equal(h.calls.length, 0)
  assert.equal(h.cache.snapshot().queued, 0)
})

// Downloaded files belong to this session; draft/camera files never enter this cache.
function cancelled() { const error = new Error('照片读取已取消'); error.cancelled = true; return error }

function createPhotoCache({ download, stat, remove, getScope, maxConcurrent = 3, maxEntries = 60, maxBytes = 20 * 1024 * 1024 }) {
  let scope = getScope(), epoch = 0, active = 0, clock = 0
  const cache = new Map(), pending = new Map(), versions = new Map()
  const queue = [], owned = new Set()
  const clean = path => { if (owned.delete(path)) Promise.resolve().then(() => remove(path)).catch(() => {}) }
  const keyOf = spec => JSON.stringify([scope, spec.id, spec.version, spec.size])
  function settle(job, error, path) {
    for (const waiters of job.owners.values()) for (const waiter of waiters) {
      if (error) waiter.reject(error); else waiter.resolve(path)
    }
    job.owners.clear()
  }
  function stop(job) {
    job.stopped = true
    if (pending.get(job.key) === job) pending.delete(job.key)
    settle(job, cancelled())
    if (job.abort) job.abort()
  }
  function reset() {
    epoch++; scope = getScope(); versions.clear()
    for (const job of pending.values()) stop(job)
    pending.clear(); queue.length = 0
    for (const entry of cache.values()) clean(entry.path)
    cache.clear()
  }
  function ensureScope() { if (scope !== getScope()) reset() }
  function invalidate(id) {
    for (const [key, entry] of cache) if (entry.id === Number(id)) { cache.delete(key); clean(entry.path) }
    for (const job of pending.values()) if (job.spec.id === Number(id)) stop(job)
    pump()
  }
  function sync(items, complete = false) {
    ensureScope()
    const present = new Set()
    for (const item of items) {
      const id = Number(item.id), version = item.photo_url ? (item.photo_version || 'legacy') : null
      present.add(id)
      if (versions.has(id) && versions.get(id) !== version) invalidate(id)
      versions.set(id, version)
    }
    if (complete) for (const id of versions.keys()) if (!present.has(id)) { invalidate(id); versions.delete(id) }
  }
  function trim() {
    let bytes = [...cache.values()].reduce((sum, row) => sum + row.bytes, 0)
    for (const [key, entry] of [...cache].sort((a, b) => a[1].used - b[1].used)) {
      if (cache.size <= maxEntries && bytes <= maxBytes) break
      cache.delete(key); bytes -= entry.bytes; clean(entry.path)
    }
  }
  const current = job => !job.stopped && job.epoch === epoch && job.scope === getScope()
    && (!versions.has(job.spec.id) || versions.get(job.spec.id) === job.spec.version)
  async function work(job) {
    let entry = cache.get(job.key)
    if (entry) {
      try { await stat(entry.path) } catch (_) { cache.delete(job.key); clean(entry.path); entry = null }
      if (entry && cache.get(job.key) === entry && current(job)) { entry.used = ++clock; return entry.path }
    }
    if (!current(job)) throw cancelled()
    const task = download(job.spec)
    job.abort = task.abort
    const path = await task.promise
    owned.add(path)
    if (!current(job)) { clean(path); throw cancelled() }
    let info
    try { info = await stat(path) } catch (error) { clean(path); throw error }
    if (!current(job)) { clean(path); throw cancelled() }
    const bytes = Number(info.size)
    if (!Number.isFinite(bytes) || bytes < 0) { clean(path); throw new Error('照片文件无法读取') }
    // A single file larger than the budget cannot be retained or rendered safely.
    if (bytes > maxBytes) { clean(path); throw new Error('照片缓存空间不足') }
    cache.set(job.key, { id: job.spec.id, path, bytes, used: ++clock })
    trim()
    return path
  }
  function pump() {
    queue.sort((a, b) => a.priority - b.priority || a.order - b.order)
    while (active < maxConcurrent && queue.length) {
      const job = queue.shift()
      if (!current(job) || !job.owners.size) { stop(job); continue }
      active++
      const finish = (error, path) => {
        if (pending.get(job.key) === job) pending.delete(job.key)
        settle(job, error, path)
      }
      work(job).then(path => { if (current(job)) finish(null, path); else finish(cancelled()) }, error => finish(error))
        .finally(() => { active--; if (pending.get(job.key) === job) pending.delete(job.key); pump() })
    }
  }
  function load(item, owner, size = 'thumb', priority = 0) {
    ensureScope()
    const spec = { id: Number(item.id), version: item.photo_version || 'legacy', size }
    if (!scope || !spec.id) return Promise.reject(cancelled())
    const key = keyOf(spec)
    let job = pending.get(key)
    if (!job) {
      job = { spec, key, scope, epoch, priority, order: ++clock, owners: new Map() }
      pending.set(key, job); queue.push(job)
    } else job.priority = Math.min(job.priority, priority)
    const promise = new Promise((resolve, reject) => {
      if (!job.owners.has(owner)) job.owners.set(owner, [])
      job.owners.get(owner).push({ resolve, reject })
    })
    // Collect viewport notifications in the same tick before ordering downloads.
    Promise.resolve().then(pump)
    return promise
  }
  function release(owner) {
    for (const job of pending.values()) {
      for (const waiter of job.owners.get(owner) || []) waiter.reject(cancelled())
      job.owners.delete(owner)
      if (!job.owners.size) stop(job)
    }
    pump()
  }
  async function peek(item, size = 'thumb') {
    ensureScope()
    const snapshot = epoch, key = keyOf({ id: Number(item.id), version: item.photo_version || 'legacy', size })
    const entry = cache.get(key)
    if (!entry) return ''
    try { await stat(entry.path) } catch (_) { cache.delete(key); clean(entry.path); return '' }
    if (snapshot !== epoch || scope !== getScope() || cache.get(key) !== entry) return ''
    entry.used = ++clock; return entry.path
  }
  function promote(id, owner) {
    for (const job of pending.values()) if (job.spec.id === Number(id) && job.owners.has(owner)) job.priority = 0
    pump()
  }
  return { load, peek, sync, invalidate, release, reset, promote,
    snapshot: () => ({ entries: cache.size, bytes: [...cache.values()].reduce((sum, row) => sum + row.bytes, 0), active, queued: queue.filter(job => !job.stopped).length }) }
}

module.exports = { createPhotoCache }

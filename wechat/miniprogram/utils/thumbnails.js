// Page-local, session-only photo cache. No filenames are saved to persistent storage.
function createThumbnailLoader({ download, getSession, maxConcurrent = 3 }) {
  let session = getSession()
  let revision = 0
  let active = 0
  let disposed = false
  const cache = new Map()
  const pending = new Map()
  const queue = []

  function reset() {
    revision += 1
    session = getSession()
    cache.clear()
    pending.clear()
    queue.splice(0).forEach(job => job.resolve(''))
  }

  function pump() {
    while (!disposed && active < maxConcurrent && queue.length) {
      const job = queue.shift()
      if (job.revision !== revision || job.session !== getSession()) { job.resolve(''); continue }
      active += 1
      Promise.resolve().then(() => download(job.id)).then(path => {
        if (!disposed && job.revision === revision && job.session === getSession()) {
          cache.set(job.id, path)
          job.resolve(path)
        } else job.resolve('')
      }, () => job.resolve('')).finally(() => {
        active -= 1
        if (job.revision === revision) pending.delete(job.id)
        pump()
      })
    }
  }

  function load(id) {
    if (disposed) return Promise.resolve('')
    if (session !== getSession()) reset()
    if (!session) return Promise.resolve('')
    if (cache.has(id)) return Promise.resolve(cache.get(id))
    if (pending.has(id)) return pending.get(id)
    const promise = new Promise(resolve => queue.push({ id, resolve, revision, session }))
    pending.set(id, promise)
    pump()
    return promise
  }

  return { load, reset, dispose() { disposed = true; reset() } }
}

module.exports = { createThumbnailLoader }

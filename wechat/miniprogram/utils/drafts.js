// New-item drafts are local to one account and server. No tokens are stored here.
const FIELDS = ['name', 'category', 'icon_type', 'status', 'purchase_date', 'purchase_price', 'warranty_expires_on', 'notes']
const uploading = new Set()
function fields(form) { return Object.fromEntries(FIELDS.map(key => [key, typeof form[key] === 'string' ? form[key] : ''])) }
function scope(base, user) {
  if (!user || user.id === undefined || user.id === null) return null
  return `${String(base).replace(/\/+$/, '')}|${user.id}`
}
function fingerprint(value) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(16)
}
function createStore(identity) {
  if (!identity) return null
  const key = `wwj:new-draft:v1:${encodeURIComponent(identity)}`
  const root = wx.env && wx.env.USER_DATA_PATH
  const prefix = root && `${root}/wwj-draft-${fingerprint(identity)}-`
  let queue = Promise.resolve(), completed = false, counter = 0, lastRow = null, completedRow = null
  const same = (a, b) => Boolean(a && b && (a.draftId && b.draftId
    ? a.draftId === b.draftId : a.savedAt === b.savedAt && a.photoPath === b.photoPath))
  const owned = path => Boolean(prefix && typeof path === 'string' && path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
  const call = (method, options) => new Promise((resolve, reject) => {
    try { wx.getFileSystemManager()[method]({ ...options, success: resolve, fail: reject }) } catch (error) { reject(error) }
  })
  const unlink = async path => { if (owned(path)) await call('unlink', { filePath: path }).catch(() => {}) }
  const serial = action => { const task = queue.then(action); queue = task.catch(() => {}); return task }
  function read() {
    const row = wx.getStorageSync(key)
    if (!row || row.version !== 1 || !row.form) return null
    if (row.completed) {
      // A completed tombstone must never be offered as a new-item draft.
      if (!uploading.has(row.photoPath)) serial(async () => {
        const current = wx.getStorageSync(key)
        if (current && current.completed && same(current, row)) wx.removeStorageSync(key)
        if (!current || same(current, row) || current.photoPath !== row.photoPath) await unlink(row.photoPath)
      }).catch(() => {})
      return null
    }
    lastRow = row
    return { ...row, form: fields(row.form), photoPath: owned(row.photoPath) ? row.photoPath : '' }
  }
  return {
    key, read,
    async restore(row) {
      if (!row.photoPath) return { ...row, missingPhoto: false }
      try { await call('access', { path: row.photoPath }); return { ...row, missingPhoto: false } }
      catch (_) { return { ...row, photoPath: '', missingPhoto: true } }
    },
    save(form, source = '', active = () => true) {
      const snapshot = fields(form)
      return serial(async () => {
        if (completed || !active()) return null
        const previous = wx.getStorageSync(key)
        let path = source, copied = ''
        try {
          if (source && !owned(source)) {
            if (!prefix) throw new Error('本机照片目录不可用')
            const extension = /\.(png|jpe?g|webp)$/i.exec(source)
            copied = `${prefix}${Date.now()}-${++counter}-${Math.random().toString(36).slice(2, 8)}.${extension ? extension[1] : 'jpg'}`
            await call('copyFile', { srcPath: source, destPath: copied })
            path = copied
          }
          if (completed || !active()) { await unlink(copied); return null }
          const row = { version: 1, draftId: previous && !previous.completed && previous.draftId || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            form: snapshot, photoPath: path, savedAt: Date.now(), completed: false }
          wx.setStorageSync(key, row)
          lastRow = row
          if (previous && previous.photoPath !== path && !uploading.has(previous.photoPath)) await unlink(previous.photoPath)
          return row
        } catch (error) { await unlink(copied); throw error }
      })
    },
    complete() {
      // Synchronous tombstone takes priority over queued autosaves and photo upload.
      completed = true
      const previous = wx.getStorageSync(key)
      completedRow = lastRow || previous
      if (completedRow && completedRow.photoPath) uploading.add(completedRow.photoPath)
      if (!same(previous, completedRow)) return
      try { wx.setStorageSync(key, { ...previous, completed: true }) }
      catch (_) { wx.removeStorageSync(key) }
    },
    cleanup() {
      completed = true
      return serial(async () => {
        try {
          const row = wx.getStorageSync(key)
          if (row && row.completed && same(row, completedRow)) wx.removeStorageSync(key)
          if (completedRow && (!row || same(row, completedRow) || row.photoPath !== completedRow.photoPath)) await unlink(completedRow.photoPath)
        } finally { if (completedRow) uploading.delete(completedRow.photoPath) }
      })
    },
    discard(active = () => true) {
      return serial(async () => {
        if (!active()) return false
        const row = wx.getStorageSync(key)
        wx.removeStorageSync(key)
        if (row) await unlink(row.photoPath)
        return true
      })
    }
  }
}
module.exports = { fields, scope, createStore }

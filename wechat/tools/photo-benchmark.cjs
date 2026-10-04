// HTTP payload sizes are real; queue/cache replay below uses an in-memory transport.
// This measures requests and bytes, not native image decoding or phone display time.
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { createPhotoCache } = require('../miniprogram/utils/photo-cache')
const python = process.argv[2] || 'python'
const result = spawnSync(python, [path.join(__dirname, 'photo-fixtures.py')], { encoding: 'utf8' })
if (result.status !== 0) { process.stderr.write(result.stderr || 'Fixture generation failed'); process.exit(1) }
const fixtures = JSON.parse(result.stdout)
async function replay(reuse, size) {
  const files = new Map(), passes = []
  let requests = 0, bytes = 0
  const cache = createPhotoCache({ getScope: () => 'isolated-fixture',
    stat: async file => ({ size: files.get(file) }), remove: async file => files.delete(file),
    download(spec) {
      const row = fixtures.find(item => item.id === spec.id), file = 'download-' + ++requests
      bytes += row[spec.size]; files.set(file, row[spec.size])
      return { promise: Promise.resolve(file), abort() {} }
    } })
  for (let pass = 0; pass < 2; pass++) {
    if (!reuse) cache.reset()
    const owner = {}, before = { requests, bytes }
    await Promise.all(fixtures.map(item => cache.load(item, owner, size)))
    cache.release(owner)
    passes.push({ page: pass ? 'return' : 'first', requests: requests - before.requests, bytes: bytes - before.bytes })
  }
  cache.reset()
  return { passes, totalRequests: requests, totalBytes: bytes }
}
(async () => {
  const before = await replay(false, 'full'), after = await replay(true, 'thumb')
  console.log(JSON.stringify({ method: '6 generated noise photos; authenticated Flask payloads plus cache replay; not device timing',
    before, after, byteReductionPercent: Number(((1 - after.totalBytes / before.totalBytes) * 100).toFixed(2)),
    fixtureHttpMs: fixtures.map(row => ({ full: row.full_http_ms, thumb: row.thumb_http_ms })) }, null, 2))
})().catch(error => { console.error(error); process.exitCode = 1 })

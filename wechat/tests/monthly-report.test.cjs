const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const { readMonthly, presentMonthly, wrapLines } = require('../miniprogram/utils/monthly')
const { planReport } = require('../miniprogram/utils/report-image')
const fixture = () => ({ month: '2026-09', today: '2026-10-03', cutoff_date: '2026-09-30', is_current: false,
  has_activity: true, totals: { purchase_count: 2, purchase_total: '200.00', maintenance_total: '50.00', disposal_total: '400.00', cashflow_net: '-150.00' },
  purchases: [{ id: 1, name: '相机', purchase_date: '2026-09-01', purchase_price: '100.00', icon_type: 'digital' },
    { id: 2, name: '书', purchase_date: '2026-09-02', purchase_price: '100.00', icon_type: 'books' }],
  purchase_leaders: [{ id: 1, name: '相机', purchase_price: '100.00', share: '50.00' }, { id: 2, name: '书', purchase_price: '100.00', share: '50.00' }], memories: [] })
const context = () => ({ font: '', measureText(value) { return { width: Array.from(value).length * (parseInt(this.font) || 20) * .7 } } })

test('monthly accepts retired usage field absence and signed cashflow while rejecting malformed additions', () => {
  const report = fixture()
  assert.equal(readMonthly(report), report)
  report.totals.cashflow_net = 'NaN'
  assert.throws(() => readMonthly(report), /格式异常/)
  report.totals.cashflow_net = '-150.00'; report.purchase_leaders[0].share = '101.00'
  assert.throws(() => readMonthly(report), /格式异常/)
})

test('all expense lines share one scale; zero money never draws a false line or percentage', () => {
  const report = fixture(), view = presentMonthly(report)
  assert.deepEqual(view.bars.map(i => i.width), [50, 12.5, 100])
  assert.match(view.finding, /相机、书.*并列/)
  assert.match(view.findingBasis, /每件.*50.00%/)
  assert.match(view.cashflowNote, /回收金额超过/)
  for (const key of ['purchase_total', 'maintenance_total', 'disposal_total', 'cashflow_net']) report.totals[key] = '0.00'
  report.purchase_leaders.forEach(item => { item.purchase_price = '0.00'; item.share = null })
  const zero = presentMonthly(report)
  assert.deepEqual(zero.bars.map(i => i.width), [0, 0, 0])
  assert.equal(zero.findingBasis, '')
  assert.ok(!zero.finding.includes('%'))
  assert.equal(planReport(context(), report).commands.some(c => c.kind === 'rect' && c.height === 7), false)
})

test('measured image grows for long names, omits empty sections and keeps every dynamic line in its bounds', () => {
  const report = fixture(), short = planReport(context(), report)
  report.purchases.forEach(item => { item.name = '特别长的物品名字'.repeat(30) })
  report.memories = Array.from({ length: 5 }, (_, i) => ({ key: String(i), item_id: 1, name: '旅行相机'.repeat(30), date: '2026-09-20', label: '相伴一周年' }))
  const c = context(), long = planReport(c, report)
  assert.ok(long.height > short.height)
  assert.equal(long.commands.filter(command => command.kind === 'stamp').length, 3)
  assert.ok(long.commands.some(command => command.kind === 'text' && command.lines.join('').includes('另有 2 条纪念')))
  for (const command of long.commands.filter(command => command.kind === 'text')) {
    c.font = command.size + 'px sans-serif'
    assert.ok(command.lines.every(line => c.measureText(line).width <= command.available))
    assert.ok(command.y + (command.lines.length - 1) * (command.size + 10) < long.height - 24)
  }
  report.has_activity = false; report.purchases = []; report.memories = []; report.purchase_leaders = []
  const empty = planReport(context(), report)
  assert.ok(empty.height < short.height)
  assert.ok(!empty.commands.some(command => command.kind === 'text' && command.lines.join('').includes('钱花在哪里')))
})

test('original report assets are local, transparent and exported at triple size', () => {
  const entries = [...Array.from({ length: 12 }, (_, i) => ['month-' + String(i + 1).padStart(2, '0'), 176, 138]),
    ['masthead', 156, 36], ['archive-sketch', 130, 148]]
  for (const [name, w, h] of entries) {
    const directory = path.resolve(__dirname, '../miniprogram/assets/report')
    const png = fs.readFileSync(path.join(directory, name + '.png'))
    assert.equal(png.readUInt32BE(16), w * 3)
    assert.equal(png.readUInt32BE(20), h * 3)
    assert.equal(png[25], 6)
    const svg = fs.readFileSync(path.join(directory, name + '.svg'), 'utf8')
    assert.ok(!/<text|<image|href=/.test(svg))
  }
})

test('poster text keeps percentage tokens and closing punctuation with meaningful text', () => {
  const c = context(); c.font = '20px sans-serif'
  const lines = wrapLines(c, '该物品占本月购置支出的 79.73%。', 130, 5)
  assert.ok(lines.some(line => line.includes('79.73%')))
  assert.ok(lines.every(line => !/^[，。！？%]/.test(line)))
  assert.ok(lines.every(line => c.measureText(line).width <= 130))
})

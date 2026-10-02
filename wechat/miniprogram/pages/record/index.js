const api = require('../../utils/api')
const view = require('../../utils/view')
Page({
  data: { kind: 'usage', recordId: 0, today: view.today(), form: { used_on: view.today(), maintained_on: view.today(),
    disposed_on: view.today(), cost: '', description: '', proceeds: '', method: 'sold', notes: '' },
    methods: ['出售', '赠送', '丢弃', '其他'], methodIndex: 0, busy: false, loading: false, loadFailed: false, focusField: '', error: '' },
  onLoad(options) {
    if (!getApp().requireSession()) return
    this.itemId = Number(options.itemId)
    this.recordId = Number(options.id || 0)
    this.kind = options.kind
    if (!['usage', 'maintenance', 'disposal'].includes(this.kind) || !this.itemId) { wx.navigateBack(); return }
    this.setData({ kind: this.kind, recordId: this.recordId })
    if (this.recordId) this.load()
  },
  async load() {
    this.setData({ loading: true, loadFailed: false, error: '' })
    try {
      const item = await api.request(`/items/${this.itemId}`)
      const records = this.kind === 'disposal' ? [item.disposal] : item[`${this.kind}_records`]
      const record = records.find(entry => entry && entry.id === this.recordId)
      if (!record) throw new Error('记录已不存在')
      this.setData({ form: { ...this.data.form, ...record }, methodIndex: ['sold', 'gifted', 'discarded', 'other'].indexOf(record.method) < 0 ? 0 : ['sold', 'gifted', 'discarded', 'other'].indexOf(record.method) })
    } catch (error) { this.setData({ loadFailed: true, error: view.errorMessage(error) }) }
    finally { this.setData({ loading: false }) }
  },
  input(event) { this.setData({ [`form.${event.currentTarget.dataset.key}`]: event.detail.value }) },
  focus(event) { this.setData({ focusField: event.currentTarget.dataset.key }) },
  blur() { this.setData({ focusField: '' }) },
  methodChange(event) {
    const index = Number(event.detail.value)
    this.setData({ methodIndex: index, 'form.method': ['sold', 'gifted', 'discarded', 'other'][index] })
  },
  async save() {
    if (this.data.busy || this.data.loading || this.data.loadFailed) return
    this.setData({ busy: true, error: '' })
    const base = `/items/${this.itemId}/${this.kind}`
    const path = this.recordId ? `/${this.kind}/${this.recordId}` : base
    const form = this.data.form
    const payload = this.kind === 'usage' ? { used_on: form.used_on, notes: form.notes }
      : this.kind === 'maintenance' ? { maintained_on: form.maintained_on, cost: form.cost, description: form.description }
        : { disposed_on: form.disposed_on, method: form.method, proceeds: form.proceeds, notes: form.notes }
    try { await api.request(path, { method: this.recordId ? 'PUT' : 'POST', data: payload }); wx.navigateBack() }
    catch (error) { this.setData({ error: view.errorMessage(error) }) }
    finally { this.setData({ busy: false }) }
  },
  async remove() {
    const confirm = await new Promise(resolve => wx.showModal({ title: '删除这条记录？', content: '删除后统计会重新计算。', success: result => resolve(result.confirm) }))
    if (!confirm) return
    try { await api.request(`/${this.kind}/${this.recordId}`, { method: 'DELETE' }); wx.navigateBack() }
    catch (error) { this.setData({ error: view.errorMessage(error) }) }
  }
})

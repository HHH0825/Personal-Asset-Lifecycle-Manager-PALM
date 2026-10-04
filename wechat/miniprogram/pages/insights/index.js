const api = require('../../utils/api')
const view = require('../../utils/view')
const { readStats, readCards } = require('../../utils/discovery')
const { readMonthly, presentMonthly } = require('../../utils/monthly')
const { navigate, resetNavigation } = require('../../utils/navigation')
const emptyState = () => ({ cards: [], stats: null, statsLoading: true, cardsLoading: true,
  statsError: '', cardsError: '', monthly: null, monthlyLoading: true, monthlyError: '' })
Page({
  data: emptyState(),
  onLoad() { this._sequences = { stats: 0, cards: 0, monthly: 0 } },
  onShow() {
    this._visible = true
    resetNavigation(this)
    if (getApp().requireSession()) { this.load(); this.loadMonthly() }
  },
  onHide() { this.invalidate(); this.setData(emptyState()) },
  onUnload() { this.invalidate() },
  invalidate() {
    this._visible = false
    this._sequences.stats += 1
    this._sequences.cards += 1
    this._sequences.monthly += 1
  },
  current(section, sequence, token) {
    return this._visible && this._sequences[section] === sequence && getApp().globalData.token === token
  },
  async readSection(section, path, parse) {
    if (!this._visible || !getApp().requireSession()) return
    const sequence = ++this._sequences[section], token = getApp().globalData.token
    this.setData({ [section]: section === 'cards' ? [] : null, [`${section}Loading`]: true, [`${section}Error`]: '' })
    try {
      const response = await api.request(path)
      if (!this.current(section, sequence, token)) return
      this.setData({ [section]: parse(response) })
    } catch (error) {
      if (this.current(section, sequence, token)) this.setData({ [`${section}Error`]: view.errorMessage(error) })
    } finally {
      if (this.current(section, sequence, token)) this.setData({ [`${section}Loading`]: false })
    }
  },
  loadStats() { return this.readSection('stats', '/stats', readStats) },
  loadCards() { return this.readSection('cards', '/insights', readCards) },
  loadMonthly() { return this.readSection('monthly', '/reports/monthly', data => {
    const report = readMonthly(data)
    return { ...report, page: presentMonthly(report) }
  }) },
  monthlyReport() { navigate(this, '/pages/monthly/index' + (this.data.monthly ? '?month=' + this.data.monthly.month : '')) },
  load() { return Promise.all([this.loadStats(), this.loadCards()]) },
  open(event) { navigate(this, `/pages/item/index?id=${event.currentTarget.dataset.id}`) },
  onPullDownRefresh() { Promise.all([this.load(), this.loadMonthly()]).finally(() => wx.stopPullDownRefresh()) }
})

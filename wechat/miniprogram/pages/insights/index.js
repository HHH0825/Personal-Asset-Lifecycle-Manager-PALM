const api = require('../../utils/api')
const view = require('../../utils/view')
Page({
  data: { cards: [], stats: null, loading: true, error: '' },
  onShow() { if (getApp().requireSession()) this.load() },
  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const [stats, insights] = await Promise.all([api.request('/stats'), api.request('/insights')])
      this.setData({ stats, cards: insights.analysis_cards.map((card, index) => ({ ...card, key: index,
        items: card.items.map(item => ({ ...item, icon: view.icon(item.icon_type) })) })) })
    } catch (error) { this.setData({ error: view.errorMessage(error) }) }
    finally { this.setData({ loading: false }) }
  },
  open(event) { wx.navigateTo({ url: `/pages/item/index?id=${event.currentTarget.dataset.id}` }) },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) }
})

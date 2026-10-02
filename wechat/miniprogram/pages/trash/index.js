const api = require('../../utils/api')
const view = require('../../utils/view')
Page({
  data: { items: [], loading: true, error: '' },
  onShow() { if (getApp().requireSession()) this.load() },
  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const items = await api.request('/trash')
      this.setData({ items: items.map(item => ({ ...item, icon: view.icon(item.icon_type),
        deletedDay: item.deleted_at.slice(0, 10), expiresDay: item.expires_at.slice(0, 10) })) })
    } catch (error) { this.setData({ error: view.errorMessage(error) }) }
    finally { this.setData({ loading: false }) }
  },
  async restore(event) {
    try { await api.request(`/trash/${event.currentTarget.dataset.id}/restore`, { method: 'POST' }); wx.showToast({ title: '已恢复' }); this.load() }
    catch (error) { wx.showToast({ title: view.errorMessage(error), icon: 'none' }); this.load() }
  },
  async remove(event) {
    const id = event.currentTarget.dataset.id
    const confirm = await new Promise(resolve => wx.showModal({ title: '永久删除？',
      content: '此物品的照片、使用、维修、处置记录和目标设置都会一起删除，无法恢复。', success: result => resolve(result.confirm) }))
    if (!confirm) return
    try { await api.request(`/trash/${id}`, { method: 'DELETE' }); wx.showToast({ title: '已永久删除' }); this.load() }
    catch (error) { wx.showToast({ title: view.errorMessage(error), icon: 'none' }) }
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) }
})

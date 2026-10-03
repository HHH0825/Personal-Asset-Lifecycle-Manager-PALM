const view = require('./view')

function readStats(stats) {
  const amounts = ['net_cost_total', 'purchase_total', 'maintenance_total', 'disposal_total']
  if (!stats || !Number.isSafeInteger(stats.total_items) || stats.total_items < 0 ||
      !amounts.every(key => typeof stats[key] === 'string' && /^-?\d+\.\d{2}$/.test(stats[key]))) {
    throw new Error('统计数据格式异常，请重试')
  }
  return stats
}

function readCards(insights) {
  if (!insights || !Array.isArray(insights.analysis_cards)) throw new Error('分析数据格式异常，请重试')
  return insights.analysis_cards.map((card, index) => {
    if (!card || !['kind', 'label', 'headline', 'explanation'].every(key => typeof card[key] === 'string') ||
        !Array.isArray(card.items) || !card.items.every(item => item && Number.isSafeInteger(item.id) &&
          item.id > 0 && typeof item.name === 'string')) throw new Error('分析数据格式异常，请重试')
    return { ...card, key: index, items: card.items.map(item => ({ ...item, icon: view.icon(item.icon_type) })) }
  })
}

module.exports = { readStats, readCards }

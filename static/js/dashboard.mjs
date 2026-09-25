import { $, statusNames, iconTypes, itemVisual, escapeHtml, yuan, badge, empty } from './common.mjs';
function renderRecentItems(allItems) {
  $('#recent-items').innerHTML = allItems.length ? allItems.slice(0, 4).map((item) => `<div class="mini-item">${itemVisual(item, 'mini-icon')}<div class="mini-main"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category)} · ${iconTypes[item.icon_type] || iconTypes.other} · ${item.purchase_date}</small></div>${badge(item.status)}<span class="mini-price">${yuan(item.purchase_price)}</span></div>`).join('') : empty('还没有物品', '点击右上角“添加物品”开始记录。');
}
function renderDashboard(stats, insights, allItems) {
  const cards = [
    ['物品总数', stats.total_items, '件已记录的物品'],
    ['累计购买费用', yuan(stats.purchase_total), '所有物品的购买价格'],
    ['累计维修费用', yuan(stats.maintenance_total), '维修记录费用合计'],
    ['累计净成本', yuan(stats.net_cost_total), `已回收 ${yuan(stats.disposal_total)}`],
  ];
  $('#stats-grid').innerHTML = cards.map(([label, value, sub]) => `<article class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-sub">${sub}</div></article>`).join('');
  const max = Math.max(...stats.categories.map((item) => Number(item.amount)), 1);
  $('#category-chart').innerHTML = stats.categories.length ? stats.categories.map((item) => `<div class="bar-row"><span class="bar-label" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, Number(item.amount) / max * 100)}%"></div></div><span class="bar-amount">${yuan(item.amount)}</span></div>`).join('') : empty('暂无分类数据', '添加物品后，这里会显示金额分布。');
  $('#status-chart').innerHTML = Object.entries(statusNames).map(([key, label]) => `<div class="status-row"><span>${label}</span><div class="status-track"><div class="status-fill ${key}" style="width:${stats.total_items ? stats.status_counts[key] / stats.total_items * 100 : 0}%"></div></div><strong>${stats.status_counts[key]}</strong></div>`).join('');
  renderRecentItems(allItems);
  const maxMonthly = Math.max(1, ...insights.months.flatMap((month) => [Number(month.purchase), Number(month.maintenance), Number(month.proceeds)]));
  $('#monthly-chart').innerHTML = insights.months.map((month) => {
    const label = `${month.month}：购买 ${yuan(month.purchase)}，维修 ${yuan(month.maintenance)}，回收 ${yuan(month.proceeds)}`;
    const bars = [['purchase', month.purchase], ['maintenance', month.maintenance], ['proceeds', month.proceeds]]
      .map(([kind, amount]) => `<span class="cash-bar ${kind}" style="height:${Number(amount) ? Math.max(4, Number(amount) / maxMonthly * 135) : 0}px"></span>`).join('');
    return `<div class="cash-month" title="${label}"><div class="cash-bars" role="img" aria-label="${label}">${bars}</div><span>${month.month.slice(5)}</span><small>${month.month.slice(2, 4)}年</small></div>`;
  }).join('');
}

export { renderDashboard, renderRecentItems };

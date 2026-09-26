import { $, statusNames, iconTypes, iconMarkup, itemVisual, decorativeIcon, escapeHtml, yuan, badge, empty } from './common.mjs';
function sortedItems(items, order = 'newest') {
  const metrics = {
    holding_desc: ['holding_days', -1], holding_asc: ['holding_days', 1],
    price_desc: ['purchase_price', -1], price_asc: ['purchase_price', 1],
    daily_purchase_asc: ['daily_purchase_cost', 1], daily_net_asc: ['daily_net_cost', 1],
  };
  return [...items].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    if (order === 'newest' || !metrics[order]) return b.id - a.id;
    const [key, direction] = metrics[order];
    const first = a[key] == null ? null : Number(a[key]);
    const second = b[key] == null ? null : Number(b[key]);
    if (first === null || second === null) return first === second ? b.id - a.id : first === null ? 1 : -1;
    return direction * (first - second) || b.id - a.id;
  });
}
function filterItems(items, { q = '', status = 'all', category = 'all', sort = 'newest' } = {}) {
  const keyword = q.trim().toLocaleLowerCase();
  return sortedItems(items.filter((item) => (status === 'all' || item.status === status)
    && (category === 'all' || item.category === category)
    && (`${item.name} ${item.category}`).toLocaleLowerCase().includes(keyword)), sort);
}
function renderItems(allItems) {
  const categorySelect = $('#category-filter');
  const category = categorySelect.value;
  const categories = [...new Set(allItems.map((item) => item.category))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  categorySelect.innerHTML = '<option value="all">全部分类</option>' + categories.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  categorySelect.value = categories.includes(category) ? category : 'all';
  const filtered = filterItems(allItems, { q: $('#search-input').value,
    status: $('#status-filter').value,
    category: categorySelect.value, sort: $('#sort-order').value });
  $('#item-count').textContent = `${filtered.length} / ${allItems.length} 件物品`;
  if (!allItems.length) {
    $('#items-list').innerHTML = `<div class="items-empty"><span class="item-icon">${iconMarkup('other')}</span><span class="eyebrow">ARCHIVE / 001</span><h2>从第一件物品开始</h2><p>记下它的购入时间与价格，以后使用、维修和去向都能接着记录。</p><button type="button" class="primary-btn" data-action="add-item">＋ 添加第一件物品</button></div>`;
    return;
  }
  $('#items-list').innerHTML = filtered.length ? filtered.map((item) => `
    <article class="item-card">
      <button type="button" class="item-card-open" data-open-item="${item.id}" aria-label="查看${escapeHtml(item.name)}详情"></button>
      <div class="item-card-head">${itemVisual(item, 'item-icon')}<div class="item-main"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category)} · ${iconTypes[item.icon_type] || iconTypes.other}</small></div><div class="item-status">${badge(item.status)}</div></div>
      <div class="item-purchase">购于 ${item.purchase_date}</div>
      <div class="item-card-metrics"><div><span>${item.status === 'disposed' ? '曾持有' : '已持有'}</span><strong>${item.holding_days} 天</strong></div><div><span>购买价/天</span><strong>${item.daily_purchase_cost === null ? '暂无' : yuan(item.daily_purchase_cost)}</strong></div><div><span>净成本/天</span><strong>${item.daily_net_cost === null ? '暂无' : yuan(item.daily_net_cost)}</strong></div></div>
      ${itemHint(item)}
      <div class="item-card-foot"><span>累计净成本</span><strong>${yuan(item.net_cost)}</strong><span class="item-card-arrow" aria-hidden="true">↗</span></div>
      <div class="item-card-actions">${item.status === 'disposed' ? '' : `<button type="button" class="small-btn quick-use-btn" data-quick-use="${item.id}" ${item.used_today ? 'disabled' : ''}>${item.used_today ? '✓ 今日已记录' : '＋ 今天用过'}</button>`}<button type="button" class="small-btn pin-btn" data-pin-item="${item.id}" aria-pressed="${item.is_pinned}">${item.is_pinned ? '◆ 已置顶' : '◇ 置顶'}</button></div>
    </article>`).join('') : empty('没有找到物品', '可以调整搜索词、状态或分类筛选。');
}
function itemHint(item) {
  const today = item.milestones.earned.find((entry) => entry.is_today);
  const target = item.daily_target;
  let text = '';
  if (today) text = `今天，${today.label}。值得记住的一天！`;
  else if (target) {
    if (target.status === 'reached') text = `已达成每天 ${yuan(target.amount)} 的小目标`;
    else if (target.status === 'closed') text = '持有已结束，花费目标未达成';
    else text = `距离每天 ${yuan(target.amount)}，还需 ${target.remaining_days.toLocaleString('zh-CN')} 天`;
  } else if (item.milestones.next) text = `再过 ${item.milestones.next.remaining_days} 天，${item.milestones.next.label}`;
  else if (item.milestones.earned.length) text = `留下了一枚「${item.milestones.earned.at(-1).label}」纪念章`;
  return text ? `<div class="item-card-note ${today ? 'today-note' : ''}">${decorativeIcon(today ? 'spark' : 'sprout')}<span>${escapeHtml(text)}</span></div>` : '';
}

export { sortedItems, filterItems, renderItems };

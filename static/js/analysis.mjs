import { $, iconTile, escapeHtml } from './common.mjs';
function renderReview(insights) {
  const cards = insights.analysis_cards || [];
  const marks = { digital_share: '◒', warranty_due: '◷', warranty_expired: '◷', manual_idle: '○', inactive: '◴', unknown_use: '?', repair_leader: '↗', purchase_yoy: '↗' };
  $('#review-count').textContent = `${cards.length} 条发现`;
  $('#analysis-cards').innerHTML = cards.length ? cards.map((card, index) => `<article class="analysis-card" data-kind="${escapeHtml(card.kind)}"><div class="analysis-card-top"><span class="analysis-card-index">${String(index + 1).padStart(2, '0')} / ${escapeHtml(card.label)}</span><span class="analysis-card-mark" aria-hidden="true">${marks[card.kind] || '✳'}</span></div><h3>${escapeHtml(card.headline)}</h3><p>${escapeHtml(card.explanation)}</p>${card.items?.length ? `<div class="analysis-card-links">${card.items.map((item) => `<button type="button" class="analysis-item-link" data-open-item="${item.id}" aria-label="查看${escapeHtml(item.name)}的物品详情">${iconTile(item.icon_type, 'analysis-item-icon')}<span>${escapeHtml(item.name)}</span><span aria-hidden="true">↗</span></button>`).join('')}</div>` : ''}</article>`).join('')
    : `<div class="analysis-empty"><span aria-hidden="true">✳</span><h3>线索还在慢慢累积</h3><p>添加物品、填写保修日期或记下关键使用与维修记录后，这里会出现基于事实的观察。</p><button type="button" class="primary-btn" data-action="add-item">添加物品</button></div>`;
}

export { renderReview };

import { $, methodNames, iconTypes, decorativeIcon, itemVisual, escapeHtml, yuan, badge } from './common.mjs';
function milestonesMarkup(item) {
  const { earned, next } = item.milestones;
  return `<section class="journey-section"><div class="journey-heading"><div><span class="eyebrow">OUR LITTLE MILESTONES</span><h3>相伴的纪念</h3></div>${decorativeIcon('spark')}</div>${earned.length ? `<div class="keepsake-list">${earned.map((entry) => `<div class="keepsake ${entry.is_today ? 'is-today' : ''}" data-celebration="${entry.id}:${entry.date}"><strong>${entry.number}</strong><span>${entry.label}</span><small>${entry.date}</small></div>`).join('')}</div>` : `<p class="journey-empty">${item.status === 'disposed' ? '这段陪伴已经收好，记录会留在时间线上。' : '每一段长久的陪伴，都从第一天开始。'}</p>`}${next ? `<div class="keepsake-next">${decorativeIcon('sprout')}<span>距离「${next.label}」还有 <strong>${next.remaining_days} 天</strong><br><small>${next.date} · 下一枚纪念章</small></span></div>` : '<p class="hint">纪念章按持有时间生成，记录这段陪伴的足迹。</p>'}</section>`;
}
function targetMarkup(item) {
  const target = item.daily_target;
  const disposed = item.status === 'disposed';
  let summary = '<p class="goal-state">给相伴的日子，设一个小期待。</p>';
  if (target) {
    const state = target.status === 'reached' ? '小目标已达成！' : target.status === 'closed' ? '持有已结束，目标未达成' : `还需持有 ${target.remaining_days.toLocaleString('zh-CN')} 天`;
    const dateText = target.status === 'reached' ? `${target.reached_on} 达成 · 这段日子值得记住` : target.status === 'closed' ? '进度已停留在处置日' : target.estimated_date ? `预计 ${target.estimated_date} 达成` : '所需时间过长，暂无法显示预计日期';
    summary = `<div class="goal-readout"><strong>${yuan(target.amount)}<small> / 天</small></strong><small>${target.progress_percent}%</small></div><div class="goal-track" role="progressbar" aria-label="购买价日均目标进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${target.progress_percent}"><span style="width:${target.progress_percent}%"></span></div><p class="goal-state">${state}</p><p class="goal-date">${dateText}</p>`;
  } else if (disposed) summary = '<p class="goal-state">这件物品没有设置花费目标。</p>';
  return `<section class="goal-section ${target?.status === 'reached' ? 'goal-reached' : ''}" ${target ? `data-celebration="goal:${target.amount}:${target.reached_on}"` : ''}><h3 class="goal-title">${decorativeIcon('sun')} 日均花费小目标</h3>${summary}${disposed ? '<p class="hint">已处置物品的目标只读；撤销处置后可调整。</p>' : `<form id="goal-form" class="goal-form"><label for="goal-amount">${target ? '调整目标' : '我希望购买价每天不超过'}（元）</label><div class="goal-presets">${['0.50','1.00','2.00'].map((amount) => `<button type="button" data-goal-preset="${amount}">¥${amount}</button>`).join('')}</div><div class="goal-input-row"><input id="goal-amount" name="amount" type="number" min="0.01" max="999999999" step="0.01" inputmode="decimal" required placeholder="例如 1.00" value="${target ? target.amount : ''}"><button type="submit" class="primary-btn">${target ? '更新' : '设定'}</button></div>${target ? '<button type="button" class="text-btn goal-cancel" data-action="cancel-goal">取消这个目标</button>' : ''}<p id="goal-error" class="form-error hidden" role="alert"></p></form>`}<p class="hint">仅按购买价格均摊，从购买日起计算。维修不改变此目标；这不是当天的支出，也不代表实际使用频率。</p></section>`;
}
const celebrated = new Set();
function celebrateToday(item, currentUser) {
  if (!currentUser || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const events = item.milestones.earned.filter((entry) => entry.is_today).map((entry) => `${entry.id}:${entry.date}`);
  if (item.daily_target?.is_today) events.push(`goal:${item.daily_target.amount}:${item.daily_target.reached_on}`);
  for (const event of events) {
    const key = `palm:celebration:${currentUser.id}:${item.id}:${event}`;
    if (celebrated.has(key)) continue;
    try { if (sessionStorage.getItem(key)) continue; sessionStorage.setItem(key, '1'); } catch (_) { /* Memory fallback when browser storage is disabled. */ }
    celebrated.add(key);
    document.querySelectorAll('[data-celebration]').forEach((element) => { if (element.dataset.celebration === event) element.classList.add('celebrate'); });
  }
}
function timeline(item) {
  const events = [
    { date: item.purchase_date, id: 0, title: '购买物品', text: `购买价格 ${yuan(item.purchase_price)}`, type: 'purchase' },
    ...item.usage_records.map((r) => ({ date: r.used_on, id: r.id, title: '使用记录', text: r.notes, type: 'usage' })),
    ...item.maintenance_records.map((r) => ({ date: r.maintained_on, id: r.id, title: '维修记录', text: `${r.description} · 费用 ${yuan(r.cost)}`, type: 'maintenance' })),
    ...(item.disposal ? [{ date: item.disposal.disposed_on, id: item.disposal.id, title: `已${methodNames[item.disposal.method]}`, text: `回收金额 ${yuan(item.disposal.proceeds)}${item.disposal.notes ? ` · ${item.disposal.notes}` : ''}`, type: 'disposal' }] : []),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  return events.map((event) => `<div class="timeline-row"><div class="timeline-content"><strong>${event.title}</strong><p>${escapeHtml(event.text)}</p><small>${event.date}</small></div>${event.type === 'purchase' ? '' : `<div class="timeline-actions"><button class="small-btn" data-edit-record="${event.type}:${event.id}">编辑</button><button class="small-btn danger" data-delete-record="${event.type}:${event.id}">删除</button></div>`}</div>`).join('');
}
function renderDetail(item, currentUser) {
  if (!item) return;
  const preview = item.status === 'disposed' ? '' : `<section class="detail-section preview-section"><h3>处置前试算</h3><label class="preview-label" for="preview-proceeds">预计回收金额（元）</label><input id="preview-proceeds" type="number" min="0" max="999999999" step="0.01" inputmode="decimal" placeholder="例如 200.00"><div id="preview-result" class="preview-result" aria-live="polite">输入预计回收金额，查看处置后的净成本。</div><p class="hint">仅供参考，试算不会保存数据或改变物品状态。</p></section>`;
  $('#detail-content').innerHTML = `
    <div class="detail-hero">
      <div class="detail-top">${itemVisual(item, 'item-icon')}<div class="detail-main"><h2>${escapeHtml(item.name)} ${badge(item.status)}</h2><p>${escapeHtml(item.category)} · ${iconTypes[item.icon_type] || iconTypes.other} · 购买于 ${item.purchase_date}</p><p class="detail-warranty">保修到期：${item.warranty_expires_on || '未填写'}</p></div><div class="detail-actions"><button class="small-btn" data-action="edit-item">编辑物品</button><button class="small-btn danger" data-action="delete-item">删除物品</button></div></div>
      <div class="detail-metrics"><div><span>购买价格</span><strong>${yuan(item.purchase_price)}</strong></div><div><span>维修费用</span><strong>${yuan(item.maintenance_total)}</strong></div><div><span>累计净成本</span><strong>${yuan(item.net_cost)}</strong></div><div><span>${item.status === 'disposed' ? '曾持有' : '已持有'} · 使用记录 ${item.usage_count} 条</span><strong>${item.holding_days} 天</strong></div></div>
    </div>
    <div class="detail-grid"><div>${item.photo_url ? `<section class="detail-section item-photo-section"><div class="section-heading"><h3>物品照片</h3><button type="button" class="text-btn" data-action="remove-photo">删除照片</button></div><img class="detail-photo-large" src="${escapeHtml(item.photo_url)}" alt="${escapeHtml(item.name)}的照片"></section>` : ''}${milestonesMarkup(item)}${targetMarkup(item)}<section class="detail-section"><div class="section-heading"><h3>生命周期时间线</h3></div>${timeline(item)}</section></div>
    <div><section class="detail-section cost-section"><h3>持有成本</h3><div class="daily-cost"><span>购买价/天</span><strong>${item.daily_purchase_cost === null ? '暂无' : yuan(item.daily_purchase_cost)}</strong></div><div class="daily-cost"><span>净成本/天</span><strong>${item.daily_net_cost === null ? '暂无' : yuan(item.daily_net_cost)}</strong></div><p class="note-text">${item.daily_net_cost === null ? '持有不足一天，暂不计算日均花费。' : `按 ${item.holding_days} 天持有时间计算。`}<br>净成本包含维修费用，并扣除处置回收金额。<br>最近一次记录的使用：${item.last_recorded_use || '未记录'}</p></section>
    ${preview}
    <section class="detail-section"><h3>记录操作</h3><div class="detail-actions"><button class="small-btn" data-action="add-usage" ${item.status === 'disposed' ? 'disabled' : ''}>＋ 使用记录</button><button class="small-btn" data-action="add-maintenance" ${item.status === 'disposed' ? 'disabled' : ''}>＋ 维修记录</button>${item.disposal ? '' : '<button class="small-btn" data-action="add-disposal">＋ 处置物品</button>'}</div></section>
    <section class="detail-section"><h3>物品备注</h3><div class="note-text">${item.notes ? escapeHtml(item.notes) : '暂无备注'}</div></section>
    <section class="detail-section"><h3>计算说明</h3><p class="note-text">净成本 = 购买价格 + 维修费用 − 处置回收金额。<br>持有天数从购买日算至${item.disposal ? '处置日' : '今天'}。</p></section></div></div>`;
  celebrateToday(item, currentUser);
}

function updateDisposalPreview(currentItem) {
  const input = $('#preview-proceeds');
  const result = $('#preview-result');
  if (!input || !result || !currentItem) return;
  const raw = input.value.trim();
  result.classList.remove('has-values');
  if (!raw) { result.textContent = '输入预计回收金额，查看处置后的净成本。'; return; }
  if (!/^\d+(\.\d{1,2})?$/.test(raw) || Number(raw) > 999999999) {
    result.textContent = '请输入非负金额，最多两位小数。';
    return;
  }
  const purchase = Math.round(Number(currentItem.purchase_price) * 100);
  const maintenance = Math.round(Number(currentItem.maintenance_total) * 100);
  const proceeds = Math.round(Number(raw) * 100);
  const base = purchase + maintenance;
  const projected = (base - proceeds) / 100;
  const recovery = base ? `${(proceeds / base * 100).toFixed(1)}%` : '暂无（累计支出为零）';
  result.innerHTML = `<div><span>预计净成本</span><strong>${yuan(projected)}</strong></div><div><span>回收比例</span><strong>${recovery}</strong></div>`;
  result.classList.add('has-values');
}


export { renderDetail, updateDisposalPreview };

const $ = (selector) => document.querySelector(selector);
const statusNames = { active: '使用中', idle: '闲置', disposed: '已处置' };
const methodNames = { sold: '出售', gifted: '赠送', discarded: '丢弃', other: '其他' };
const iconTypes = { digital: '数码', home: '家居', daily: '日常用品', clothing: '衣物', books: '书籍文具', mobility: '出行', sports: '运动', tools: '工具', other: '其他' };
const avatarNames = { sprout: '新芽', cat: '猫', book: '书', sun: '太阳', bike: '单车', star: '星星' };
function avatarMarkup(key, className = 'avatar') {
  const avatar = Object.prototype.hasOwnProperty.call(avatarNames, key) ? key : 'sprout';
  return `<span class="${className}" data-avatar="${avatar}" aria-hidden="true"><svg><use href="/static/avatars.svg#${avatar}"></use></svg></span>`;
}
function iconMarkup(type) {
  const key = Object.prototype.hasOwnProperty.call(iconTypes, type) ? type : 'other';
  return `<svg class="type-icon" aria-hidden="true" focusable="false"><use href="/static/icons.svg#${key}"></use></svg>`;
}
function iconTile(type, className = 'item-icon') {
  const key = Object.prototype.hasOwnProperty.call(iconTypes, type) ? type : 'other';
  return `<span class="${className}" data-type="${key}">${iconMarkup(key)}</span>`;
}
function decorativeIcon(name) {
  return `<svg class="type-icon" aria-hidden="true"><use href="/static/icons.svg#${name}"></use></svg>`;
}
const todayLocal = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
let allItems = [];
let currentItem = null;
let detailReturnView = 'items';
let formState = null;
let toastTimer;
let csrfToken = null;
let currentUser = null;
let sessionEpoch = 0;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function yuan(value) {
  const amount = Number(value);
  return `${amount < 0 ? '-' : ''}¥${Math.abs(amount).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function showToast(message, error = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase())) headers['X-CSRF-Token'] = csrfToken || '';
  const response = await fetch(path, { ...options, credentials: 'same-origin', headers });
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try { message = (await response.json()).error || message; } catch (_) { /* response has no JSON */ }
    if (response.status === 401 && !path.startsWith('/api/auth/')) {
      showAuth();
    }
    if (response.status === 403 && !path.startsWith('/api/auth/')) {
      const state = await api('/api/auth/me');
      if (!state.user || state.user.id !== currentUser?.id) showAuth();
      else csrfToken = state.csrf_token;
    }
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}
function clearAccount() {
  sessionEpoch++;
  if ($('#form-dialog').open) $('#form-dialog').close();
  allItems = [];
  currentItem = null;
  currentUser = null;
  formState = null;
  csrfToken = null;
  $('#search-input').value = '';
  $('#status-filter').value = 'all';
  for (const selector of ['#items-list', '#detail-content', '#recent-items', '#stats-grid', '#category-chart', '#status-chart', '#monthly-chart', '#analysis-cards']) $(selector).replaceChildren();
  $('#account-name').textContent = '';
  $('#username-form').reset();
  $('#password-form').reset();
  $('#item-count').textContent = '';
  $('#review-count').textContent = '';
  clearTimeout(toastTimer);
  $('#toast').classList.add('hidden');
  $('#app-shell').classList.add('hidden');
}
function setAccountUser(user) {
  currentUser = user;
  $('#account-name').textContent = user.username;
  const key = Object.prototype.hasOwnProperty.call(avatarNames, user.avatar_key) ? user.avatar_key : 'sprout';
  for (const selector of ['#account-avatar', '#profile-avatar']) {
    const el = $(selector);
    el.dataset.avatar = key;
    el.innerHTML = `<svg aria-hidden="true"><use href="/static/avatars.svg#${key}"></use></svg>`;
  }
  $('#new-username').value = user.username;
  $('#avatar-options').innerHTML = Object.entries(avatarNames).map(([avatar, name]) => `<label class="avatar-choice"><input type="radio" name="avatar_key" value="${avatar}" ${key === avatar ? 'checked' : ''}><span class="avatar-choice-face">${avatarMarkup(avatar)}<span>${name}</span></span></label>`).join('');
}
function showAuth() {
  clearAccount();
  location.replace('/login?expired=1');
}
async function showApp(user) {
  sessionEpoch++;
  setAccountUser(user);
  $('#app-loading').classList.add('hidden');
  $('#app-shell').classList.remove('hidden');
  showView('items');
  try { await refreshAll(); }
  catch (error) { showToast(`部分数据加载失败：${error.message}`, true); }
}
async function bootstrap() {
  $('#app-retry').classList.add('hidden');
  try {
    const state = await api('/api/auth/me');
    csrfToken = state.csrf_token;
    if (state.user) await showApp(state.user);
    else showAuth();
  } catch (error) {
    $('#app-loading p').textContent = '手账暂时没能打开，请检查服务后重试。';
    $('#app-retry').classList.remove('hidden');
  }
}
async function run(action, successMessage) {
  try { await action(); if (successMessage) showToast(successMessage); }
  catch (error) { showToast(error.message, true); }
}
function showView(name) {
  if (name === 'account' && currentUser) setAccountUser(currentUser);
  for (const view of document.querySelectorAll('.view')) view.classList.toggle('hidden', view.id !== `${name}-view`);
  for (const link of document.querySelectorAll('.nav-link')) link.classList.toggle('active', link.dataset.view === name);
  $('#page-title').textContent = ({ dashboard: '数据概览', items: '我的物品', review: '智能分析中心', detail: '物品详情', account: '个人设置' })[name];
  $('#section-number').textContent = ({ items: '01', dashboard: '02', review: '03', detail: '01', account: '04' })[name];
  $('#add-item-btn').classList.toggle('hidden', name === 'account');
  window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}
function badge(status) { return `<span class="badge ${escapeHtml(status)}">${statusNames[status]}</span>`; }
function empty(title, subtitle = '') { return `<div class="empty"><strong>${title}</strong>${subtitle}</div>`; }

async function refreshAll() {
  const epoch = sessionEpoch;
  const items = await api('/api/items');
  if (epoch !== sessionEpoch) return;
  allItems = items;
  renderItems();
  renderRecentItems();
  const [stats, insights] = await Promise.all([api('/api/stats'), api('/api/insights')]);
  if (epoch !== sessionEpoch) return;
  renderDashboard(stats, insights);
  renderReview(insights);
}
function renderRecentItems() {
  $('#recent-items').innerHTML = allItems.length ? allItems.slice(0, 4).map((item) => `<div class="mini-item">${iconTile(item.icon_type, 'mini-icon')}<div class="mini-main"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category)} · ${iconTypes[item.icon_type] || iconTypes.other} · ${item.purchase_date}</small></div>${badge(item.status)}<span class="mini-price">${yuan(item.purchase_price)}</span></div>`).join('') : empty('还没有物品', '点击右上角“添加物品”开始记录。');
}
function renderDashboard(stats, insights) {
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
  renderRecentItems();
  const maxMonthly = Math.max(1, ...insights.months.flatMap((month) => [Number(month.purchase), Number(month.maintenance), Number(month.proceeds)]));
  $('#monthly-chart').innerHTML = insights.months.map((month) => {
    const label = `${month.month}：购买 ${yuan(month.purchase)}，维修 ${yuan(month.maintenance)}，回收 ${yuan(month.proceeds)}`;
    const bars = [['purchase', month.purchase], ['maintenance', month.maintenance], ['proceeds', month.proceeds]]
      .map(([kind, amount]) => `<span class="cash-bar ${kind}" style="height:${Number(amount) ? Math.max(4, Number(amount) / maxMonthly * 135) : 0}px"></span>`).join('');
    return `<div class="cash-month" title="${label}"><div class="cash-bars" role="img" aria-label="${label}">${bars}</div><span>${month.month.slice(5)}</span><small>${month.month.slice(2, 4)}年</small></div>`;
  }).join('');
}
function renderItems() {
  const keyword = $('#search-input').value.trim().toLocaleLowerCase();
  const status = $('#status-filter').value;
  const filtered = allItems.filter((item) => (status === 'all' || item.status === status) && (`${item.name} ${item.category}`).toLocaleLowerCase().includes(keyword));
  $('#item-count').textContent = `${filtered.length} 件物品`;
  if (!allItems.length) {
    $('#items-list').innerHTML = `<div class="items-empty"><span class="item-icon">${iconMarkup('other')}</span><span class="eyebrow">ARCHIVE / 001</span><h2>从第一件物品开始</h2><p>记下它的购入时间与价格，以后使用、维修和去向都能接着记录。</p><button type="button" class="primary-btn" data-action="add-item">＋ 添加第一件物品</button></div>`;
    return;
  }
  $('#items-list').innerHTML = filtered.length ? filtered.map((item) => `
    <article class="item-card" data-open-item="${item.id}" tabindex="0" role="button" aria-label="查看${escapeHtml(item.name)}">
      <div class="item-card-head">${iconTile(item.icon_type, 'item-icon')}<div class="item-main"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category)} · ${iconTypes[item.icon_type] || iconTypes.other}</small></div><div class="item-status">${badge(item.status)}</div></div>
      <div class="item-purchase">购于 ${item.purchase_date}</div>
      <div class="item-card-metrics"><div><span>${item.status === 'disposed' ? '曾持有' : '已持有'}</span><strong>${item.holding_days} 天</strong></div><div><span>购买价/天</span><strong>${item.daily_purchase_cost === null ? '暂无' : yuan(item.daily_purchase_cost)}</strong></div><div><span>净成本/天</span><strong>${item.daily_net_cost === null ? '暂无' : yuan(item.daily_net_cost)}</strong></div></div>
      ${itemHint(item)}
      <div class="item-card-foot"><span>累计净成本</span><strong>${yuan(item.net_cost)}</strong><span class="item-card-arrow" aria-hidden="true">↗</span></div>
    </article>`).join('') : empty('没有找到物品', '可以调整搜索词或状态筛选。');
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
function celebrateToday(item) {
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
async function saveTarget(amount) {
  const form = $('#goal-form');
  if (!form || !currentItem) return;
  const itemId = currentItem.id;
  const epoch = sessionEpoch;
  const error = $('#goal-error');
  error.classList.add('hidden');
  form.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  try {
    const saved = await api(`/api/items/${itemId}/daily-target`, { method: 'PUT', body: JSON.stringify({ amount }) });
    if (epoch !== sessionEpoch) return;
    allItems = allItems.map((item) => item.id === itemId ? saved : item);
    renderItems();
    if (currentItem?.id === itemId) { currentItem = saved; renderDetail(); }
    showToast(amount === null ? '已取消目标' : '小目标已记下');
  } catch (problem) {
    if (epoch !== sessionEpoch) return;
    error.textContent = problem.message;
    error.classList.remove('hidden');
  } finally { if (form.isConnected) form.querySelectorAll('button').forEach((button) => { button.disabled = false; }); }
}
function renderReview(insights) {
  const cards = insights.analysis_cards || [];
  const marks = { digital_share: '◒', warranty_due: '◷', warranty_expired: '◷', manual_idle: '○', inactive: '◴', unknown_use: '?', repair_leader: '↗', purchase_yoy: '↗' };
  $('#review-count').textContent = `${cards.length} 条发现`;
  $('#analysis-cards').innerHTML = cards.length ? cards.map((card, index) => `<article class="analysis-card" data-kind="${escapeHtml(card.kind)}"><div class="analysis-card-top"><span class="analysis-card-index">${String(index + 1).padStart(2, '0')} / ${escapeHtml(card.label)}</span><span class="analysis-card-mark" aria-hidden="true">${marks[card.kind] || '✳'}</span></div><h3>${escapeHtml(card.headline)}</h3><p>${escapeHtml(card.explanation)}</p>${card.items?.length ? `<div class="analysis-card-links">${card.items.map((item) => `<button type="button" class="analysis-item-link" data-open-item="${item.id}" aria-label="查看${escapeHtml(item.name)}的物品详情">${iconTile(item.icon_type, 'analysis-item-icon')}<span>${escapeHtml(item.name)}</span><span aria-hidden="true">↗</span></button>`).join('')}</div>` : ''}</article>`).join('')
    : `<div class="analysis-empty"><span aria-hidden="true">✳</span><h3>线索还在慢慢累积</h3><p>添加物品、填写保修日期或记下关键使用与维修记录后，这里会出现基于事实的观察。</p><button type="button" class="primary-btn" data-action="add-item">添加物品</button></div>`;
}
async function openItem(id) {
  const epoch = sessionEpoch;
  if (!$('#review-view').classList.contains('hidden')) detailReturnView = 'review';
  else if (!$('#items-view').classList.contains('hidden')) detailReturnView = 'items';
  const item = await api(`/api/items/${id}`);
  if (epoch !== sessionEpoch) return;
  currentItem = item;
  renderDetail();
  $('#back-btn').textContent = detailReturnView === 'review' ? '← 返回智能分析中心' : '← 返回物品清单';
  showView('detail');
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
function renderDetail() {
  const item = currentItem;
  if (!item) return;
  const preview = item.status === 'disposed' ? '' : `<section class="detail-section preview-section"><h3>处置前试算</h3><label class="preview-label" for="preview-proceeds">预计回收金额（元）</label><input id="preview-proceeds" type="number" min="0" max="999999999" step="0.01" inputmode="decimal" placeholder="例如 200.00"><div id="preview-result" class="preview-result" aria-live="polite">输入预计回收金额，查看处置后的净成本。</div><p class="hint">仅供参考，试算不会保存数据或改变物品状态。</p></section>`;
  $('#detail-content').innerHTML = `
    <div class="detail-hero">
      <div class="detail-top">${iconTile(item.icon_type, 'item-icon')}<div class="detail-main"><h2>${escapeHtml(item.name)} ${badge(item.status)}</h2><p>${escapeHtml(item.category)} · ${iconTypes[item.icon_type] || iconTypes.other} · 购买于 ${item.purchase_date}</p><p class="detail-warranty">保修到期：${item.warranty_expires_on || '未填写'}</p></div><div class="detail-actions"><button class="small-btn" data-action="edit-item">编辑物品</button><button class="small-btn danger" data-action="delete-item">删除物品</button></div></div>
      <div class="detail-metrics"><div><span>购买价格</span><strong>${yuan(item.purchase_price)}</strong></div><div><span>维修费用</span><strong>${yuan(item.maintenance_total)}</strong></div><div><span>累计净成本</span><strong>${yuan(item.net_cost)}</strong></div><div><span>${item.status === 'disposed' ? '曾持有' : '已持有'} · 使用记录 ${item.usage_count} 条</span><strong>${item.holding_days} 天</strong></div></div>
    </div>
    <div class="detail-grid"><div>${milestonesMarkup(item)}${targetMarkup(item)}<section class="detail-section"><div class="section-heading"><h3>生命周期时间线</h3></div>${timeline(item)}</section></div>
    <div><section class="detail-section cost-section"><h3>持有成本</h3><div class="daily-cost"><span>购买价/天</span><strong>${item.daily_purchase_cost === null ? '暂无' : yuan(item.daily_purchase_cost)}</strong></div><div class="daily-cost"><span>净成本/天</span><strong>${item.daily_net_cost === null ? '暂无' : yuan(item.daily_net_cost)}</strong></div><p class="note-text">${item.daily_net_cost === null ? '持有不足一天，暂不计算日均花费。' : `按 ${item.holding_days} 天持有时间计算。`}<br>净成本包含维修费用，并扣除处置回收金额。<br>最近一次记录的使用：${item.last_recorded_use || '未记录'}</p></section>
    ${preview}
    <section class="detail-section"><h3>记录操作</h3><div class="detail-actions"><button class="small-btn" data-action="add-usage" ${item.status === 'disposed' ? 'disabled' : ''}>＋ 使用记录</button><button class="small-btn" data-action="add-maintenance" ${item.status === 'disposed' ? 'disabled' : ''}>＋ 维修记录</button>${item.disposal ? '' : '<button class="small-btn" data-action="add-disposal">＋ 处置物品</button>'}</div></section>
    <section class="detail-section"><h3>物品备注</h3><div class="note-text">${item.notes ? escapeHtml(item.notes) : '暂无备注'}</div></section>
    <section class="detail-section"><h3>计算说明</h3><p class="note-text">净成本 = 购买价格 + 维修费用 − 处置回收金额。<br>持有天数从购买日算至${item.disposal ? '处置日' : '今天'}。</p></section></div></div>`;
  celebrateToday(item);
}

function updateDisposalPreview() {
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

const field = (name, label, type = 'text', opts = {}) => `<label class="field ${opts.wide ? 'wide' : ''}"><span>${label}${opts.required ? ' *' : ''}</span>${type === 'textarea' ? `<textarea name="${name}" maxlength="${opts.max || 1000}" ${opts.required ? 'required' : ''}></textarea>` : type === 'select' ? `<select name="${name}">${opts.options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select>` : `<input name="${name}" type="${type}" ${type === 'number' ? 'min="0" step="0.01"' : ''} ${type === 'date' && !opts.future ? `max="${todayLocal()}"` : ''} ${opts.max ? `maxlength="${opts.max}"` : ''} ${opts.required ? 'required' : ''}>`}</label>`;
function iconChoices() {
  return `<fieldset class="icon-choice-field"><legend>物品类型</legend><div class="icon-choice-grid">${Object.entries(iconTypes).map(([key, label]) => `<label class="icon-option"><input type="radio" name="icon_type" value="${key}" required><span class="icon-option-face">${iconMarkup(key)}<span>${label}</span></span></label>`).join('')}</div></fieldset>`;
}
function formMarkup(kind, editing) {
  if (kind === 'item') return field('name', '物品名称', 'text', { required: true, wide: true, max: 120 }) + iconChoices() + field('category', '分类', 'text', { required: true, max: 60 }) + field('purchase_date', '购买日期', 'date', { required: true }) + field('warranty_expires_on', '保修到期日（可选）', 'date', { future: true }) + field('purchase_price', '购买价格（元）', 'number', { required: true }) + field('status', '当前状态', 'select', { options: editing?.status === 'disposed' ? [['disposed', '已处置']] : [['active', '使用中'], ['idle', '闲置']] }) + field('notes', '备注', 'textarea', { wide: true });
  if (kind === 'usage') return field('used_on', '使用日期', 'date', { required: true }) + field('notes', '使用备注', 'textarea', { wide: true });
  if (kind === 'maintenance') return field('maintained_on', '维修日期', 'date', { required: true }) + field('cost', '维修费用（元）', 'number', { required: true }) + field('description', '维修说明', 'textarea', { required: true, wide: true, max: 500 });
  return field('disposed_on', '处置日期', 'date', { required: true }) + field('method', '处置方式', 'select', { options: Object.entries(methodNames) }) + field('proceeds', '回收金额（元）', 'number', { required: true }) + field('notes', '备注', 'textarea', { wide: true });
}
function openForm(kind, record = null) {
  formState = { kind, record };
  clearTimeout(toastTimer);
  $('#toast').classList.add('hidden');
  const titles = { item: '物品', usage: '使用记录', maintenance: '维修记录', disposal: '处置记录' };
  $('#dialog-title').textContent = `${record ? '编辑' : '添加'}${titles[kind]}`;
  $('#form-fields').innerHTML = formMarkup(kind, record);
  $('#form-error').classList.add('hidden');
  const form = $('#entity-form');
  const defaults = record || (kind === 'item' ? { status: 'active', icon_type: 'other' } : kind === 'disposal' ? { method: 'sold' } : {});
  for (const input of form.querySelectorAll('[name]')) {
    if (input.type === 'radio') input.checked = input.value === defaults[input.name];
    else if (defaults[input.name] != null) input.value = defaults[input.name];
    else if (input.type === 'date' && input.name !== 'warranty_expires_on') input.value = todayLocal();
  }
  $('#form-dialog').showModal();
}
async function saveForm(event) {
  event.preventDefault();
  const { kind, record } = formState;
  const epoch = sessionEpoch;
  const data = Object.fromEntries(new FormData($('#entity-form')).entries());
  let path, method;
  if (kind === 'item') { path = record ? `/api/items/${record.id}` : '/api/items'; method = record ? 'PUT' : 'POST'; }
  else if (kind === 'disposal') { path = record ? `/api/disposal/${record.id}` : `/api/items/${currentItem.id}/disposal`; method = record ? 'PUT' : 'POST'; }
  else { path = record ? `/api/${kind}/${record.id}` : `/api/items/${currentItem.id}/${kind}`; method = record ? 'PUT' : 'POST'; }
  const submit = $('#entity-form [type="submit"]');
  submit.disabled = true;
  let saved;
  try {
    saved = await api(path, { method, body: JSON.stringify(data) });
  } catch (error) {
    $('#form-error').textContent = error.message;
    $('#form-error').classList.remove('hidden');
    submit.disabled = false;
    return;
  }
  submit.disabled = false;
  if (epoch !== sessionEpoch) return;
  $('#form-dialog').close();
  if (kind === 'item') {
    allItems = record ? allItems.map((item) => item.id === saved.id ? saved : item) : [saved, ...allItems];
    currentItem = saved;
    renderItems();
    renderRecentItems();
    renderDetail();
    showView('detail');
  }
  try {
    if (kind !== 'item' && currentItem) await openItem(currentItem.id);
    await refreshAll();
    if (epoch !== sessionEpoch) return;
    showToast(kind === 'item' ? `保存成功 · 图标：${iconTypes[saved.icon_type] || iconTypes.other}` : '保存成功');
  } catch (error) {
    if (epoch !== sessionEpoch) return;
    showToast(`记录已保存，但部分页面刷新失败：${error.message}`, true);
  }
}
async function deleteRecord(type, id) {
  if (!confirm('确定删除这条记录吗？')) return;
  await run(async () => {
    await api(type === 'disposal' ? `/api/disposal/${id}` : `/api/${type}/${id}`, { method: 'DELETE' });
    await refreshAll();
    await openItem(currentItem.id);
  }, '记录已删除');
}
function getRecord(type, id) {
  if (type === 'disposal') return currentItem.disposal;
  return currentItem[`${type}_records`].find((record) => record.id === id);
}

document.addEventListener('click', async (event) => {
  const preset = event.target.closest('[data-goal-preset]');
  if (preset) { $('#goal-amount').value = preset.dataset.goalPreset; $('#goal-amount').focus(); return; }
  const nav = event.target.closest('[data-view]');
  if (nav) { if (nav.tagName === 'A') event.preventDefault(); showView(nav.dataset.view); return; }
  const open = event.target.closest('[data-open-item]');
  if (open) { await run(() => openItem(Number(open.dataset.openItem))); return; }
  const edit = event.target.closest('[data-edit-record]');
  if (edit) { const [type, rawId] = edit.dataset.editRecord.split(':'); openForm(type, getRecord(type, Number(rawId))); return; }
  const remove = event.target.closest('[data-delete-record]');
  if (remove) { const [type, rawId] = remove.dataset.deleteRecord.split(':'); await deleteRecord(type, Number(rawId)); return; }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'add-item') openForm('item');
  if (action === 'cancel-goal') await saveTarget(null);
  if (action === 'edit-item') openForm('item', currentItem);
  if (action === 'add-usage') openForm('usage');
  if (action === 'add-maintenance') openForm('maintenance');
  if (action === 'add-disposal') openForm('disposal');
  if (action === 'delete-item' && confirm('确定删除这个物品及其全部记录吗？')) await run(async () => { await api(`/api/items/${currentItem.id}`, { method: 'DELETE' }); currentItem = null; await refreshAll(); showView('items'); }, '物品已删除');
});
document.addEventListener('submit', (event) => {
  if (event.target.id === 'goal-form') { event.preventDefault(); saveTarget($('#goal-amount').value); }
  if (['avatar-form', 'username-form', 'password-form'].includes(event.target.id)) {
    event.preventDefault();
    saveAccountForm(event.target);
  }
});
async function saveAccountForm(form) {
  const errorBox = $(`#${form.id.replace('-form', '-error')}`);
  errorBox.classList.add('hidden');
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    if (form.id === 'avatar-form') {
      const avatar_key = new FormData(form).get('avatar_key');
      const result = await api('/api/account/avatar', { method: 'PUT', body: JSON.stringify({ avatar_key }) });
      setAccountUser(result.user);
      showToast('头像已更新');
    } else if (form.id === 'username-form') {
      const data = Object.fromEntries(new FormData(form));
      const result = await api('/api/account/username', { method: 'PUT', body: JSON.stringify(data) });
      setAccountUser(result.user);
      form.elements.current_password.value = '';
      showToast('用户名已更新');
    } else {
      const data = Object.fromEntries(new FormData(form));
      if (data.new_password !== data.confirm_password) throw new Error('两次输入的新密码不一致');
      await api('/api/account/password', { method: 'PUT', body: JSON.stringify({ current_password: data.current_password, new_password: data.new_password }) });
      clearAccount();
      location.replace('/login?password_changed=1');
    }
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.classList.remove('hidden');
  } finally {
    button.disabled = false;
  }
}
$('#avatar-reset').addEventListener('click', () => run(async () => {
  const result = await api('/api/account/avatar', { method: 'PUT', body: JSON.stringify({ avatar_key: null }) });
  setAccountUser(result.user);
}, '已恢复默认头像'));
document.addEventListener('keydown', (event) => {
  const card = event.target.closest('[data-open-item]');
  if (card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); run(() => openItem(Number(card.dataset.openItem))); }
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'preview-proceeds') updateDisposalPreview();
});
$('#add-item-btn').addEventListener('click', () => openForm('item'));
$('#back-btn').addEventListener('click', () => showView(detailReturnView));
$('#search-input').addEventListener('input', renderItems);
$('#status-filter').addEventListener('change', renderItems);
$('#entity-form').addEventListener('submit', saveForm);
$('#entity-form').addEventListener('click', (event) => {
  const option = event.target.closest('.icon-option');
  if (option) option.querySelector('input').checked = true;
});
$('#close-dialog').addEventListener('click', () => $('#form-dialog').close());
$('#cancel-dialog').addEventListener('click', () => $('#form-dialog').close());
$('#app-retry').addEventListener('click', bootstrap);
$('#logout-btn').addEventListener('click', () => run(async () => {
  await api('/api/auth/logout', { method: 'POST' });
  clearAccount();
  location.replace('/');
}));
window.addEventListener('pagehide', () => { clearAccount(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
bootstrap();

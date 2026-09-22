const $ = (selector) => document.querySelector(selector);
const statusNames = { active: '使用中', idle: '闲置', disposed: '已处置' };
const methodNames = { sold: '出售', gifted: '赠送', discarded: '丢弃', other: '其他' };
const iconTypes = { digital: '数码', home: '家居', daily: '日常用品', clothing: '衣物', books: '书籍文具', mobility: '出行', sports: '运动', tools: '工具', other: '其他' };
function iconMarkup(type) {
  const key = Object.prototype.hasOwnProperty.call(iconTypes, type) ? type : 'other';
  return `<svg class="type-icon" aria-hidden="true" focusable="false"><use href="/static/icons.svg#${key}"></use></svg>`;
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
let authMode = 'login';
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
      csrfToken = (await api('/api/auth/me')).csrf_token;
    }
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}
function setAuthMode(mode) {
  authMode = mode;
  const register = mode === 'register';
  $('#auth-title').textContent = register ? '建立档案' : '登录档案';
  $('#auth-subtitle').textContent = register ? '创建账号后，就能开始记录自己的物品。' : '输入用户名和密码，继续查看你的物品。';
  $('#confirm-field').classList.toggle('hidden', !register);
  $('#confirm-field input').required = register;
  $('#auth-form [name="password"]').autocomplete = register ? 'new-password' : 'current-password';
  $('#auth-submit').textContent = register ? '注册并进入' : '登录';
  $('#auth-switch-text').textContent = register ? '已有账号？' : '还没有账号？';
  $('#auth-toggle').textContent = register ? '返回登录 ↗' : '注册新账号 ↗';
  $('#auth-error').classList.add('hidden');
  $('#auth-form').reset();
}
function showAuth() {
  sessionEpoch++;
  if ($('#form-dialog').open) $('#form-dialog').close();
  allItems = [];
  currentItem = null;
  formState = null;
  $('#search-input').value = '';
  $('#status-filter').value = 'all';
  for (const selector of ['#items-list', '#detail-content', '#recent-items', '#stats-grid', '#category-chart', '#status-chart', '#monthly-chart', '#review-items', '#unknown-items']) $(selector).replaceChildren();
  $('#account-name').textContent = '';
  $('#app-shell').classList.add('hidden');
  $('#auth-screen').classList.remove('hidden');
  setAuthMode('login');
}
async function showApp(user) {
  sessionEpoch++;
  $('#account-name').textContent = user.username;
  $('#auth-screen').classList.add('hidden');
  $('#app-shell').classList.remove('hidden');
  showView('items');
  try { await refreshAll(); }
  catch (error) { showToast(`部分数据加载失败：${error.message}`, true); }
}
async function submitAuth(event) {
  event.preventDefault();
  const form = $('#auth-form');
  const data = Object.fromEntries(new FormData(form).entries());
  const error = $('#auth-error');
  error.classList.add('hidden');
  if (authMode === 'register' && data.password !== data.confirm_password) {
    error.textContent = '两次输入的密码不一致';
    error.classList.remove('hidden');
    return;
  }
  const submit = $('#auth-submit');
  submit.disabled = true;
  try {
    const result = await api(`/api/auth/${authMode === 'register' ? 'register' : 'login'}`, {
      method: 'POST', body: JSON.stringify({ username: data.username.trim(), password: data.password }),
    });
    csrfToken = result.csrf_token;
    form.reset();
    await showApp(result.user);
  } catch (problem) {
    error.textContent = problem.message;
    error.classList.remove('hidden');
  } finally { submit.disabled = false; }
}
async function bootstrap() {
  try {
    const state = await api('/api/auth/me');
    csrfToken = state.csrf_token;
    if (state.user) await showApp(state.user);
    else showAuth();
  } catch (error) {
    showAuth();
    showToast(error.message, true);
  }
}
async function run(action, successMessage) {
  try { await action(); if (successMessage) showToast(successMessage); }
  catch (error) { showToast(error.message, true); }
}
function showView(name) {
  for (const view of document.querySelectorAll('.view')) view.classList.toggle('hidden', view.id !== `${name}-view`);
  for (const link of document.querySelectorAll('.nav-link')) link.classList.toggle('active', link.dataset.view === name);
  $('#page-title').textContent = ({ dashboard: '数据概览', items: '我的物品', review: '待复盘', detail: '物品详情' })[name];
  $('#section-number').textContent = ({ items: '01', dashboard: '02', review: '03', detail: '01' })[name];
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
  $('#recent-items').innerHTML = allItems.length ? allItems.slice(0, 4).map((item) => `<div class="mini-item"><span class="mini-icon">${iconMarkup(item.icon_type)}</span><div class="mini-main"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category)} · ${iconTypes[item.icon_type] || iconTypes.other} · ${item.purchase_date}</small></div>${badge(item.status)}<span class="mini-price">${yuan(item.purchase_price)}</span></div>`).join('') : empty('还没有物品', '点击右上角“添加物品”开始记录。');
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
      <div class="item-card-head"><span class="item-icon">${iconMarkup(item.icon_type)}</span><div class="item-main"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category)} · ${iconTypes[item.icon_type] || iconTypes.other}</small></div><div class="item-status">${badge(item.status)}</div></div>
      <div class="item-purchase">购于 ${item.purchase_date}</div>
      <div class="item-card-metrics"><div><span>${item.status === 'disposed' ? '曾持有' : '已持有'}</span><strong>${item.holding_days} 天</strong></div><div><span>购买价/天</span><strong>${item.daily_purchase_cost === null ? '暂无' : yuan(item.daily_purchase_cost)}</strong></div><div><span>净成本/天</span><strong>${item.daily_net_cost === null ? '暂无' : yuan(item.daily_net_cost)}</strong></div></div>
      <div class="item-card-foot"><span>累计净成本</span><strong>${yuan(item.net_cost)}</strong><span class="item-card-arrow" aria-hidden="true">↗</span></div>
    </article>`).join('') : empty('没有找到物品', '可以调整搜索词或状态筛选。');
}
function reviewRow(item, reason) {
  const description = reason === 'manual_idle' ? '已手动标记闲置' : reason === 'no_recent_record'
    ? `距最近一次记录的使用 ${item.days_since_last_recorded_use} 天` : '尚无使用记录，请按实际情况核对';
  return `<article class="review-item" data-open-item="${item.id}" tabindex="0" role="button" aria-label="查看${escapeHtml(item.name)}"><span class="review-icon">${iconMarkup(item.icon_type)}</span><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category)} · ${iconTypes[item.icon_type] || iconTypes.other} · ${description}</small></div><div class="review-cost"><span>累计净成本</span><strong>${yuan(item.net_cost)}</strong></div><span class="review-arrow" aria-hidden="true">↗</span></article>`;
}
function renderReview(insights) {
  $('#review-count').textContent = `${insights.review_items.length} 件待核对`;
  $('#review-items').innerHTML = insights.review_items.length
    ? insights.review_items.map((item) => reviewRow(item, item.review_reason)).join('')
    : empty('目前没有待复盘物品', '手动标记闲置，或录入关键使用记录后，这里会给出核对线索。');
  $('#unknown-items').innerHTML = insights.unknown_usage_items.length
    ? insights.unknown_usage_items.map((item) => reviewRow(item, 'unknown')).join('')
    : empty('没有记录缺口', '使用中的物品都已有至少一条使用记录。');
}
async function openItem(id) {
  const epoch = sessionEpoch;
  if (!$('#review-view').classList.contains('hidden')) detailReturnView = 'review';
  else if (!$('#items-view').classList.contains('hidden')) detailReturnView = 'items';
  const item = await api(`/api/items/${id}`);
  if (epoch !== sessionEpoch) return;
  currentItem = item;
  renderDetail();
  $('#back-btn').textContent = detailReturnView === 'review' ? '← 返回待复盘' : '← 返回物品清单';
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
      <div class="detail-top"><span class="item-icon">${iconMarkup(item.icon_type)}</span><div class="detail-main"><h2>${escapeHtml(item.name)} ${badge(item.status)}</h2><p>${escapeHtml(item.category)} · ${iconTypes[item.icon_type] || iconTypes.other} · 购买于 ${item.purchase_date}</p></div><div class="detail-actions"><button class="small-btn" data-action="edit-item">编辑物品</button><button class="small-btn danger" data-action="delete-item">删除物品</button></div></div>
      <div class="detail-metrics"><div><span>购买价格</span><strong>${yuan(item.purchase_price)}</strong></div><div><span>维修费用</span><strong>${yuan(item.maintenance_total)}</strong></div><div><span>累计净成本</span><strong>${yuan(item.net_cost)}</strong></div><div><span>${item.status === 'disposed' ? '曾持有' : '已持有'} · 使用记录 ${item.usage_count} 条</span><strong>${item.holding_days} 天</strong></div></div>
    </div>
    <div class="detail-grid"><div><section class="detail-section"><div class="section-heading"><h3>生命周期时间线</h3></div>${timeline(item)}</section></div>
    <div><section class="detail-section cost-section"><h3>持有成本</h3><div class="daily-cost"><span>购买价/天</span><strong>${item.daily_purchase_cost === null ? '暂无' : yuan(item.daily_purchase_cost)}</strong></div><div class="daily-cost"><span>净成本/天</span><strong>${item.daily_net_cost === null ? '暂无' : yuan(item.daily_net_cost)}</strong></div><p class="note-text">${item.daily_net_cost === null ? '持有不足一天，暂不计算日均花费。' : `按 ${item.holding_days} 天持有时间计算。`}<br>净成本包含维修费用，并扣除处置回收金额。<br>最近一次记录的使用：${item.last_recorded_use || '未记录'}</p></section>
    ${preview}
    <section class="detail-section"><h3>记录操作</h3><div class="detail-actions"><button class="small-btn" data-action="add-usage" ${item.status === 'disposed' ? 'disabled' : ''}>＋ 使用记录</button><button class="small-btn" data-action="add-maintenance" ${item.status === 'disposed' ? 'disabled' : ''}>＋ 维修记录</button>${item.disposal ? '' : '<button class="small-btn" data-action="add-disposal">＋ 处置物品</button>'}</div></section>
    <section class="detail-section"><h3>物品备注</h3><div class="note-text">${item.notes ? escapeHtml(item.notes) : '暂无备注'}</div></section>
    <section class="detail-section"><h3>计算说明</h3><p class="note-text">净成本 = 购买价格 + 维修费用 − 处置回收金额。<br>持有天数从购买日算至${item.disposal ? '处置日' : '今天'}。</p></section></div></div>`;
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

const field = (name, label, type = 'text', opts = {}) => `<label class="field ${opts.wide ? 'wide' : ''}"><span>${label}${opts.required ? ' *' : ''}</span>${type === 'textarea' ? `<textarea name="${name}" maxlength="${opts.max || 1000}" ${opts.required ? 'required' : ''}></textarea>` : type === 'select' ? `<select name="${name}">${opts.options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select>` : `<input name="${name}" type="${type}" ${type === 'number' ? 'min="0" step="0.01"' : ''} ${type === 'date' ? `max="${todayLocal()}"` : ''} ${opts.max ? `maxlength="${opts.max}"` : ''} ${opts.required ? 'required' : ''}>`}</label>`;
function iconChoices() {
  return `<fieldset class="icon-choice-field"><legend>物品类型</legend><div class="icon-choice-grid">${Object.entries(iconTypes).map(([key, label]) => `<label class="icon-option"><input type="radio" name="icon_type" value="${key}" required><span class="icon-option-face">${iconMarkup(key)}<span>${label}</span></span></label>`).join('')}</div></fieldset>`;
}
function formMarkup(kind, editing) {
  if (kind === 'item') return field('name', '物品名称', 'text', { required: true, wide: true, max: 120 }) + iconChoices() + field('category', '分类', 'text', { required: true, max: 60 }) + field('purchase_date', '购买日期', 'date', { required: true }) + field('purchase_price', '购买价格（元）', 'number', { required: true }) + field('status', '当前状态', 'select', { options: editing?.status === 'disposed' ? [['disposed', '已处置']] : [['active', '使用中'], ['idle', '闲置']] }) + field('notes', '备注', 'textarea', { wide: true });
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
    else if (input.type === 'date') input.value = todayLocal();
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
  if (action === 'edit-item') openForm('item', currentItem);
  if (action === 'add-usage') openForm('usage');
  if (action === 'add-maintenance') openForm('maintenance');
  if (action === 'add-disposal') openForm('disposal');
  if (action === 'delete-item' && confirm('确定删除这个物品及其全部记录吗？')) await run(async () => { await api(`/api/items/${currentItem.id}`, { method: 'DELETE' }); currentItem = null; await refreshAll(); showView('items'); }, '物品已删除');
});
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
$('#auth-form').addEventListener('submit', submitAuth);
$('#auth-toggle').addEventListener('click', () => setAuthMode(authMode === 'login' ? 'register' : 'login'));
$('#logout-btn').addEventListener('click', () => run(async () => {
  await api('/api/auth/logout', { method: 'POST' });
  showAuth();
  csrfToken = (await api('/api/auth/me')).csrf_token;
}));
bootstrap();

const $ = (selector) => document.querySelector(selector);
const statusNames = { active: '使用中', idle: '闲置', disposed: '已处置' };
const methodNames = { sold: '出售', gifted: '赠送', discarded: '丢弃', other: '其他' };
const todayLocal = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
let allItems = [];
let currentItem = null;
let formState = null;
let toastTimer;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function yuan(value) { return `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function showToast(message, error = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}
async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try { message = (await response.json()).error || message; } catch (_) { /* response has no JSON */ }
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}
async function run(action, successMessage) {
  try { await action(); if (successMessage) showToast(successMessage); }
  catch (error) { showToast(error.message, true); }
}
function showView(name) {
  for (const view of document.querySelectorAll('.view')) view.classList.toggle('hidden', view.id !== `${name}-view`);
  for (const link of document.querySelectorAll('.nav-link')) link.classList.toggle('active', link.dataset.view === name);
  $('#page-title').textContent = ({ dashboard: '数据概览', items: '我的物品', detail: '物品详情' })[name];
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function badge(status) { return `<span class="badge ${escapeHtml(status)}">${statusNames[status]}</span>`; }
function empty(title, subtitle = '') { return `<div class="empty"><strong>${title}</strong>${subtitle}</div>`; }

async function refreshAll() {
  const [items, stats] = await Promise.all([api('/api/items'), api('/api/stats')]);
  allItems = items;
  renderDashboard(stats);
  renderItems();
}
function renderDashboard(stats) {
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
  $('#recent-items').innerHTML = allItems.length ? allItems.slice(0, 4).map((item) => `<div class="mini-item"><div class="mini-icon">▣</div><div class="mini-main"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category)} · ${item.purchase_date}</small></div>${badge(item.status)}<span class="mini-price">${yuan(item.purchase_price)}</span></div>`).join('') : empty('还没有物品', '点击右上角“添加物品”开始记录。');
}
function renderItems() {
  const keyword = $('#search-input').value.trim().toLocaleLowerCase();
  const status = $('#status-filter').value;
  const filtered = allItems.filter((item) => (status === 'all' || item.status === status) && (`${item.name} ${item.category}`).toLocaleLowerCase().includes(keyword));
  $('#item-count').textContent = `${filtered.length} 件物品`;
  $('#items-list').innerHTML = filtered.length ? filtered.map((item) => `<article class="item-card" data-open-item="${item.id}" tabindex="0" role="button" aria-label="查看${escapeHtml(item.name)}"><div class="item-icon">▣</div><div class="item-main"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category)} · 购买于 ${item.purchase_date}</small></div>${badge(item.status)}<div class="item-cost">${yuan(item.net_cost)}<small>累计净成本</small></div></article>`).join('') : empty('没有找到物品', '可以调整搜索词或状态筛选。');
}
async function openItem(id) {
  currentItem = await api(`/api/items/${id}`);
  renderDetail();
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
  $('#detail-content').innerHTML = `<div class="detail-hero"><div class="detail-top"><div class="item-icon">▣</div><div class="detail-main"><h2>${escapeHtml(item.name)} ${badge(item.status)}</h2><p>${escapeHtml(item.category)} · 购买于 ${item.purchase_date}</p></div><div class="detail-actions"><button class="small-btn" data-action="edit-item">编辑物品</button><button class="small-btn danger" data-action="delete-item">删除物品</button></div></div><div class="detail-metrics"><div><span>购买价格</span><strong>${yuan(item.purchase_price)}</strong></div><div><span>维修费用</span><strong>${yuan(item.maintenance_total)}</strong></div><div><span>累计净成本</span><strong>${yuan(item.net_cost)}</strong></div><div><span>持有天数 · 使用 ${item.usage_count} 次</span><strong>${item.holding_days} 天</strong></div></div></div><div class="detail-grid"><div><section class="detail-section"><div class="section-heading"><h3>生命周期时间线</h3></div>${timeline(item)}</section></div><div><section class="detail-section"><h3>记录操作</h3><div class="detail-actions"><button class="small-btn" data-action="add-usage" ${item.status === 'disposed' ? 'disabled' : ''}>＋ 使用记录</button><button class="small-btn" data-action="add-maintenance" ${item.status === 'disposed' ? 'disabled' : ''}>＋ 维修记录</button>${item.disposal ? '' : '<button class="small-btn" data-action="add-disposal">＋ 处置物品</button>'}</div></section><section class="detail-section"><h3>物品备注</h3><div class="note-text">${item.notes ? escapeHtml(item.notes) : '暂无备注'}</div></section><section class="detail-section"><h3>计算说明</h3><p class="note-text">净成本 = 购买价格 + 维修费用 − 处置回收金额。<br>持有天数从购买日算至${item.disposal ? '处置日' : '今天'}。</p></section></div></div>`;
}

const field = (name, label, type = 'text', opts = {}) => `<label class="field ${opts.wide ? 'wide' : ''}"><span>${label}${opts.required ? ' *' : ''}</span>${type === 'textarea' ? `<textarea name="${name}" maxlength="${opts.max || 1000}" ${opts.required ? 'required' : ''}></textarea>` : type === 'select' ? `<select name="${name}">${opts.options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select>` : `<input name="${name}" type="${type}" ${type === 'number' ? 'min="0" step="0.01"' : ''} ${type === 'date' ? `max="${todayLocal()}"` : ''} ${opts.max ? `maxlength="${opts.max}"` : ''} ${opts.required ? 'required' : ''}>`}</label>`;
function formMarkup(kind, editing) {
  if (kind === 'item') return field('name', '物品名称', 'text', { required: true, wide: true, max: 120 }) + field('category', '分类', 'text', { required: true, max: 60 }) + field('purchase_date', '购买日期', 'date', { required: true }) + field('purchase_price', '购买价格（元）', 'number', { required: true }) + field('status', '当前状态', 'select', { options: editing?.status === 'disposed' ? [['disposed', '已处置']] : [['active', '使用中'], ['idle', '闲置']] }) + field('notes', '备注', 'textarea', { wide: true });
  if (kind === 'usage') return field('used_on', '使用日期', 'date', { required: true }) + field('notes', '使用备注', 'textarea', { wide: true });
  if (kind === 'maintenance') return field('maintained_on', '维修日期', 'date', { required: true }) + field('cost', '维修费用（元）', 'number', { required: true }) + field('description', '维修说明', 'textarea', { required: true, wide: true, max: 500 });
  return field('disposed_on', '处置日期', 'date', { required: true }) + field('method', '处置方式', 'select', { options: Object.entries(methodNames) }) + field('proceeds', '回收金额（元）', 'number', { required: true }) + field('notes', '备注', 'textarea', { wide: true });
}
function openForm(kind, record = null) {
  formState = { kind, record };
  const titles = { item: '物品', usage: '使用记录', maintenance: '维修记录', disposal: '处置记录' };
  $('#dialog-title').textContent = `${record ? '编辑' : '添加'}${titles[kind]}`;
  $('#form-fields').innerHTML = formMarkup(kind, record);
  $('#form-error').classList.add('hidden');
  const form = $('#entity-form');
  const defaults = record || (kind === 'item' ? { status: 'active' } : kind === 'disposal' ? { method: 'sold' } : {});
  for (const input of form.querySelectorAll('[name]')) {
    if (defaults[input.name] != null) input.value = defaults[input.name];
    else if (input.type === 'date') input.value = todayLocal();
  }
  $('#form-dialog').showModal();
}
async function saveForm(event) {
  event.preventDefault();
  const { kind, record } = formState;
  const data = Object.fromEntries(new FormData($('#entity-form')).entries());
  let path, method;
  if (kind === 'item') { path = record ? `/api/items/${record.id}` : '/api/items'; method = record ? 'PUT' : 'POST'; }
  else if (kind === 'disposal') { path = record ? `/api/disposal/${record.id}` : `/api/items/${currentItem.id}/disposal`; method = record ? 'PUT' : 'POST'; }
  else { path = record ? `/api/${kind}/${record.id}` : `/api/items/${currentItem.id}/${kind}`; method = record ? 'PUT' : 'POST'; }
  const submit = $('#entity-form [type="submit"]');
  submit.disabled = true;
  try {
    const saved = await api(path, { method, body: JSON.stringify(data) });
    $('#form-dialog').close();
    await refreshAll();
    if (kind === 'item' && !record) await openItem(saved.id);
    else if (currentItem) await openItem(currentItem.id);
    showToast('保存成功');
  } catch (error) {
    $('#form-error').textContent = error.message;
    $('#form-error').classList.remove('hidden');
  } finally { submit.disabled = false; }
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
  if (nav) { showView(nav.dataset.view); return; }
  const open = event.target.closest('[data-open-item]');
  if (open) { await run(() => openItem(Number(open.dataset.openItem))); return; }
  const edit = event.target.closest('[data-edit-record]');
  if (edit) { const [type, rawId] = edit.dataset.editRecord.split(':'); openForm(type, getRecord(type, Number(rawId))); return; }
  const remove = event.target.closest('[data-delete-record]');
  if (remove) { const [type, rawId] = remove.dataset.deleteRecord.split(':'); await deleteRecord(type, Number(rawId)); return; }
  const action = event.target.closest('[data-action]')?.dataset.action;
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
$('#add-item-btn').addEventListener('click', () => openForm('item'));
$('#back-btn').addEventListener('click', () => showView('items'));
$('#search-input').addEventListener('input', renderItems);
$('#status-filter').addEventListener('change', renderItems);
$('#entity-form').addEventListener('submit', saveForm);
$('#close-dialog').addEventListener('click', () => $('#form-dialog').close());
$('#cancel-dialog').addEventListener('click', () => $('#form-dialog').close());
run(refreshAll);

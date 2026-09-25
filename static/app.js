import { $, todayLocal, escapeHtml } from './js/common.mjs';
import { showToast, showToastAction, resetToast } from './js/feedback.mjs';
import { renderAccountUser, saveAccountForm, resetAvatar } from './js/account.mjs';
import { renderItems } from './js/items.mjs';
import { renderDashboard } from './js/dashboard.mjs';
import { renderReview } from './js/analysis.mjs';
import { renderDetail, updateDisposalPreview } from './js/detail.mjs';
import { openForm, resetFormState, releasePhotoPreview, handlePhotoInput, submitEntityForm } from './js/forms.mjs';
import { configureApi, api } from './js/api.mjs';
import { createDataStore } from './js/data-store.mjs';

let allItems = [];
let currentItem = null;
let detailReturnView = 'items';
let csrfToken = null;
let currentUser = null;
let sessionEpoch = 0;
let navigationSequence = 0;
let loadSequence = 0;
let activeView = 'items';
let dataDate = todayLocal();
let lastFocusRefresh = 0;
const dataStore = createDataStore((key, signal) => api(key.startsWith('item:') ? `/api/items/${key.slice(5)}` : `/api/${key}`, { signal }));

configureApi({
  session: () => ({ csrfToken, user: currentUser }),
  expired: () => showAuth(),
  token: (value) => { csrfToken = value; },
});

function setAccountUser(user) {
  currentUser = user;
  renderAccountUser(user);
}

function clearAccount() {
  sessionEpoch++;
  navigationSequence++;
  loadSequence++;
  dataStore.clear();
  if ($('#form-dialog').open) $('#form-dialog').close();
  allItems = [];
  currentItem = null;
  currentUser = null;
  resetFormState();
  csrfToken = null;
  $('#search-input').value = '';
  $('#status-filter').value = 'all';
  $('#sort-order').value = 'newest';
  for (const selector of ['#items-list', '#detail-content', '#recent-items', '#stats-grid', '#category-chart', '#status-chart', '#monthly-chart', '#analysis-cards']) $(selector).replaceChildren();
  $('#account-name').textContent = '';
  $('#username-form').reset();
  $('#password-form').reset();
  $('#item-count').textContent = '';
  $('#review-count').textContent = '';
  resetToast();
  $('#app-shell').classList.add('hidden');
}
function showAuth() {
  clearAccount();
  location.replace('/login?expired=1');
}
async function showApp(user) {
  sessionEpoch++;
  dataStore.clear();
  dataDate = todayLocal();
  setAccountUser(user);
  $('#app-loading').classList.add('hidden');
  $('#app-shell').classList.remove('hidden');
  showView('items');
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
  const epoch = sessionEpoch;
  try { await action(); if (successMessage && epoch === sessionEpoch) showToast(successMessage); }
  catch (error) { if (error.name !== 'AbortError' && epoch === sessionEpoch) showToast(error.message, true); }
}
function showView(name) {
  activeView = name;
  navigationSequence++;
  if (name === 'account' && currentUser) setAccountUser(currentUser);
  for (const view of document.querySelectorAll('.view')) view.classList.toggle('hidden', view.id !== `${name}-view`);
  for (const link of document.querySelectorAll('.nav-link')) link.classList.toggle('active', link.dataset.view === name);
  $('#page-title').textContent = ({ dashboard: '数据概览', items: '我的物品', review: '智能分析中心', detail: '物品详情', account: '个人设置' })[name];
  $('#section-number').textContent = ({ items: '01', dashboard: '02', review: '03', detail: '01', account: '04' })[name];
  $('#add-item-btn').classList.toggle('hidden', name === 'account');
  window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  void loadView(name, navigationSequence);
}

function viewMessage(selector, message, retry = false) {
  $(selector).innerHTML = `<div class="load-state" role="status"><p>${escapeHtml(message)}</p>${retry ? '<button type="button" class="secondary-btn" data-retry-view>重新加载</button>' : ''}</div>`;
}

function checkDate() {
  const today = todayLocal();
  if (today !== dataDate) { dataDate = today; dataStore.invalidateAll(); }
}

async function loadView(name = activeView, navigation = navigationSequence) {
  checkDate();
  const epoch = sessionEpoch;
  const load = ++loadSequence;
  const current = () => epoch === sessionEpoch && navigation === navigationSequence && load === loadSequence && name === activeView;
  if (name === 'account' || name === 'detail') return;
  if (name === 'items' && !dataStore.isFresh('items')) {
    $('#item-count').textContent = '加载中';
    viewMessage('#items-list', '正在整理物品档案…');
  }
  if (name === 'dashboard' && !['items', 'stats', 'insights'].every((key) => dataStore.isFresh(key))) {
    viewMessage('#stats-grid', '正在整理数据概览…');
    for (const selector of ['#category-chart', '#status-chart', '#monthly-chart', '#recent-items']) $(selector).replaceChildren();
  }
  if (name === 'review' && !dataStore.isFresh('insights')) viewMessage('#analysis-cards', '正在查找值得留意的线索…');
  try {
    if (name === 'items') {
      const items = await dataStore.load('items');
      if (!current()) return;
      allItems = items;
      renderItems(allItems);
    } else if (name === 'dashboard') {
      const [items, stats, insights] = await Promise.all([
        dataStore.load('items'), dataStore.load('stats'), dataStore.load('insights'),
      ]);
      if (!current()) return;
      allItems = items;
      renderDashboard(stats, insights, allItems);
    } else if (name === 'review') {
      const insights = await dataStore.load('insights');
      if (!current()) return;
      renderReview(insights);
    }
  } catch (error) {
    if (!current() || error.name === 'AbortError') return;
    const selector = { items: '#items-list', dashboard: '#stats-grid', review: '#analysis-cards' }[name];
    if (name === 'items') $('#item-count').textContent = '暂不可用';
    viewMessage(selector, `加载失败：${error.message}`, true);
  }
}

function invalidateData(kind, itemId) {
  const keys = ['items'];
  if (itemId) keys.push(`item:${itemId}`);
  if (kind === 'full') keys.push('stats', 'insights');
  if (kind === 'usage') keys.push('insights');
  dataStore.invalidate(keys);
}

async function refreshVisible() {
  if (activeView !== 'detail') return loadView(activeView, navigationSequence);
  if (!currentItem) return;
  const itemId = currentItem.id;
  const epoch = sessionEpoch;
  const navigation = navigationSequence;
  const load = ++loadSequence;
  viewMessage('#detail-content', '正在更新物品详情…');
  try {
    const item = await dataStore.load(`item:${itemId}`);
    if (epoch !== sessionEpoch || navigation !== navigationSequence || load !== loadSequence || activeView !== 'detail' || currentItem?.id !== itemId) return;
    currentItem = item;
    renderDetail(currentItem, currentUser);
  } catch (error) {
    if (epoch === sessionEpoch && navigation === navigationSequence && load === loadSequence && error.name !== 'AbortError') {
      viewMessage('#detail-content', `加载失败：${error.message}`, true);
    }
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
    dataStore.invalidate(['items']);
    dataStore.set(`item:${itemId}`, saved);
    if (currentItem?.id === itemId) { currentItem = saved; if (activeView === 'detail') renderDetail(currentItem, currentUser); }
    showToast(amount === null ? '已取消目标' : '小目标已记下');
  } catch (problem) {
    if (epoch !== sessionEpoch) return;
    error.textContent = problem.message;
    error.classList.remove('hidden');
  } finally { if (form.isConnected) form.querySelectorAll('button').forEach((button) => { button.disabled = false; }); }
}
async function openItem(id) {
  const epoch = sessionEpoch;
  const navigation = ++navigationSequence;
  const origin = activeView === 'review' ? 'review' : 'items';
  showToast('正在打开物品详情…');
  let item;
  try { item = await dataStore.load(`item:${id}`); }
  catch (error) {
    if (epoch === sessionEpoch && navigation === navigationSequence && error.name !== 'AbortError') {
      void loadView(activeView, navigationSequence);
      throw error;
    }
    return;
  }
  if (epoch !== sessionEpoch || navigation !== navigationSequence || item !== dataStore.peek(`item:${id}`)) return;
  detailReturnView = origin;
  currentItem = item;
  renderDetail(currentItem, currentUser);
  $('#back-btn').textContent = detailReturnView === 'review' ? '← 返回智能分析中心' : '← 返回物品清单';
  resetToast();
  showView('detail');
}
async function saveForm(event) {
  const epoch = sessionEpoch;
  const navigation = navigationSequence;
  const result = await submitEntityForm(event, { api, itemId: currentItem?.id, isCurrent: () => epoch === sessionEpoch });
  if (!result || epoch !== sessionEpoch) return;
  const { kind, record, saved, photoError, relatedItemId } = result;
  invalidateData(kind === 'usage' ? 'usage' : 'full', relatedItemId);
  if (kind === 'item') {
    dataStore.set(`item:${saved.id}`, saved);
    if (navigation === navigationSequence || currentItem?.id === saved.id) currentItem = saved;
  }
  if (kind === 'item' && navigation === navigationSequence) {
    renderDetail(currentItem, currentUser);
    if (!record) detailReturnView = 'items';
    $('#back-btn').textContent = detailReturnView === 'review' ? '← 返回智能分析中心' : '← 返回物品清单';
    showView('detail');
  } else {
    await refreshVisible();
  }
  if (epoch !== sessionEpoch) return;
  showToast(photoError ? `物品已保存，照片处理失败：${photoError}` : kind === 'item' ? '物品已保存' : '保存成功', Boolean(photoError));
}
async function deleteRecord(type, id) {
  if (!confirm('确定删除这条记录吗？')) return;
  await run(async () => {
    const itemId = currentItem.id;
    const epoch = sessionEpoch;
    await api(type === 'disposal' ? `/api/disposal/${id}` : `/api/${type}/${id}`, { method: 'DELETE' });
    if (epoch !== sessionEpoch) return;
    invalidateData(type === 'usage' ? 'usage' : 'full', itemId);
    await refreshVisible();
  }, '记录已删除');
}
function getRecord(type, id) {
  if (type === 'disposal') return currentItem.disposal;
  return currentItem[`${type}_records`].find((record) => record.id === id);
}

document.addEventListener('click', async (event) => {
  const preset = event.target.closest('[data-goal-preset]');
  if (preset) { $('#goal-amount').value = preset.dataset.goalPreset; $('#goal-amount').focus(); return; }
  const quick = event.target.closest('[data-quick-use]');
  if (quick) {
    quick.disabled = true;
    const epoch = sessionEpoch;
    try {
      const itemId = Number(quick.dataset.quickUse);
      const result = await api(`/api/items/${itemId}/usage/today`, { method: 'POST' });
      if (epoch !== sessionEpoch) return;
      invalidateData('usage', itemId);
      await refreshVisible();
      if (epoch !== sessionEpoch) return;
      showToastAction(result.created ? '今天的使用已记下' : '今天已有使用记录', '补充备注', itemId, result.record.id);
    } catch (error) { if (epoch === sessionEpoch) { quick.disabled = false; showToast(error.message, true); } }
    return;
  }
  const pin = event.target.closest('[data-pin-item]');
  if (pin) {
    pin.disabled = true;
    const epoch = sessionEpoch;
    try {
      const item = allItems.find((entry) => entry.id === Number(pin.dataset.pinItem));
      const saved = await api(`/api/items/${item.id}/pin`, { method: 'PUT', body: JSON.stringify({ is_pinned: !item.is_pinned }) });
      if (epoch !== sessionEpoch) return;
      allItems = allItems.map((entry) => entry.id === saved.id ? saved : entry);
      dataStore.set('items', allItems);
      dataStore.invalidate([`item:${saved.id}`]);
      if (activeView === 'items') renderItems(allItems);
      showToast(saved.is_pinned ? '已置顶' : '已取消置顶');
    } catch (error) { if (epoch === sessionEpoch) { pin.disabled = false; showToast(error.message, true); } }
    return;
  }
  const editToday = event.target.closest('[data-edit-today]');
  if (editToday) {
    const [itemId, recordId] = editToday.dataset.editToday.split(':').map(Number);
    await run(async () => {
      await openItem(itemId);
      const record = currentItem?.usage_records.find((entry) => entry.id === recordId);
      if (record) openForm('usage', record);
    });
    return;
  }
  const nav = event.target.closest('[data-view]');
  if (nav) { if (nav.tagName === 'A') event.preventDefault(); showView(nav.dataset.view); return; }
  if (event.target.closest('[data-retry-view]')) { await refreshVisible(); return; }
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
  if (action === 'remove-photo' && currentItem?.photo_url && confirm('确定删除这张物品照片吗？')) await run(async () => {
    const itemId = currentItem.id;
    const epoch = sessionEpoch;
    await api(`/api/items/${itemId}/photo`, { method: 'DELETE' });
    if (epoch !== sessionEpoch) return;
    invalidateData('photo', itemId);
    await refreshVisible();
  }, '照片已删除');
  if (action === 'delete-item' && confirm('确定删除这个物品及其全部记录吗？')) await run(async () => {
    const itemId = currentItem.id;
    const navigation = navigationSequence;
    const epoch = sessionEpoch;
    await api(`/api/items/${itemId}`, { method: 'DELETE' });
    if (epoch !== sessionEpoch) return;
    invalidateData('full', itemId);
    if (currentItem?.id === itemId) currentItem = null;
    if (navigation === navigationSequence) showView('items');
    else await refreshVisible();
  }, '物品已删除');
});
document.addEventListener('submit', (event) => {
  if (event.target.id === 'goal-form') { event.preventDefault(); saveTarget($('#goal-amount').value); }
  if (['avatar-form', 'username-form', 'password-form'].includes(event.target.id)) {
    event.preventDefault();
    const epoch = sessionEpoch;
    void saveAccountForm(event.target, {
      api,
      setUser: setAccountUser,
      isCurrent: () => epoch === sessionEpoch,
      passwordChanged: () => { clearAccount(); location.replace('/login?password_changed=1'); },
    });
  }
});
$('#avatar-reset').addEventListener('click', () => run(async () => {
  const epoch = sessionEpoch;
  await resetAvatar({ api, setUser: setAccountUser, isCurrent: () => epoch === sessionEpoch });
}, '已恢复默认头像'));
document.addEventListener('keydown', (event) => {
  const card = event.target.closest('[data-open-item]');
  if (card && card.tagName !== 'BUTTON' && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); run(() => openItem(Number(card.dataset.openItem))); }
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'preview-proceeds') updateDisposalPreview(currentItem);
});
$('#entity-form').addEventListener('change', handlePhotoInput);
$('#add-item-btn').addEventListener('click', () => openForm('item'));
$('#back-btn').addEventListener('click', () => showView(detailReturnView));
$('#search-input').addEventListener('input', () => { if (dataStore.isFresh('items')) renderItems(allItems); });
$('#status-filter').addEventListener('change', () => { if (dataStore.isFresh('items')) renderItems(allItems); });
$('#sort-order').addEventListener('change', () => {
  if (currentUser) { try { localStorage.setItem(`palm:sort:${currentUser.id}`, $('#sort-order').value); } catch (_) { /* Storage is optional. */ } }
  if (dataStore.isFresh('items')) renderItems(allItems);
});
$('#entity-form').addEventListener('submit', saveForm);
$('#entity-form').addEventListener('click', (event) => {
  const option = event.target.closest('.icon-option');
  if (option) option.querySelector('input').checked = true;
});
$('#close-dialog').addEventListener('click', () => $('#form-dialog').close());
$('#cancel-dialog').addEventListener('click', () => $('#form-dialog').close());
$('#form-dialog').addEventListener('close', releasePhotoPreview);
$('#app-retry').addEventListener('click', bootstrap);
$('#logout-btn').addEventListener('click', () => run(async () => {
  await api('/api/auth/logout', { method: 'POST' });
  clearAccount();
  location.replace('/');
}));
window.addEventListener('pagehide', () => { clearAccount(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
function refreshOnReturn() {
  if (!currentUser || document.visibilityState === 'hidden') return;
  const now = Date.now();
  if (now - lastFocusRefresh < 1000) return;
  lastFocusRefresh = now;
  dataStore.invalidateAll();
  void refreshVisible();
}
window.addEventListener('focus', refreshOnReturn);
document.addEventListener('visibilitychange', refreshOnReturn);
setInterval(() => {
  if (!currentUser || todayLocal() === dataDate) return;
  checkDate();
  void refreshVisible();
}, 60_000);
bootstrap();

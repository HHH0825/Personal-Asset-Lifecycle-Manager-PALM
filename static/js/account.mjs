import { $, avatarNames, avatarMarkup, iconTypes, escapeHtml } from './common.mjs';
import { showToast } from './feedback.mjs';
function renderAccountUser(user) {
  let savedSort = null;
  try { savedSort = localStorage.getItem(`palm:sort:${user.id}`); } catch (_) { /* Storage is optional. */ }
  $('#sort-order').value = [...$('#sort-order').options].some((option) => option.value === savedSort) ? savedSort : 'newest';
  $('#account-name').textContent = user.username;
  const key = Object.prototype.hasOwnProperty.call(avatarNames, user.avatar_key) ? user.avatar_key : 'sprout';
  for (const selector of ['#account-avatar', '#profile-avatar']) {
    const el = $(selector);
    el.dataset.avatar = key;
    el.innerHTML = `<svg aria-hidden="true"><use href="/static/images/avatars.svg#${key}"></use></svg>`;
  }
  $('#new-username').value = user.username;
  $('#avatar-options').innerHTML = Object.entries(avatarNames).map(([avatar, name]) => `<label class="avatar-choice"><input type="radio" name="avatar_key" value="${avatar}" ${key === avatar ? 'checked' : ''}><span class="avatar-choice-face">${avatarMarkup(avatar)}<span>${name}</span></span></label>`).join('');
}

async function saveAccountForm(form, { api, setUser, isCurrent, passwordChanged }) {
  const errorBox = $(`#${form.id.replace('-form', '-error')}`);
  errorBox.classList.add('hidden');
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    if (form.id === 'avatar-form') {
      const avatar_key = new FormData(form).get('avatar_key');
      const result = await api('/api/account/avatar', { method: 'PUT', body: JSON.stringify({ avatar_key }) });
      if (!isCurrent()) return;
      setUser(result.user);
      showToast('头像已更新');
    } else if (form.id === 'username-form') {
      const data = Object.fromEntries(new FormData(form));
      const result = await api('/api/account/username', { method: 'PUT', body: JSON.stringify(data) });
      if (!isCurrent()) return;
      setUser(result.user);
      form.elements.current_password.value = '';
      showToast('用户名已更新');
    } else {
      const data = Object.fromEntries(new FormData(form));
      if (data.new_password !== data.confirm_password) throw new Error('两次输入的新密码不一致');
      await api('/api/account/password', { method: 'PUT', body: JSON.stringify({ current_password: data.current_password, new_password: data.new_password }) });
      if (isCurrent()) passwordChanged();
    }
  } catch (error) {
    if (isCurrent()) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    }
  } finally {
    button.disabled = false;
  }
}

async function resetAvatar({ api, setUser, isCurrent }) {
  const result = await api('/api/account/avatar', { method: 'PUT', body: JSON.stringify({ avatar_key: null }) });
  if (isCurrent()) setUser(result.user);
}

export { renderAccountUser, saveAccountForm, resetAvatar };

function renderTrash(rows) {
  $('#trash-list').innerHTML = rows.length ? rows.map((item) => {
    const days = Math.max(0, Math.ceil((Date.parse(item.expires_at) - Date.now()) / 86400000));
    const deleted = new Date(item.deleted_at).toLocaleString('zh-CN');
    return `<div class="trash-row"><div><strong>${escapeHtml(item.name)}</strong><small>${iconTypes[item.icon_type] || iconTypes.other} · 删除于 ${escapeHtml(deleted)} · 还剩 ${days} 天</small></div><div class="trash-actions"><button type="button" class="secondary-btn" data-restore-item="${item.id}">恢复</button><button type="button" class="text-btn" data-purge-item="${item.id}">永久删除</button></div></div>`;
  }).join('') : '<p class="trash-empty">回收站是空的。</p>';
}

export { renderTrash };

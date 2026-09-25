import { $ } from './common.mjs';
let toastTimer;
function showToast(message, error = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}
function showToastAction(message, label, itemId, recordId) {
  showToast(message);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toast-action';
  button.textContent = label;
  button.dataset.editToday = `${itemId}:${recordId}`;
  $('#toast').append(' ', button);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.add('hidden'), 7000);
}

function resetToast() {
  clearTimeout(toastTimer);
  $('#toast').classList.add('hidden');
}

export { showToast, showToastAction, resetToast };

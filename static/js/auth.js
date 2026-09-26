const form = document.querySelector('#auth-form');
const errorBox = document.querySelector('#auth-error');
const submit = document.querySelector('#auth-submit');
const mode = document.querySelector('.auth-screen').dataset.mode;
let token = null;
function showError(message) { errorBox.textContent = message; errorBox.classList.remove('hidden'); }
async function connect() {
  token = null;
  submit.disabled = true;
  document.querySelector('#auth-retry').classList.add('hidden');
  errorBox.classList.add('hidden');
  try {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('暂时无法连接，请重试。');
    const state = await response.json();
    if (state.user) { location.replace('/app'); return; }
    token = state.csrf_token;
    submit.disabled = false;
    const params = new URLSearchParams(location.search);
    if (params.has('expired')) showError('登录状态已失效，请重新登录。');
    if (params.has('password_changed')) {
      const notice = document.querySelector('#auth-notice');
      notice.textContent = '密码已更新，请使用新密码重新登录。';
      notice.classList.remove('hidden');
    }
  } catch (_) { showError('暂时无法连接，请检查服务后重试。'); document.querySelector('#auth-retry').classList.remove('hidden'); }
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!token) return;
  const data = Object.fromEntries(new FormData(form));
  errorBox.classList.add('hidden');
  if (mode === 'register' && data.password !== data.confirm_password) { showError('两次输入的密码不一致'); return; }
  submit.disabled = true;
  try {
    const response = await fetch(`/api/auth/${mode}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify({ username: data.username.trim(), password: data.password }) });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 403) await connect();
      throw new Error(result.error || '提交失败，请重试。');
    }
    form.reset();
    location.replace('/app');
  } catch (error) { showError(error.message); submit.disabled = !token; }
});
document.querySelector('#auth-retry').addEventListener('click', connect);
window.addEventListener('pagehide', () => { form.reset(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
connect();

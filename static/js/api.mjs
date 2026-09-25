let getSession = () => ({ csrfToken: null, user: null });
let onExpired = () => {};
let onToken = () => {};

export function configureApi({ session, expired, token }) {
  getSession = session;
  onExpired = expired;
  onToken = token;
}

export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (options.body instanceof FormData) delete headers['Content-Type'];
  if (options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase())) {
    headers['X-CSRF-Token'] = getSession().csrfToken || '';
  }
  const response = await fetch(path, { ...options, credentials: 'same-origin', headers });
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try { message = (await response.json()).error || message; } catch (_) { /* No JSON body. */ }
    if (response.status === 401 && !path.startsWith('/api/auth/')) onExpired();
    if (response.status === 403 && !path.startsWith('/api/auth/')) {
      const state = await api('/api/auth/me');
      if (!state.user || state.user.id !== getSession().user?.id) onExpired();
      else onToken(state.csrf_token);
    }
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

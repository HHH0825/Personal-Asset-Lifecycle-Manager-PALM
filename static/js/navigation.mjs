const pages = new Set(['items', 'dashboard', 'review', 'account', 'trash', 'report']);

export function parseHash(hash) {
  const [path, query = ''] = String(hash || '').replace(/^#\/?/, '').split('?');
  const detail = /^items\/([1-9]\d*)$/.exec(path);
  if (detail) return { name: 'detail', id: Number(detail[1]) };
  if (!pages.has(path)) return { name: 'items', filters: {} };
  const params = new URLSearchParams(query);
  if (path === 'items') return { name: 'items', filters: {
    q: params.get('q') || '', status: params.get('status') || 'all',
    category: params.get('category') || 'all',
    sort: params.get('sort') || 'newest',
  } };
  if (path === 'report') return { name: 'report', month: params.get('month') || '' };
  return { name: path };
}

export function listHash(filters) {
  const params = new URLSearchParams();
  for (const key of ['q', 'status', 'category', 'sort']) {
    const value = filters[key];
    if (value && value !== 'all' && (key !== 'sort' || value !== 'newest')) params.set(key, value);
  }
  return `#/items${params.size ? `?${params}` : ''}`;
}

export function viewHash(name, { id, month, filters } = {}) {
  if (name === 'items') return listHash(filters || {});
  if (name === 'detail') return `#/items/${id}`;
  if (name === 'report') return `#/report${month ? `?month=${encodeURIComponent(month)}` : ''}`;
  return `#/${name}`;
}

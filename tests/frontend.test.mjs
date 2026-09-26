import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataStore } from '../static/js/data-store.mjs';
import { sortedItems, filterItems } from '../static/js/items.mjs';
import { parseHash, listHash } from '../static/js/navigation.mjs';
import { api } from '../static/js/api.mjs';

const item = (id, overrides = {}) => ({ id, is_pinned: false, holding_days: 10, purchase_price: '10.00', daily_purchase_cost: '1.00', daily_net_cost: '1.00', ...overrides });

test('sorting keeps pins first, null daily costs last and newest id as tie breaker', () => {
  const rows = [item(1, { daily_net_cost: null }), item(2, { daily_net_cost: '0.50' }), item(3, { daily_net_cost: '0.50', is_pinned: true }), item(4, { daily_net_cost: '0.50' })];
  assert.deepEqual(sortedItems(rows, 'daily_net_asc').map((row) => row.id), [3, 4, 2, 1]);
  assert.deepEqual(rows.map((row) => row.id), [1, 2, 3, 4]);
});

test('list filters and URL preserve Chinese categories while ignoring legacy type filters', () => {
  const rows = [item(1, { name: '相机', category: '摄影', icon_type: 'digital', status: 'active' }),
    item(2, { name: '音箱', category: '摄影', icon_type: 'digital', status: 'idle' }),
    item(3, { name: '相机包', category: '摄影', icon_type: 'daily', status: 'active' })];
  const filters = { q: '相机', status: 'active', category: '摄影', sort: 'newest' };
  assert.deepEqual(filterItems(rows, filters).map((row) => row.id), [3, 1]);
  assert.deepEqual(parseHash(listHash(filters)).filters, filters);
  assert.deepEqual(parseHash('#/items?q=相机&type=digital&category=摄影').filters,
    { q: '相机', status: 'all', category: '摄影', sort: 'newest' });
  assert.equal(listHash({ ...filters, type: 'digital' }).includes('type='), false);
  assert.deepEqual(parseHash('#/trash'), { name: 'trash' });
  assert.deepEqual(parseHash('#/items/27'), { name: 'detail', id: 27 });
  assert.equal(parseHash('#/items/0').name, 'items');
});

test('API errors keep HTTP status for unavailable item handling', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: '找不到物品' }), { status: 404 });
    await assert.rejects(api('/api/items/42'), (error) => error.status === 404 && error.message === '找不到物品');
    globalThis.fetch = async () => { throw new TypeError('网络中断'); };
    await assert.rejects(api('/api/items/42'), (error) => error.status === undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test('cache reuses an in-flight read and a fresh result for 60 seconds', async () => {
  let clock = 0;
  let calls = 0;
  let finish;
  const store = createDataStore(() => { calls++; return new Promise((resolve) => { finish = resolve; }); }, { now: () => clock });
  const first = store.load('items');
  const second = store.load('items');
  await Promise.resolve();
  assert.equal(calls, 1);
  finish([{ id: 1 }]);
  assert.deepEqual(await first, await second);
  assert.equal(store.isFresh('items'), true);
  clock = 59_999;
  assert.deepEqual(await store.load('items'), [{ id: 1 }]);
  assert.equal(calls, 1);
  clock = 60_000;
  const expired = store.load('items');
  await Promise.resolve();
  assert.equal(calls, 2);
  finish([{ id: 2 }]);
  assert.deepEqual(await expired, [{ id: 2 }]);
});

test('invalidation aborts old reads and stale completion cannot replace new data', async () => {
  const pending = [];
  const store = createDataStore((key, signal) => new Promise((resolve) => pending.push({ resolve, signal })));
  const oldRead = store.load('item:1');
  await Promise.resolve();
  store.invalidate(['item:1']);
  assert.equal(pending[0].signal.aborted, true);
  const newRead = store.load('item:1');
  await Promise.resolve();
  pending[1].resolve({ id: 1, name: '新数据' });
  assert.deepEqual(await newRead, { id: 1, name: '新数据' });
  pending[0].resolve({ id: 1, name: '过期数据' });
  await oldRead;
  assert.deepEqual(store.peek('item:1'), { id: 1, name: '新数据' });
  store.clear();
  assert.equal(store.peek('item:1'), undefined);
});

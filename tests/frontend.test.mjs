import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataStore } from '../static/js/data-store.mjs';
import { sortedItems } from '../static/js/items.mjs';

const item = (id, overrides = {}) => ({ id, is_pinned: false, holding_days: 10, purchase_price: '10.00', daily_purchase_cost: '1.00', daily_net_cost: '1.00', ...overrides });

test('sorting keeps pins first, null daily costs last and newest id as tie breaker', () => {
  const rows = [item(1, { daily_net_cost: null }), item(2, { daily_net_cost: '0.50' }), item(3, { daily_net_cost: '0.50', is_pinned: true }), item(4, { daily_net_cost: '0.50' })];
  assert.deepEqual(sortedItems(rows, 'daily_net_asc').map((row) => row.id), [3, 4, 2, 1]);
  assert.deepEqual(rows.map((row) => row.id), [1, 2, 3, 4]);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../../', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1));
const port = 5200 + Math.floor(Math.random() * 2000);
const origin = `http://127.0.0.1:${port}`;
const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aZ8AAAAASUVORK5CYII=', 'base64');

async function loadPlaywright() {
  const specifier = process.env.PALM_PLAYWRIGHT_MODULE || 'playwright';
  return import(specifier);
}
async function waitForServer(process) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (process.exitCode !== null) throw new Error(`隔离测试服务提前退出：${process.exitCode}`);
    try { if ((await fetch(origin)).ok) return; } catch { /* Still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('隔离测试服务启动超时');
}
async function pythonPath() {
  if (process.env.PALM_TEST_PYTHON) return process.env.PALM_TEST_PYTHON;
  const local = join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  try { await access(local); return local; } catch { return 'python'; }
}
async function saveForm(page) {
  await page.locator('#entity-form [type="submit"]').click();
  await page.locator('#form-dialog').waitFor({ state: 'hidden' });
}

test('完整浏览器流程、账号隔离、失败重试和窄屏布局', { timeout: 120_000 }, async (t) => {
  const python = await pythonPath();
  const server = spawn(python, ['tests/browser/server.py'], {
    cwd: root, env: { ...process.env, PALM_BROWSER_PORT: String(port) }, stdio: 'pipe',
  });
  t.after(() => server.kill());
  let errorOutput = '';
  server.stderr.on('data', (chunk) => { errorOutput += chunk.toString(); });
  try { await waitForServer(server); } catch (error) { throw new Error(`${error.message}\n${errorOutput}`); }
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch(process.env.PALM_BROWSER_CHANNEL
    ? { channel: process.env.PALM_BROWSER_CHANNEL }
    : {});
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('dialog', (dialog) => dialog.accept());
  const username = `测试用户${Date.now()}`;
  await page.goto(`${origin}/register`);
  await page.locator('[name="username"]').fill(username);
  await page.locator('[name="password"]').fill('palm-browser-pass-123');
  await page.locator('[name="confirm_password"]').fill('palm-browser-pass-123');
  await page.locator('#auth-submit').click();
  await page.waitForURL('**/app*');
  await page.locator('#items-view').waitFor({ state: 'visible' });
  assert.match(await page.locator('#item-count').innerText(), /0 \/ 0/);

  await page.locator('#add-item-btn').click();
  const form = page.locator('#entity-form');
  await form.locator('[name="name"]').fill('手机 这是一件名称比较长的测试物品');
  await form.locator('[name="icon_type"][value="digital"]').check();
  await form.locator('[name="category"]').fill('数码设备');
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  await form.locator('[name="purchase_date"]').fill(yesterday);
  await form.locator('[name="purchase_price"]').fill('1000');
  await form.locator('[name="photo"]').setInputFiles({ name: 'phone.png', mimeType: 'image/png', buffer: photo });
  await saveForm(page);
  assert.match(await page.locator('#toast').innerText(), /物品已保存/);
  await page.locator('.detail-photo-large').waitFor();

  await page.locator('[data-action="edit-item"]').click();
  await form.locator('[name="icon_type"][value="sports"]').check();
  await saveForm(page);
  assert.match(await page.locator('.detail-main').innerText(), /运动/);
  assert.equal(await page.locator('.detail-main .inline-type-icon use').getAttribute('href'), '/static/images/icons.svg#sports');
  await page.locator('#back-btn').click();
  assert.match(await page.locator('.item-card').innerText(), /运动/);
  assert.equal(await page.locator('.item-card .inline-type-icon use').getAttribute('href'), '/static/images/icons.svg#sports');
  await page.reload();
  await page.locator('.item-card').waitFor();
  assert.match(await page.locator('.item-card').innerText(), /运动/);
  const firstItemId = await page.locator('[data-open-item]').first().getAttribute('data-open-item');
  await page.locator('#search-input').fill('手机');
  await page.locator('[data-open-item]').first().click();
  await page.waitForURL(`**/app#/items/${firstItemId}`);
  await page.reload();
  await page.locator('.detail-photo-large').waitFor();
  assert.equal(await page.locator('.detail-photo-large').evaluate((image) => image.naturalWidth > 0), true);
  await page.locator('#back-btn').click();
  assert.equal(await page.locator('#search-input').inputValue(), '手机');
  await page.locator('#clear-filters').click();
  await page.locator('[data-open-item]').first().click();
  await page.locator('[data-action="add-maintenance"]').click();
  await form.locator('[name="maintained_on"]').fill(today);
  await form.locator('[name="cost"]').fill('80');
  await form.locator('[name="description"]').fill('更换电池');
  await saveForm(page);
  await page.locator('.detail-metrics').getByText('¥1,080.00').waitFor();
  await page.locator('[data-action="add-disposal"]').click();
  await form.locator('[name="disposed_on"]').fill(today);
  await form.locator('[name="proceeds"]').fill('300');
  await saveForm(page);
  await page.locator('.detail-metrics').getByText('¥780.00').waitFor();
  await page.locator('[data-action="delete-item"]').click();
  await page.locator('[data-view="trash"]').first().click();
  await page.locator('[data-restore-item]').click();
  await page.locator('[data-view="items"]').first().click();
  await page.locator('.item-card').waitFor();
  assert.match(await page.locator('.item-card').innerText(), /¥780.00/);
  await page.locator('[data-view="dashboard"]').first().click();
  await page.locator('#stats-grid').getByText('¥780.00').waitFor();
  assert.equal(await page.locator('#recent-items .inline-type-icon use').getAttribute('href'), '/static/images/icons.svg#sports');
  await page.locator('[data-view="items"]').first().click();

  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 850 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 2, `宽度 ${width} 出现横向溢出 ${overflow}px`);
    if (width === 320) {
      const priceHeights = await page.locator('.item-card-metrics strong').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
      assert.ok(priceHeights.every((height) => height <= 25), '320 像素下日均金额发生换行');
    }
    if (process.env.PALM_CAPTURE === '1') {
      await mkdir(join(root, 'test-results'), { recursive: true });
      await page.screenshot({ path: join(root, 'test-results', `archive-${width}.png`), fullPage: true });
    }
    await page.locator('#add-item-btn').click();
    const dialogOverflow = await page.locator('#form-dialog').evaluate((dialog) => {
      const bounds = dialog.getBoundingClientRect();
      return bounds.left < -2 || bounds.right > innerWidth + 2;
    });
    assert.equal(dialogOverflow, false, `宽度 ${width} 的录入弹窗超出视口`);
    await page.locator('#cancel-dialog').click();
  }

  await page.route('**/api/items', (route) => route.abort('failed'));
  await page.reload();
  await page.locator('#items-list').getByText(/加载失败/).waitFor();
  await page.unroute('**/api/items');
  await page.locator('[data-retry-view]').click();
  await page.locator('.item-card').waitFor();

  await page.locator('#logout-btn').click();
  await page.waitForURL(origin + '/');
  await page.goto(`${origin}/register`);
  await page.locator('[name="username"]').fill(`${username}二`);
  await page.locator('[name="password"]').fill('palm-browser-pass-456');
  await page.locator('[name="confirm_password"]').fill('palm-browser-pass-456');
  await page.locator('#auth-submit').click();
  await page.waitForURL('**/app*');
  await page.locator('#item-count').getByText('0 / 0 件物品').waitFor();
  assert.equal(await page.locator('.item-card').count(), 0);
  assert.equal((await page.request.get(`${origin}/api/items/${firstItemId}`)).status(), 404);
  assert.equal((await page.request.get(`${origin}/api/items/${firstItemId}/photo`)).status(), 404);
  assert.equal((await page.request.get(`${origin}/api/trash`)).status(), 200);
});

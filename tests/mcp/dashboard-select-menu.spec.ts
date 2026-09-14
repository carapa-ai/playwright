/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { EventEmitter } from 'events';
import { runInNewContext } from 'vm';
import { PNG } from 'pngjs';
import { test, expect } from '@playwright/test';
import { DashboardConnection } from '../../packages/playwright-core/src/tools/dashboard/dashboardController';
import { selectMenuBootstrap } from '../../packages/playwright-core/src/tools/dashboard/selectMenu';

import type { Page } from '@playwright/test';
import type { SessionProvider } from '../../packages/playwright-core/src/tools/dashboard/sessionProvider';

async function attach(page: Page) {
  const provider = Object.assign(new EventEmitter(), {
    start() {}, dispose() {}, contextEntries: () => [], findPage: () => page,
  }) as unknown as SessionProvider;
  const connection = new DashboardConnection(provider, () => {});
  await connection.setVisible({ visible: false });
  await connection.selectTab({ browser: '', context: '', page: '' });
  return connection;
}

async function click(connection: DashboardConnection, locator: ReturnType<Page['locator']>) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const point = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  await connection.dispatch('mousedown', point);
  await connection.dispatch('mouseup', point);
}

const content = `<style>body{margin:40px}select{font:20px sans-serif;width:220px;background:rgb(250,0,150)}</style>
  <label for="source">Choose</label><select id="source"><option value="same">A</option><option value="same">B</option>
  <optgroup label="Group"><option disabled>X</option><option>C</option></optgroup></select><input id="next">
  <script>window.changes=[];document.addEventListener('input', e => changes.push('input:'+e.target.id));
  document.addEventListener('change', e => changes.push('change:'+e.target.id));</script>`;

test('stack bootstrap is self-contained, idempotent and installs dropdowns in future tabs and frames', async ({ page, browser }) => {
  await page.setContent(content);
  // The published CLI evaluates run-code in an empty VM context.
  const bootstrap = runInNewContext(`(${selectMenuBootstrap()})`);
  await Promise.all([bootstrap(page), bootstrap(page)]);
  await page.locator('#source').click();
  await expect(page.locator('select[size]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.goto('data:text/html,' + encodeURIComponent(content));
  await page.locator('#source').click();
  await expect(page.locator('select[size]')).toBeVisible();
  await page.keyboard.press('Escape');
  const tab = await page.context().newPage();
  await tab.goto('data:text/html,' + encodeURIComponent(content));
  await tab.locator('#source').click();
  await expect(tab.locator('select[size]')).toBeVisible();
  await tab.keyboard.press('Escape');
  await tab.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.srcdoc = '<select><option>A</option><option>B</option></select>';
    document.body.appendChild(frame);
  });
  const frame = tab.frameLocator('iframe');
  await frame.locator('select').click();
  await expect(frame.locator('select[size]')).toBeVisible();
  const other = await browser.newContext();
  try {
    const unrelated = await other.newPage();
    await unrelated.setContent(content);
    await unrelated.locator('#source').click();
    await expect(unrelated.locator('select[size]')).toHaveCount(0);
  } finally {
    await other.close();
  }
});

test('viewer dropdown is captured and commits mouse/keyboard selection without changing page layout', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 480 });
  await page.setContent(content);
  const source = page.locator('#source');
  const bounds = await source.boundingBox();
  const connection = await attach(page);
  const cdp = await page.context().newCDPSession(page);
  let pixelsBelowSelect = 0;
  cdp.on('Page.screencastFrame', event => {
    void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
    const png = PNG.sync.read(Buffer.from(event.data, 'base64'));
    pixelsBelowSelect = 0;
    for (let y = Math.ceil(bounds!.y + bounds!.height + 4); y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        const i = (y * png.width + x) * 4;
        if (png.data[i] > 230 && png.data[i + 1] < 20 && png.data[i + 2] > 130 && png.data[i + 2] < 170)
          pixelsBelowSelect++;
      }
    }
  });
  try {
    await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 640, maxHeight: 480 });
    await click(connection, source);
    const menu = page.locator('select[size]');
    await expect(menu).toBeVisible();
    await expect.poll(() => pixelsBelowSelect).toBeGreaterThan(1000);
    expect(await source.boundingBox()).toEqual(bounds);
    expect(await source.evaluate(e => e.matches(':open'))).toBe(false);
    await click(connection, menu.locator('option').nth(1));
    expect(await source.evaluate(e => (e as HTMLSelectElement).selectedIndex)).toBe(1);
    expect(await page.evaluate('changes')).toEqual(['input:source', 'change:source']);
    await expect(menu).toHaveCount(0);
    await connection.dispatch('keydown', { key: ' ' });
    await connection.dispatch('keyup', { key: ' ' });
    await expect(menu).toBeVisible();
    await connection.dispatch('keydown', { key: 'ArrowDown' });
    await connection.dispatch('keyup', { key: 'ArrowDown' });
    await connection.dispatch('keydown', { key: 'Enter' });
    await connection.dispatch('keyup', { key: 'Enter' });
    await expect(source).toHaveValue('C');
    expect(await page.evaluate('changes')).toEqual(['input:source', 'change:source', 'input:source', 'change:source']);
    await click(connection, source);
    await connection.dispatch('keydown', { key: 'ArrowUp' });
    await connection.dispatch('keyup', { key: 'ArrowUp' });
    await connection.dispatch('keydown', { key: 'Escape' });
    await connection.dispatch('keyup', { key: 'Escape' });
    await expect(menu).toHaveCount(0);
    await expect(source).toHaveValue('C');
    await click(connection, page.locator('label'));
    await expect(menu).toBeVisible();
    await click(connection, page.locator('#next'));
    await expect(menu).toHaveCount(0);
  } finally {
    connection.onclose();
    await cdp.detach();
  }
});

test('viewer dropdown survives navigation, supports frames and shadow roots, and cleans up after the last viewer', async ({ page }) => {
  await page.setContent(content);
  const first = await attach(page);
  const second = await attach(page);
  try {
    first.onclose();
    await page.locator('#source').click();
    await expect(page.locator('select[size]')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.goto('data:text/html,' + encodeURIComponent(content));
    await page.locator('#source').click();
    await expect(page.locator('select[size]')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.attachShadow({ mode: 'open' }).innerHTML = '<select id="shadow"><option>A</option><option>B</option></select>';
      document.body.appendChild(host);
      const frame = document.createElement('iframe');
      frame.srcdoc = '<select id="framed"><option>A</option><option>B</option></select>';
      document.body.appendChild(frame);
    });
    await page.locator('#shadow').click();
    await expect(page.locator('select[size]')).toBeVisible();
    await page.keyboard.press('Escape');
    const frame = page.frameLocator('iframe');
    await frame.locator('#framed').click();
    await expect(frame.locator('select[size]')).toBeVisible();
    await page.keyboard.press('Escape');
  } finally {
    second.onclose();
  }
  await expect.poll(() => page.evaluate(() => Symbol.for('playwright.dashboard.selectMenu') in window)).toBe(false);
  await page.locator('#source').click();
  await expect(page.locator('select[size]')).toHaveCount(0);
  expect(await page.locator('#source').evaluate(e => e.matches(':open'))).toBe(true);
});

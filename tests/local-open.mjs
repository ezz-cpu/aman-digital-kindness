import { listenForTests } from './helpers/http-server.mjs';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp } from '../server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = await mkdtemp(path.join(tmpdir(), 'aman-local-open-'));
const server = await createApp({ dataDir, tobiOptions: { apiKey: '' } });
await listenForTests(server);
const port = server.address().port;
const installedChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || (existsSync(installedChrome) ? installedChrome : undefined),
  headless: true,
  // The OS can choose an otherwise browser-reserved port for this local test server.
  args: [`--explicitly-allowed-ports=${port}`],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));

try {
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  for (const [kind, url] of [
    ['file', pathToFileURL(path.join(root, 'index.html')).href],
    ['http', `http://127.0.0.1:${port}/index.html`],
  ]) {
    await page.goto(url);
    await page.locator('[data-aman-scene][data-scene-ready="true"]').waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('[data-scene-fallback]').isVisible(), false, `${kind}: real 3D replaces the fallback`);
    assert.equal(await page.locator('[data-aman-scene] canvas').count(), 1);
    const first = await page.locator('[data-aman-scene] canvas').screenshot();
    assert.ok(first.length > 15000, `${kind}: canvas has visible content`);
    await page.locator('[data-scene-turn]').click();
    assert.equal((await page.locator('[data-aman-scene] canvas').screenshot()).equals(first), false, `${kind}: the 3D object rotates`);
    await page.locator('[data-language]').click();
    await page.locator('[data-aman-scene][data-scene-ready="true"]').waitFor();
    assert.equal(await page.locator('[data-aman-scene] canvas').count(), 1, `${kind}: language changes remount once`);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${kind}: mobile layout fits`);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(root, 'test-results', `3d-${kind}-opening.png`) });
    console.log(`PASS: ${kind} opening renders and rotates real 3D; language and mobile controls work`);
  }

  await page.goto(pathToFileURL(path.join(root, 'tobi.html')).href);
  await page.locator('.mission-card').first().waitFor();
  assert.equal(await page.locator('.mission-card').count(), 4, 'Free Tobi activities load directly from a file.');
  await page.locator('.mission-nav [data-view=chat]').click();
  await page.locator('#chat-input').fill('How do I make a strong password?');
  await page.locator('#chat-input').press('Enter');
  assert.equal(await page.locator('.bubble').count(), 3, 'Tobi answers from the notebook without a server.');
  assert.equal(await page.locator('[data-chat-mode=ai]').isDisabled(), false);
  await page.locator('[data-chat-mode=ai]').click();
  await page.locator('.chat-notice').filter({ hasText: 'Open Aman.cmd' }).waitFor();
  await page.locator('.mission-nav [data-view=home]').click();
  assert.equal(await page.locator('.mission-card').count(), 4);
  console.log('PASS: direct-file Tobi loads free games and notebook chat; AI correctly requires the server');

  const fallback = await browser.newContext({ reducedMotion: 'reduce' });
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return /^(experimental-)?webgl2?$/.test(kind) ? null : original.call(this, kind, ...args);
    };
  });
  const fallbackPage = await fallback.newPage();
  await fallbackPage.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await fallbackPage.locator('[data-aman-scene][data-scene-ready="false"]').waitFor();
  assert.equal(await fallbackPage.locator('[data-scene-fallback]').isVisible(), true);
  for (const control of await fallbackPage.locator('[data-scene-turn], [data-scene-reset], [data-scene-motion]').all()) assert.equal(await control.isDisabled(), true);
  await fallback.close();
  assert.deepEqual(errors, []);
  console.log('PASS: genuine WebGL failure still displays the fallback and disables unavailable controls');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  assert.ok(path.resolve(dataDir).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dataDir).startsWith('aman-local-open-'));
  await rm(dataDir, { recursive: true, force: true });
}

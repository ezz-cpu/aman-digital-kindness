import { listenForTests } from './helpers/http-server.mjs';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';

const dataDir = await mkdtemp(path.join(tmpdir(), 'aman-scene-test-'));
const server = await createApp({ dataDir });
await listenForTests(server);
const base = `http://127.0.0.1:${server.address().port}`;
const installedChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const executablePath = process.env.CHROME_PATH || (existsSync(installedChrome) ? installedChrome : undefined);
const browser = await chromium.launch({ executablePath, headless: true });
const errors = [];

async function openHome({ reducedMotion = 'no-preference', webgl = true, width = 1440 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion });
  if (!webgl) await context.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...options) {
      return /^(experimental-)?webgl2?$/.test(type) ? null : getContext.call(this, type, ...options);
    };
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/index.html`);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.locator(`[data-aman-scene][data-scene-ready="${webgl}"]`).waitFor();
  await page.locator('[data-aman-scene]').scrollIntoViewIfNeeded();
  return { page, context };
}

async function frame(page) {
  return page.locator('[data-aman-scene] canvas').screenshot();
}

async function visuallyEqual(page, first, second) {
  if (first.equals(second)) return true;
  return page.evaluate(async ([firstData, secondData]) => {
    async function pixels(data) {
      const picture = new Image();
      picture.src = `data:image/png;base64,${data}`;
      await picture.decode();
      const surface = document.createElement('canvas');
      surface.width = picture.width;
      surface.height = picture.height;
      const context = surface.getContext('2d');
      context.drawImage(picture, 0, 0);
      return context.getImageData(0, 0, surface.width, surface.height).data;
    }
    const [a, b] = await Promise.all([pixels(firstData), pixels(secondData)]);
    if (a.length !== b.length) return false;
    let changed = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 8) changed++;
    }
    // GPU edge antialiasing can vary a few pixels on an otherwise static scene.
    return changed <= a.length / 4 * 0.0005;
  }, [first.toString('base64'), second.toString('base64')]);
}

try {
  const normal = await openHome();
  const { page } = normal;
  const motion = page.locator('[data-scene-motion]');
  assert.equal(await motion.getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('[data-scene-fallback]').isVisible(), false);
  const firstFrame = await frame(page);
  assert.ok(firstFrame.length > 15000, 'The canvas should contain the rendered scene, not a blank surface.');
  await page.waitForTimeout(240);
  assert.equal(await visuallyEqual(page, await frame(page), firstFrame), false, 'The normal-motion scene should animate.');

  await motion.click();
  assert.equal(await motion.getAttribute('aria-pressed'), 'true');
  const pausedFrame = await frame(page);
  await page.waitForTimeout(240);
  assert.equal(await visuallyEqual(page, await frame(page), pausedFrame), true, 'Pause should stop visual animation.');
  await page.locator('[data-scene-turn]').click();
  const turnedFrame = await frame(page);
  assert.equal(await visuallyEqual(page, turnedFrame, pausedFrame), false, 'Rotate should visibly change the paused scene.');
  await page.locator('[data-scene-reset]').click();
  assert.equal(await visuallyEqual(page, await frame(page), turnedFrame), false, 'Reset should visibly restore the viewpoint.');

  const originalNote = await page.locator('[data-kindness-note]').textContent();
  await page.locator('[data-kindness-next]').click();
  assert.notEqual(await page.locator('[data-kindness-note]').textContent(), originalNote);
  assert.ok(await page.locator('[data-kindness-caption]').textContent());

  const oldCanvas = await page.locator('[data-aman-scene] canvas').elementHandle();
  await page.locator('[data-language]').click();
  await page.locator('[data-aman-scene][data-scene-ready="true"]').waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await page.locator('[data-aman-scene] canvas').count(), 1);
  assert.equal(await oldCanvas.evaluate(element => element.isConnected), false);
  await page.locator('[data-scene-motion]').click();
  assert.equal(await page.locator('[data-scene-motion]').getAttribute('aria-pressed'), 'true');
  console.log('PASS: rendered animated 3D scene, pause, rotate/reset, and clean language remount');
  await normal.context.close();

  const reduced = await openHome({ reducedMotion: 'reduce', width: 390 });
  assert.equal(await reduced.page.locator('[data-scene-motion]').getAttribute('aria-pressed'), 'true');
  const stillFrame = await frame(reduced.page);
  await reduced.page.waitForTimeout(240);
  const nextStillFrame = await frame(reduced.page);
  const isStill = await visuallyEqual(reduced.page, nextStillFrame, stillFrame);
  if (!isStill) {
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/scene-reduced-first.png', stillFrame);
    await writeFile('test-results/scene-reduced-second.png', nextStillFrame);
  }
  assert.equal(isStill, true, 'Reduced motion should start with a static scene.');
  await reduced.page.locator('[data-scene-turn]').click();
  assert.equal(await visuallyEqual(reduced.page, await frame(reduced.page), stillFrame), false, 'Explicit rotation should still work with reduced motion.');
  for (const language of ['ar', 'en']) {
    if (await reduced.page.locator('html').getAttribute('lang') !== language) await reduced.page.locator('[data-language]').click();
    const dimensions = await reduced.page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(dimensions.scroll <= dimensions.width + 1, `${language} mobile homepage overflows: ${JSON.stringify(dimensions)}`);
    const controls = reduced.page.locator('[data-scene-turn], [data-scene-reset], [data-scene-motion]');
    for (const control of await controls.all()) assert.equal(await control.isEnabled(), true);
  }
  console.log('PASS: reduced-motion static rendering, explicit controls, and both mobile language layouts');
  await reduced.context.close();

  const fallback = await openHome({ webgl: false });
  assert.equal(await fallback.page.locator('[data-scene-fallback]').isVisible(), true);
  for (const control of await fallback.page.locator('[data-scene-turn], [data-scene-reset], [data-scene-motion]').all()) {
    assert.equal(await control.isDisabled(), true, 'Unavailable 3D controls must not remain active.');
  }
  assert.equal(await fallback.page.locator('h1').count(), 1);
  await fallback.page.locator('[data-support]').first().click();
  assert.equal(await fallback.page.locator('#support-dialog').evaluate(dialog => dialog.open), true);
  await fallback.page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  console.log('PASS: unavailable WebGL keeps the fallback and working support navigation; no JavaScript errors');
  await fallback.context.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  assert.ok(path.resolve(dataDir).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dataDir).startsWith('aman-scene-test-'));
  await rm(dataDir, { recursive: true, force: true });
}

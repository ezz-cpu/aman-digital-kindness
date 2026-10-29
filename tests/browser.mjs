import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';

const dataDir = await mkdtemp(path.join(tmpdir(), 'aman-browser-test-'));
const server = await createApp({ dataDir });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const installedChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const executablePath = process.env.CHROME_PATH || (existsSync(installedChrome) ? installedChrome : undefined);
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await mkdir('test-results', { recursive: true });
const shots = (name, fullPage = true) => page.screenshot({ path: `test-results/${name}.png`, fullPage });
async function goto(file) { await page.goto(`${base}/${file}`); await page.waitForLoadState('networkidle'); }
async function click(selector) { await page.locator(selector).click(); }
try {
  await goto('index.html');
  assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
  assert.equal(await page.locator('h1').count(), 1);
  await shots('home-ar-desktop');
  await click('[data-language]');
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await shots('home-en-desktop');
  await click('[data-support] >> nth=0');
  assert.equal(await page.locator('#support-dialog').evaluate(el => el.open), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#support-dialog').evaluate(el => el.open), false);
  console.log('PASS: bilingual homepage and keyboard-dismissible support dialog');

  await goto('signup.html');
  await page.locator('#name').fill('Test Friend');
  await page.locator('#email').fill('browser@example.com');
  await page.locator('#password').fill('a really long unique passphrase');
  await page.locator('#confirm-password').fill('does not match');
  await page.locator('[name=privacy]').check();
  await click('.auth-submit');
  assert.match(await page.locator('#auth-error').textContent(), /don’t match/);
  await page.locator('#confirm-password').fill('a really long unique passphrase');
  await click('[data-toggle-password=password]');
  assert.equal(await page.locator('#password').getAttribute('type'), 'text');
  await click('[data-toggle-password=password]');
  await shots('signup-en-desktop');
  await click('.auth-submit');
  await page.waitForURL('**/dashboard.html');
  await page.locator('.dashboard-stats').waitFor();
  assert.match(await page.locator('h1').textContent(), /Test Friend/);
  const cookies = await context.cookies();
  assert.equal(cookies.find(cookie => cookie.name === 'aman_session').httpOnly, true);
  assert.equal(await page.evaluate(() => localStorage.getItem('user')), null);
  console.log('PASS: password confirmation, visibility, signup, HttpOnly login session');

  await page.locator('[data-checklist=privacy]').check();
  await page.waitForFunction(() => document.querySelector('#check-count').textContent === '1 / 4');
  await goto('resources.html');
  await page.locator('#resource-search').fill('UNICEF');
  assert.equal(await page.locator('#resource-results .resource-card').count(), 1);
  await click('[data-save=unicef]');
  await page.waitForFunction(() => document.querySelector('[data-save=unicef]').getAttribute('aria-pressed') === 'true');
  await page.locator('#resource-search').fill('no-such-guide');
  await page.locator('.empty-state').waitFor();
  await click('#clear-search');
  await click('[data-filter=parents]');
  assert.equal(await page.locator('#resource-results .resource-card').count(), 2);
  console.log('PASS: resource search, filters, empty state, and account bookmarks');

  await goto('interactive.html');
  await click('[data-start-quiz]');
  for (const answer of [1, 2, 0, 1, 2]) {
    await click(`[data-answer="${answer}"]`);
    assert.equal(await page.locator('.is-correct').count(), 1);
    await click('[data-next-question]');
  }
  assert.match(await page.locator('.result-score').textContent(), /5.*5/);
  await page.waitForFunction(() => document.querySelector('#quiz-save-note').textContent.includes('saved'));
  await shots('quiz-result');
  await goto('dashboard.html');
  assert.equal(await page.locator('#saved-count').textContent(), '1');
  assert.equal(await page.locator('#check-count').textContent(), '1 / 4');
  assert.match(await page.locator('.dashboard-stats').textContent(), /5 \/ 5/);
  await shots('dashboard-en-desktop');
  await click('[data-logout]');
  await page.waitForURL('**/index.html');
  await goto('dashboard.html');
  await page.waitForURL('**/login.html?next=dashboard.html');
  await page.locator('#email').fill('browser@example.com');
  await page.locator('#password').fill('wrong password');
  await click('.auth-submit');
  await page.locator('#auth-error:not([hidden])').waitFor();
  await page.locator('#password').fill('a really long unique passphrase');
  await click('.auth-submit');
  await page.waitForURL('**/dashboard.html');
  await page.locator('.dashboard-stats').waitFor();
  assert.equal(await page.locator('#saved-count').textContent(), '1');
  console.log('PASS: complete quiz, persisted progress, logout, protected dashboard, login errors and success');

  await click('[data-logout]');
  await page.waitForURL('**/index.html');
  for (const language of ['en', 'ar']) {
    if (await page.locator('html').getAttribute('lang') !== language) await click('[data-language]');
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const file of ['index.html', 'about.html', 'resources.html', 'interactive.html', 'login.html', 'signup.html', 'privacy.html']) {
        await goto(file);
        const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
        assert.ok(sizes.scroll <= sizes.viewport + 1, `${language} ${file} overflows at ${width}: ${JSON.stringify(sizes)}`);
        assert.equal(await page.locator('h1').count(), 1, file);
        if (width === 390 && ['index.html', 'signup.html'].includes(file)) await shots(`${file.split('.')[0]}-${language}-mobile`);
        if (width === 1440 && ['about.html', 'resources.html'].includes(file)) await shots(`${file.split('.')[0]}-${language}-desktop`);
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await goto('index.html');
  await click('.menu-button');
  assert.equal(await page.locator('.menu-button').getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.menu-button').getAttribute('aria-expanded'), 'false');
  assert.deepEqual(errors, []);
  console.log('PASS: all 7 public pages in both languages at mobile, tablet, desktop sizes; mobile navigation; no JavaScript errors');
  console.log('Screenshots saved in test-results/');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  assert.ok(path.resolve(dataDir).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dataDir).startsWith('aman-browser-test-'));
  await rm(dataDir, { recursive: true, force: true });
}

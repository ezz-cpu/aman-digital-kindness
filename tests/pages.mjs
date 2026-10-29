import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../release/pages');
const prefix = '/aman-digital-kindness/';
const requests = [];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://local').pathname;
  requests.push(pathname);
  const name = pathname.slice(prefix.length) || 'index.html';
  const file = path.resolve(root, name);
  if (!pathname.startsWith(prefix) || !file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  try { const body = await readFile(file); res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'text/plain' }); res.end(body); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}${prefix}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [`--explicitly-allowed-ports=${port}`] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const goto = async file => { await page.goto(base + file, { waitUntil: 'networkidle' }); };
try {
  await goto('index.html');
  assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
  assert.equal(await page.locator('a[href^="login.html"], a[href^="signup.html"]').count(), 0);
  await page.locator('[data-language]').click();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/pages-home.png', fullPage: true });
  await goto('resources.html');
  await page.locator('[data-filter="parents"]').click();
  assert.equal(await page.locator('[data-save]').count(), 0);
  assert.equal(await page.locator('#resource-results .resource-card').count(), 2);
  await goto('interactive.html');
  assert.equal(await page.locator('.world-game .card-link').getAttribute('href'), 'https://ezz-king33.itch.io/save-the-world-with-godot');
  await page.locator('[data-start-quiz]').click();
  for (const answer of [1, 2, 0, 1, 2]) { await page.locator(`[data-answer="${answer}"]`).click(); await page.locator('[data-next-question]').click(); }
  assert.match(await page.locator('.result-score').textContent(), /5.*5/);
  assert.equal(await page.locator('a[href^="login.html"]').count(), 0);
  for (const file of ['login.html', 'signup.html', 'dashboard.html']) {
    await goto(file);
    assert.equal(await page.locator('input[type="password"], #auth-form').count(), 0);
    assert.match(await page.locator('main').textContent(), /No account needed/);
  }
  await goto('tobi.html#chat');
  await page.locator('#chat-input').fill('How do I make a strong password?');
  await page.locator('#chat-input').press('Enter');
  await page.locator('.bubble').filter({ hasText: 'Use a long, unique passphrase' }).waitFor();
  assert.equal(await page.locator('a[href^="login.html"], a[href^="tobi-studio.html"]').count(), 0);
  await page.locator('[data-action="language"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: 'test-results/pages-tobi-mobile.png', fullPage: true });
  assert.deepEqual(requests.filter(url => url.includes('/api/')), []);
  assert.deepEqual(errors, []);
  console.log('PASS: Pages subpath, bilingual navigation, guides, game link, quiz, notebook chat, account notices, mobile layout, and zero server API requests.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

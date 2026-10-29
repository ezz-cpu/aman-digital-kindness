import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createApp } from '../server.js';
const require = createRequire(import.meta.url);
const dataDir = await mkdtemp(path.join(tmpdir(), 'aman-final-test-'));
const server = await createApp({ dataDir });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || (existsSync(chrome) ? chrome : undefined) });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', bypassCSP: true });
async function goto(file) { await page.goto(`${base}/${file}`); await page.waitForLoadState('networkidle'); }
async function audit(label) {
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const results = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, issue: n.failureSummary })) })));
  assert.deepEqual(results, [], label);
}
try {
  await goto('interactive.html');
  await page.locator('[data-language]').click();
  await page.locator('[data-start-quiz]').click();
  await audit('Unanswered question');
  for (const answer of [1, 2, 0, 0, 0]) {
    await page.locator(`[data-answer="${answer}"]`).click();
    if (answer === 0) await audit('Answered question');
    await page.locator('[data-next-question]').click();
  }
  assert.match(await page.locator('.result-score').textContent(), /3.*5/);
  await audit('Guest result');
  await goto('signup.html');
  await page.locator('#name').fill('Friend <3');
  await page.locator('#email').fill('guest@example.com');
  await page.locator('#password').fill('a unique passphrase for guest');
  await page.locator('#confirm-password').fill('a unique passphrase for guest');
  await page.locator('[name=privacy]').check();
  await page.locator('.auth-submit').click();
  await page.waitForURL('**/dashboard.html');
  await page.locator('.dashboard-stats').waitFor();
  assert.match(await page.locator('.dashboard-stats').textContent(), /3 \/ 5/);
  assert.match(await page.locator('h1').textContent(), /Friend <3/);
  await audit('Mobile dashboard');
  console.log('PASS: guest quiz transfers into new account, names render safely, interactive states and dashboard accessibility');
  for (const language of ['en', 'ar']) {
    if (await page.locator('html').getAttribute('lang') !== language) await page.locator('[data-language]').click();
    for (const width of [320, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      for (const file of ['index.html', 'resources.html', 'dashboard.html']) {
        await goto(file);
        const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
        assert.ok(fits, `${language} ${file} at ${width}`);
      }
    }
    await audit(`${language} tablet dashboard`);
  }
  await goto('index.html');
  await page.locator('[data-support]').first().click();
  await audit('Support dialog');
  await page.keyboard.press('Escape');
  console.log('PASS: smallest mobile and tablet layouts, dashboard in both languages, support-dialog accessibility');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-logout]').click();
  await page.waitForURL('**/index.html');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/home-ar-final.png', fullPage: true });
  await page.locator('[data-language]').click();
  await page.screenshot({ path: 'test-results/home-en-final.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/home-en-mobile-final.png', fullPage: true });
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  assert.ok(path.resolve(dataDir).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dataDir).startsWith('aman-final-test-'));
  await rm(dataDir, { recursive: true, force: true });
}

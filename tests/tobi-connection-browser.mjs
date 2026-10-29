import { listenForTests } from './helpers/http-server.mjs';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';

const dataDir = await mkdtemp(path.join(tmpdir(), 'aman-tobi-connection-browser-'));
const fakeKey = 'sk-browser-test-AAAAAAAAAAAAAAAAAAAAAAAA';
const calls = [];
let failure = false;
const server = await createApp({ dataDir, tobiOptions: {
  apiKey: '',
  aiFetch: async (url, request) => {
    calls.push({ url, request });
    if (failure) return Response.json({ error: { code: 'invalid_api_key', message: `Never expose provider details: ${fakeKey}` } }, { status: 401 });
    const content = JSON.parse(request.body);
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: content.max_output_tokens === 64 ? 'OK' : `Simulated AI reply ${calls.length}: I can help you learn and stay safe.` }] }] });
  },
} });
await listenForTests(server);
const base = `http://127.0.0.1:${server.address().port}`;
const installedChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const executablePath = process.env.CHROME_PATH || (existsSync(installedChrome) ? installedChrome : undefined);
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce' });
await context.addInitScript(() => { if (!localStorage.getItem('aman-language')) localStorage.setItem('aman-language', 'en'); });
const page = await context.newPage();
const errors = [], outgoing = [], audits = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).origin !== base) outgoing.push(request.url()); });
await mkdir('test-results', { recursive: true });
const axeSource = await readFile('node_modules/axe-core/axe.min.js', 'utf8');

async function goto(file) {
  await page.goto(`${base}/${file}`);
  await page.locator('#tobi-main').waitFor();
  await page.evaluate(() => document.fonts.ready);
}
async function studio() {
  await goto('tobi-studio.html#ai');
  await page.locator('#connection-form').waitFor();
}
async function audit(label) {
  await page.evaluate(axeSource);
  const result = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }));
  if (result.violations.length) audits.push({ label, violations: result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => ({ target: node.target, issue: node.failureSummary })) })) });
}
async function assertNoSecret() {
  assert.equal((await page.content()).includes(fakeKey), false, 'Saved key must not be present in page HTML.');
  assert.equal(await page.evaluate(key => JSON.stringify({ ...localStorage }).includes(key), fakeKey), false, 'Key must not be stored in localStorage.');
  for (const route of ['/api/tobi/config', '/api/tobi/access', '/api/tobi/connection']) {
    const response = await context.request.get(base + route);
    assert.equal((await response.text()).includes(fakeKey), false, `${route} must not return the key.`);
  }
}
async function noOverflow(label) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  assert.ok(dimensions.content <= dimensions.viewport + 1, `${label} overflows: ${JSON.stringify(dimensions)}`);
}
async function language(value) {
  if (await page.locator('html').getAttribute('lang') !== value) await page.locator('[data-action=language]').click();
  assert.equal(await page.locator('html').getAttribute('dir'), value === 'ar' ? 'rtl' : 'ltr');
}
async function shot(name) {
  await page.screenshot({ path: `test-results/${name}.png`, fullPage: true });
}

try {
  const signup = await context.request.post(base + '/api/auth/signup', { data: { name: 'Studio Tester', email: 'connection-ui@example.test', password: 'a long browser-only test password' } });
  assert.equal(signup.status(), 201);
  const setupCode = (await readFile(path.join(dataDir, 'tobi-owner-code.txt'), 'utf8')).trim();
  assert.equal((await context.request.post(base + '/api/tobi/claim', { data: { code: setupCode } })).status(), 200);

  await studio();
  assert.equal(await page.locator('[data-tab=ai]').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#api-key').getAttribute('type'), 'password');
  assert.equal(await page.locator('[data-action=test-connection]').isDisabled(), true);
  assert.equal(await page.locator('[data-action=toggle-ai]').isDisabled(), true);
  await shot('tobi-ai-empty-en-desktop');
  await audit('empty AI panel, English desktop');

  await page.locator('#api-key').fill(fakeKey);
  await page.locator('#ai-model').fill('gpt-5.6-luna');
  await page.locator('#connection-form button[type=submit]').click();
  await page.locator('#connection-feedback').filter({ hasText: 'Saved.' }).waitFor();
  assert.equal(await page.locator('#api-key').inputValue(), '');
  assert.equal(await page.locator('[data-action=test-connection]').isEnabled(), true);
  assert.equal(calls.length, 0, 'Saving must not make an AI request.');
  assert.equal((await (await context.request.get(base + '/api/tobi/config')).json()).aiAvailable, false);
  await assertNoSecret();

  await page.locator('[data-action=test-connection]').click();
  await page.locator('#connection-feedback').filter({ hasText: 'Connected!' }).waitFor();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.headers.Authorization, `Bearer ${fakeKey}`);
  await page.locator('[data-action=toggle-ai]').click();
  await page.locator('#connection-feedback').filter({ hasText: 'AI is on.' }).waitFor();
  assert.equal((await (await context.request.get(base + '/api/tobi/config')).json()).aiAvailable, true);
  await shot('tobi-ai-configured-en-desktop');
  await audit('configured AI panel, English desktop');
  await page.reload();
  await page.locator('#connection-form').waitFor();
  assert.equal(await page.locator('#api-key').inputValue(), '');
  assert.match(await page.locator('.connection-badge').textContent(), /AI is enabled/);
  console.log('PASS: owner UI saves a private key, tests explicitly, enables AI, and preserves configuration on reload');

  await goto('tobi.html#chat');
  await page.locator('#chat-input').waitFor();
  await page.locator('#chat-input').fill('What is your name?');
  await page.locator('#chat-input').press('Enter');
  await page.locator('.bubble').filter({ hasText: 'I’m Tobi! Your digital-safety buddy.' }).waitFor();
  assert.equal(calls.length, 1, 'Automatic mode should use the free notebook for known questions.');
  await page.locator('[data-chat-mode=ai]').click();
  assert.equal(await page.locator('[data-chat-mode=ai]').getAttribute('aria-pressed'), 'true');
  await page.locator('#chat-input').fill('What is your name?');
  await page.locator('#chat-input').press('Enter');
  await page.locator('.bubble').filter({ hasText: 'Simulated AI reply 2:' }).waitFor();
  assert.equal(calls.length, 2, 'Explicit AI mode must send even a known question to the provider.');
  assert.ok(JSON.parse(calls[1].request.body).input.length > 1, 'AI conversation should carry recent context.');
  await shot('tobi-ai-chat-en-desktop');
  await audit('AI chat, English desktop');
  await assertNoSecret();
  console.log('PASS: notebook mode avoids API use; AI mode answers with the simulated provider and recent context');

  for (const value of ['ar', 'en']) {
    await language(value);
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(`${value} chat mobile`);
    await shot(`tobi-ai-chat-${value}-mobile`);
    await audit(`AI chat, ${value} mobile`);
    await studio();
    await language(value);
    await noOverflow(`${value} AI setup mobile`);
    await shot(`tobi-ai-configured-${value}-mobile`);
    await audit(`AI panel, ${value} mobile`);
    await goto('tobi.html#chat');
    await page.locator('#chat-input').waitFor();
  }
  console.log('PASS: Arabic and English chat/setup layouts fit mobile screens');

  await page.setViewportSize({ width: 1440, height: 1050 });
  await studio();
  await language('en');
  failure = true;
  await page.locator('[data-action=test-connection]').click();
  await page.locator('#connection-feedback.error').waitFor();
  assert.match(await page.locator('#connection-feedback').textContent(), /key/i);
  assert.equal(await page.locator('.connection-test-result.error').count(), 1);
  await assertNoSecret();
  assert.equal((await page.content()).includes('Never expose provider details'), false);
  await page.locator('[data-action=remove-connection]').click();
  await page.locator('#connection-feedback').filter({ hasText: 'Disconnected.' }).waitFor();
  assert.equal(await page.locator('[data-action=test-connection]').isDisabled(), true);
  assert.equal(await page.locator('[data-action=toggle-ai]').isDisabled(), true);
  const count = calls.length;
  await goto('tobi.html#chat');
  await page.locator('#chat-input').waitFor();
  assert.equal(await page.locator('[data-chat-mode=ai]').isDisabled(), false);
  await page.locator('[data-chat-mode=ai]').click();
  await page.locator('.chat-notice').filter({ hasText: /not connected|currently off/i }).waitFor();
  await page.locator('#chat-input').fill('Explain the icy rings around Saturn.');
  await page.locator('#chat-input').press('Enter');
  await page.locator('.bubble').filter({ hasText: 'I don’t have a notebook answer' }).waitFor();
  assert.equal(calls.length, count, 'Disconnect should leave free chat without another provider call.');
  assert.deepEqual(outgoing, []);
  assert.deepEqual(errors, []);
  if (audits.length) console.log(JSON.stringify(audits, null, 2));
  assert.equal(audits.length, 0, 'AI setup and chat must pass the selected accessibility rules.');
  console.log('PASS: actionable provider errors, disconnect/free fallback, secret checks, accessibility, and no external POSTs or JavaScript errors');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  assert.ok(path.resolve(dataDir).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dataDir).startsWith('aman-tobi-connection-browser-'));
  await rm(dataDir, { recursive: true, force: true });
}

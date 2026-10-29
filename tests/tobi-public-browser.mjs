import { listenForTests } from './helpers/http-server.mjs';
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp as createApplication } from '../server.js';

// This imported fixture never loads .env, and every provider request is mocked.
const dataDir = await mkdtemp(path.join(tmpdir(), 'aman-tobi-public-browser-'));
const fakeKey = 'sk-public-browser-owner-AAAAAAAAAAAAAAAAAAAA';
const defaultPolicy = { audience: 'public', siteDailyLimit: 50, visitorDailyLimit: 10, networkDailyLimit: 100 };
const customPolicy = { audience: 'public', siteDailyLimit: 60, visitorDailyLimit: 12, networkDailyLimit: 120 };
const calls = [], errors = [], outgoing = [], responseLeaks = [], audits = [];
const responseChecks = [];
const contexts = [];
let browser, server, base, releaseReply, replyGate;

function mockReply(text) {
  return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
}

async function newSession(label) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce' });
  contexts.push(context);
  await context.addInitScript(() => {
    if (!localStorage.getItem('aman-language')) localStorage.setItem('aman-language', 'en');
  });
  context.on('request', request => {
    if (request.method() !== 'GET' && new URL(request.url()).origin !== base) outgoing.push({ label, url: request.url() });
  });
  context.on('response', response => {
    if (new URL(response.url()).origin !== base || !response.url().includes('/api/')) return;
    responseChecks.push(response.text().then(body => {
      if (body.includes(fakeKey)) responseLeaks.push({ label, url: response.url() });
    }).catch(() => {}));
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push({ label, message: error.message }));
  return { label, context, page };
}

async function signup(session, email) {
  const response = await session.context.request.post(base + '/api/auth/signup', {
    data: { name: `${session.label} Test`, email, password: 'browser-only long test password' },
  });
  assert.equal(response.status(), 201);
}

async function goto(page, file) {
  await page.goto(`${base}/${file}`);
  await expect(page.locator('#tobi-main')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function chatPage(page) {
  await goto(page, 'tobi.html#chat');
  await expect(page.locator('#chat-input')).toBeVisible();
}

async function studioPage(page) {
  await goto(page, 'tobi-studio.html#ai');
  await expect(page.locator('#connection-form')).toBeVisible();
  await expect(page.locator('#ai-policy-form')).toBeVisible();
}

async function setLanguage(page, language) {
  if (await page.locator('html').getAttribute('lang') !== language) await page.locator('[data-action=language]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
}

async function clickAI(page) {
  const button = page.locator('[data-chat-mode=ai]');
  await expect(button).toBeEnabled();
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/tobi/config' && response.request().method() === 'GET'),
    button.click(),
  ]);
  assert.equal(response.status(), 200, 'Clicking AI should refresh the public configuration.');
  return response.json();
}

async function assertUnavailable(page, reason, explanation) {
  const before = calls.length;
  const refreshed = await clickAI(page);
  assert.equal(refreshed.aiAccess.ready, false);
  if (reason) assert.equal(refreshed.aiAccess.reason, reason);
  await expect(page.locator('[data-chat-mode=ai]')).toBeEnabled();
  await expect(page.locator('[data-chat-mode=ai]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.chat-notice')).toBeVisible();
  await expect(page.locator('.chat-notice')).toContainText(explanation);
  assert.equal(calls.length, before, 'An unavailable AI button should explain the next step without a provider request.');
}

async function sendAI(page, message) {
  const nextCall = calls.length + 1;
  await page.locator('#chat-input').fill(message);
  await page.locator('#chat-input').press('Enter');
  await expect(page.locator('.bubble').last()).toContainText(`Shared mock answer ${nextCall}:`);
  assert.equal(calls.length, nextCall);
  assert.equal(calls.at(-1).request.headers.Authorization, `Bearer ${fakeKey}`, 'Every visitor must use the owner connection on the server.');
  await expect(page.locator('[data-chat-mode=ai]')).toBeEnabled();
}

async function sendNotebook(page) {
  const before = calls.length;
  await page.locator('#chat-input').fill('What is your name?');
  await page.locator('#chat-input').press('Enter');
  await expect(page.locator('.bubble').last()).toContainText(/Tobi/);
  await expect(page.locator('.bubble').last().locator('small')).toContainText(/notebook/i);
  assert.equal(calls.length, before, 'Known notebook answers should remain free for guests.');
}

async function savePolicy(page, policy) {
  await page.locator('#ai-audience').selectOption(policy.audience);
  for (const field of ['siteDailyLimit', 'visitorDailyLimit', 'networkDailyLimit']) {
    await page.locator(`#ai-policy-form [name=${field}]`).fill(String(policy[field]));
  }
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/tobi/policy' && response.request().method() === 'PUT'),
    page.locator('#ai-policy-form button[type=submit]').click(),
  ]);
  assert.equal(response.status(), 200);
  assert.deepEqual(response.request().postDataJSON(), policy, 'The owner form must send the complete policy with numeric limits.');
  assert.deepEqual((await response.json()).policy, policy);
  await expect(page.getByText('Access settings saved.', { exact: true })).toBeVisible();
}

async function assertPolicyFields(page, policy) {
  await expect(page.locator('#ai-audience')).toHaveValue(policy.audience);
  for (const field of ['siteDailyLimit', 'visitorDailyLimit', 'networkDailyLimit']) {
    await expect(page.locator(`#ai-policy-form [name=${field}]`)).toHaveValue(String(policy[field]));
  }
}

async function assertNoSecret(session) {
  assert.equal((await session.page.content()).includes(fakeKey), false, `${session.label} page HTML must not contain the saved key.`);
  const hasBrowserSecret = await session.page.evaluate(key => {
    const storage = { local: { ...localStorage }, session: { ...sessionStorage }, cookies: document.cookie };
    const inputs = [...document.querySelectorAll('input, textarea')].map(input => input.value);
    return JSON.stringify({ storage, inputs }).includes(key);
  }, fakeKey);
  assert.equal(hasBrowserSecret, false, `${session.label} browser storage and form values must not contain the saved key.`);
  for (const route of ['/api/tobi/config', '/api/tobi/access', '/api/tobi/connection', '/api/tobi/policy', '/tobi.html', '/tobi-studio.html', '/tobi.js', '/tobi.bundle.js', '/tobi-content.js']) {
    const response = await session.context.request.get(base + route);
    assert.equal((await response.text()).includes(fakeKey), false, `${session.label}: ${route} must not disclose the saved key.`);
  }
}

async function assertNoOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  assert.ok(dimensions.content <= dimensions.viewport + 1, `${label} overflows: ${JSON.stringify(dimensions)}`);
}

async function audit(page, label, axeSource) {
  await page.evaluate(axeSource);
  const result = await page.evaluate(() => window.axe.run(document, {
    runOnly: { type: 'rule', values: ['color-contrast', 'button-name', 'label', 'aria-allowed-attr', 'aria-required-attr', 'aria-valid-attr', 'aria-valid-attr-value', 'html-has-lang', 'image-alt', 'link-name'] },
  }));
  audits.push({ label, violations: result.violations.map(item => ({
    id: item.id,
    nodes: item.nodes.map(node => ({ target: node.target, issue: node.failureSummary })),
  })) });
}

async function screenshot(page, name) {
  await page.screenshot({ path: `test-results/${name}.png`, fullPage: true });
}

try {
  server = await createApplication({
    dataDir,
    secureCookies: false,
    trustProxyHops: 0,
    tobiOptions: {
      apiKey: '',
      envOpenAIKey: '',
      model: 'gpt-5.6-luna',
      aiFetch: async (url, request) => {
        calls.push({ url, request });
        const number = calls.length;
        if (replyGate) await replyGate;
        return mockReply(`Shared mock answer ${number}: I can help you learn and stay safe.`);
      },
    },
  });
  await listenForTests(server);
  const port = server.address().port;
  base = `http://127.0.0.1:${port}`;
  const installedChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const executablePath = process.env.CHROME_PATH || (existsSync(installedChrome) ? installedChrome : undefined);
  browser = await chromium.launch({ executablePath, headless: process.env.TOBI_BROWSER_HEADED !== '1', args: [`--explicitly-allowed-ports=${port}`] });
  await mkdir('test-results', { recursive: true });
  const axeSource = await readFile('node_modules/axe-core/axe.min.js', 'utf8');
  const owner = await newSession('Owner');
  const guest = await newSession('Guest');
  const member = await newSession('Member');
  await signup(owner, 'public-browser-owner@example.test');
  await signup(member, 'public-browser-member@example.test');
  const code = (await readFile(path.join(dataDir, 'tobi-owner-code.txt'), 'utf8')).trim();
  assert.equal((await owner.context.request.post(base + '/api/tobi/claim', { data: { code } })).status(), 200);

  assert.deepEqual((await (await guest.context.request.get(base + '/api/tobi/config')).json()).aiAccess, { audience: 'public', ready: false, reason: 'disabled' });
  await chatPage(guest.page);
  await assertUnavailable(guest.page, 'disabled', /owner|connect|key|enable/i);
  await sendNotebook(guest.page);
  await screenshot(guest.page, 'tobi-public-unconfigured-en-desktop');
  console.log('PASS: unconfigured AI remains clickable, explains owner setup, and keeps notebook answers available');

  await studioPage(owner.page);
  await assertPolicyFields(owner.page, defaultPolicy);
  await savePolicy(owner.page, customPolicy);
  await owner.page.reload();
  await expect(owner.page.locator('#ai-policy-form')).toBeVisible();
  await assertPolicyFields(owner.page, customPolicy);
  assert.deepEqual((await (await owner.context.request.get(base + '/api/tobi/policy')).json()).policy, customPolicy);
  for (const session of [guest, member]) {
    const expectedStatus = session === guest ? 401 : 403;
    for (const route of ['/api/tobi/policy', '/api/tobi/connection']) {
      assert.equal((await session.context.request.get(base + route)).status(), expectedStatus);
    }
    assert.equal((await session.context.request.put(base + '/api/tobi/policy', { data: defaultPolicy })).status(), expectedStatus);
    await goto(session.page, 'tobi-studio.html#ai');
    await expect(session.page.locator('.studio-access')).toBeVisible();
    await expect(session.page.locator('#ai-policy-form')).toHaveCount(0);
    await expect(session.page.locator('#api-key')).toHaveCount(0);
  }
  console.log('PASS: the owner saves policy and all three limits across reload; guests and another member cannot configure AI');

  await owner.page.locator('#api-key').fill(fakeKey);
  await owner.page.locator('#ai-model').fill('gpt-5.6-luna');
  await owner.page.locator('#connection-form button[type=submit]').click();
  await expect(owner.page.locator('#connection-feedback')).toContainText('Saved.');
  await expect(owner.page.locator('#api-key')).toHaveValue('');
  assert.equal(calls.length, 0, 'Saving policy and a credential should never contact the provider.');
  await chatPage(guest.page);
  await assertUnavailable(guest.page, 'disabled', /owner|off|enable|turn/i);
  await owner.page.locator('[data-action=toggle-ai]').click();
  await expect(owner.page.locator('#connection-feedback')).toContainText('AI is on.');

  // Keep the guest's existing document: the AI button must refresh stale access itself.
  const refreshed = await clickAI(guest.page);
  assert.deepEqual(refreshed.aiAccess, { audience: 'public', ready: true, reason: null });
  await expect(guest.page.locator('[data-chat-mode=ai]')).toHaveAttribute('aria-pressed', 'true');
  assert.equal(calls.length, 0, 'Selecting AI must not use provider credit.');
  await expect(guest.page.locator('.chat-note')).toContainText(/OpenAI/);

  replyGate = new Promise(resolve => { releaseReply = resolve; });
  const guestReply = sendAI(guest.page, 'What is your name?');
  try {
    await expect.poll(() => calls.length).toBe(1);
    await expect(guest.page.locator('[data-chat-mode=ai]')).toBeDisabled();
    await expect(guest.page.locator('[data-chat-mode=auto]')).toBeDisabled();
  } finally {
    releaseReply();
    replyGate = null;
    releaseReply = null;
  }
  await guestReply;
  await chatPage(member.page);
  await clickAI(member.page);
  await expect(member.page.locator('[data-chat-mode=ai]')).toHaveAttribute('aria-pressed', 'true');
  await sendAI(member.page, 'Explain how a distant galaxy forms.');
  assert.equal(calls.length, 2, 'The guest and a second account should both receive AI replies.');
  for (const call of calls) assert.equal(call.request.headers.Authorization, `Bearer ${fakeKey}`);
  await screenshot(guest.page, 'tobi-public-guest-ai-en-desktop');
  await screenshot(member.page, 'tobi-public-member-ai-en-desktop');
  await audit(guest.page, 'public guest AI, English desktop', axeSource);
  console.log('PASS: a stale guest page activates AI without reload; guest and second member use the same owner key, and mode buttons only disable while replying');

  await savePolicy(owner.page, { ...customPolicy, audience: 'members' });
  await owner.page.reload();
  await expect(owner.page.locator('#ai-policy-form')).toBeVisible();
  await assertPolicyFields(owner.page, { ...customPolicy, audience: 'members' });
  await chatPage(guest.page);
  await assertUnavailable(guest.page, 'login_required', /log in|sign in/i);
  await expect(guest.page.locator('.chat-notice a')).toHaveAttribute('href', /login\.html/);
  await sendNotebook(guest.page);
  await screenshot(guest.page, 'tobi-public-members-login-en-desktop');
  await audit(guest.page, 'members policy login notice, English desktop', axeSource);
  await chatPage(member.page);
  assert.equal((await clickAI(member.page)).aiAccess.ready, true);
  await sendAI(member.page, 'How can I protect an account with a passkey?');
  assert.equal(calls.length, 3, 'Members-only access must block guests and continue to serve signed-in members.');
  console.log('PASS: members-only policy shows guests a login action and free notebook answers while another member still chats');

  await savePolicy(owner.page, customPolicy);
  await chatPage(guest.page);
  await clickAI(guest.page);
  await sendAI(guest.page, 'What should I do if someone is unkind online?');
  await screenshot(owner.page, 'tobi-public-policy-en-desktop');
  await audit(owner.page, 'owner access policy, English desktop', axeSource);
  for (const language of ['ar', 'en']) {
    for (const [page, label] of [[guest.page, 'guest-chat'], [owner.page, 'owner-policy']]) {
      await setLanguage(page, language);
      for (const width of [360, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await assertNoOverflow(page, `${language} ${label} at ${width}px`);
      }
      await screenshot(page, `tobi-public-${label}-${language}-mobile`);
      await audit(page, `${language} ${label}, mobile`, axeSource);
    }
  }
  console.log('PASS: Arabic and English guest chat and owner policy fit 360px and 390px mobile screens');

  for (const session of [owner, guest, member]) await assertNoSecret(session);
  for (const route of ['/server.js', '/tobi-service.js', '/tobi-ai.js', '/tobi-public.js', '/.env', '/.data/aman.sqlite', '/.data/tobi-keyring.bin', '/.data/tobi-visitor-secret.bin']) {
    const response = await guest.context.request.get(base + route);
    assert.equal(response.status(), 404, `Private resource ${route} must not be publicly served.`);
    assert.equal((await response.text()).includes(fakeKey), false);
  }
  for (const session of [guest, member]) {
    for (const route of ['/api/tobi/config', '/api/tobi/access']) {
      const body = await (await session.context.request.get(base + route)).json();
      for (const field of ['connection', 'keyConfigured', 'model', 'usage', 'policy']) assert.equal(body[field], undefined, `${route} must omit owner-only field ${field}.`);
    }
  }

  await setLanguage(owner.page, 'en');
  await owner.page.locator('[data-action=toggle-ai]').click();
  await expect(owner.page.locator('#connection-feedback')).toContainText('AI is off.');
  await chatPage(guest.page);
  await assertUnavailable(guest.page, 'disabled', /owner|off|enable|turn/i);

  // Leave this guest document open while the owner teaches a new notebook answer.
  const taughtAnswer = {
    id: 'browser-comet-badge',
    q: { en: 'What is the comet badge?', ar: 'ما هي شارة المذنب؟' },
    answer: { en: 'The comet badge is a newly taught notebook answer.', ar: 'شارة المذنب إجابة جديدة تمت إضافتها إلى الدفتر.' },
    keywords: ['comet badge', 'شارة المذنب'],
  };
  const notebookState = await (await owner.context.request.get(base + '/api/tobi/admin')).json();
  assert.equal(notebookState.config.openAIEnabled, false);
  assert.equal(notebookState.config.answers.some(answer => answer.id === taughtAnswer.id), false);
  const taught = await owner.context.request.put(base + '/api/tobi/admin', {
    data: { revision: notebookState.revision, config: { ...notebookState.config, answers: [...notebookState.config.answers, taughtAnswer] } },
  });
  assert.equal(taught.status(), 200);
  const beforeTaughtReply = calls.length;
  const beforeTaughtBubbles = await guest.page.locator('.bubble').count();
  const chatRequests = [];
  const collectChat = request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/tobi/chat') chatRequests.push(request.url());
  };
  guest.page.on('request', collectChat);
  try {
    await guest.page.locator('#chat-input').fill(taughtAnswer.q.en);
    const [refresh] = await Promise.all([
      guest.page.waitForResponse(response => new URL(response.url()).pathname === '/api/tobi/config' && response.request().method() === 'GET'),
      guest.page.locator('#chat-input').press('Enter'),
    ]);
    assert.equal(refresh.status(), 200);
    const refreshedNotebook = await refresh.json();
    assert.equal(refreshedNotebook.aiAccess.ready, false);
    assert.deepEqual(refreshedNotebook.config.answers.find(answer => answer.id === taughtAnswer.id), taughtAnswer);
    await expect(guest.page.locator('.bubble').last()).toContainText(taughtAnswer.answer.en);
    await expect(guest.page.locator('.bubble').last().locator('small')).toContainText(/notebook/i);
    await expect(guest.page.locator('.bubble')).toHaveCount(beforeTaughtBubbles + 2);
    await expect(guest.page.locator('.chat-notice')).toHaveCount(0);
    assert.equal(calls.length, beforeTaughtReply, 'A newly taught notebook answer must work on the first attempt without provider credit.');
    assert.deepEqual(chatRequests, [], 'The refreshed notebook answer should be handled locally without an AI chat request.');
  } finally {
    guest.page.off('request', collectChat);
  }
  console.log('PASS: a stale guest tab finds a newly taught notebook answer on its first attempt while AI is off');

  const beforeDisconnect = calls.length;
  await owner.page.locator('[data-action=remove-connection]').click();
  await expect(owner.page.locator('#connection-feedback')).toContainText('Disconnected.');
  await chatPage(guest.page);
  await assertUnavailable(guest.page, 'disabled', /owner|connect|key|enable/i);
  await sendNotebook(guest.page);
  assert.equal(calls.length, beforeDisconnect, 'Turning off or disconnecting AI must not start a provider call.');
  await Promise.all(responseChecks);
  assert.deepEqual(responseLeaks, [], 'API responses rendered in any browser context must not contain the credential.');
  assert.deepEqual(outgoing, [], 'Browsers must never send provider requests or credentials off-site.');
  assert.deepEqual(errors, [], 'Public AI and policy flows must not introduce JavaScript errors.');
  const violations = audits.filter(audit => audit.violations.length);
  if (violations.length) console.log(JSON.stringify(violations, null, 2));
  assert.deepEqual(violations, [], 'Public chat and policy controls must pass the selected accessibility and contrast rules.');
  console.log('PASS: disabled/disconnected AI is actionable, secrets stay private, and all selected accessibility checks pass');
} finally {
  releaseReply?.();
  await writeFile('test-results/tobi-public-a11y.json', JSON.stringify(audits, null, 2)).catch(() => {});
  await Promise.all(contexts.map(context => context.close()));
  if (browser) await browser.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  const resolved = path.resolve(dataDir);
  assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(resolved).startsWith('aman-tobi-public-browser-'));
  await rm(resolved, { recursive: true, force: true });
}

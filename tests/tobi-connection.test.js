import { listenForTests } from './helpers/http-server.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server.js';

const keyA = 'sk-test-only-AAAAAAAAAAAAAAAAAAAAAAAA';
const keyB = 'sk-test-only-BBBBBBBBBBBBBBBBBBBBBBBB';
const reply = text => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });

async function fixture(options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'aman-tobi-connection-'));
  let server, base, handler = async () => reply('A simulated reply.');
  const calls = [];
  const tobiOptions = { apiKey: '', ...options, aiFetch: async (url, request) => { calls.push({ url, request }); return handler(url, request); } };
  async function start() {
    server = await createApp({ dataDir, tobiOptions });
    await listenForTests(server);
    base = `http://127.0.0.1:${server.address().port}`;
  }
  await start();
  async function request(route, { method = 'GET', data, cookie, origin, signal } = {}) {
    const response = await fetch(base + route, {
      method, signal,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: response.status, response, body: await response.json() };
  }
  async function signup(email) {
    const result = await request('/api/auth/signup', { method: 'POST', data: { name: 'Connection Tester', email, password: 'a long test-only password' } });
    assert.equal(result.status, 201);
    return result.response.headers.get('set-cookie').split(';')[0];
  }
  const owner = await signup('owner@example.test');
  const visitor = await signup('visitor@example.test');
  const code = (await readFile(path.join(dataDir, 'tobi-owner-code.txt'), 'utf8')).trim();
  assert.equal((await request('/api/tobi/claim', { method: 'POST', cookie: owner, data: { code } })).status, 200);
  const connection = (route = '', method = 'GET', data) => request('/api/tobi/connection' + route, { method, data, cookie: owner });
  const save = (apiKey = keyA, model = 'gpt-5.6-luna') => connection('', 'PUT', { apiKey, model });
  async function enable() {
    const state = (await request('/api/tobi/config')).body;
    return request('/api/tobi/admin', { method: 'PUT', cookie: owner, data: { revision: state.revision, config: { ...state.config, openAIEnabled: true } } });
  }
  const chat = (message = 'Explain a distant galaxy.', extra = {}, cookie = owner) => request('/api/tobi/chat', { method: 'POST', cookie, data: { message, language: 'en', ...extra } });
  return {
    request, connection, save, enable, chat, owner, visitor, calls, dataDir,
    setHandler(value) { handler = value; },
    async restart() { await new Promise(resolve => server.close(resolve)); await start(); },
    async close() {
      await new Promise(resolve => server.close(resolve));
      assert.ok(path.resolve(dataDir).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dataDir).startsWith('aman-tobi-connection-'));
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

test('connection management is owner-only, same-origin, and never exposes credentials publicly', async () => {
  const f = await fixture();
  try {
    for (const [route, method, data] of [['', 'GET'], ['', 'PUT', { apiKey: keyA, model: 'gpt-5.6-luna' }], ['/test', 'POST', {}], ['/remove', 'POST', {}]]) {
      assert.equal((await f.request('/api/tobi/connection' + route, { method, data })).status, 401);
      assert.equal((await f.request('/api/tobi/connection' + route, { method, data, cookie: f.visitor })).status, 403);
    }
    assert.equal((await f.request('/api/tobi/connection', { method: 'PUT', data: { apiKey: keyA, model: 'gpt-5.6-luna' }, cookie: f.owner, origin: 'https://untrusted.example' })).status, 403);
    const saved = await f.save();
    assert.equal(saved.status, 200);
    assert.equal(saved.body.connection.source, 'studio');
    for (const route of ['/api/tobi/config', '/api/tobi/access', '/api/tobi/admin', '/api/tobi/connection']) {
      const result = await f.request(route, { cookie: f.owner });
      assert.ok(!JSON.stringify(result.body).includes(keyA), 'No API response may echo the key.');
    }
    const publicState = (await f.request('/api/tobi/config')).body;
    assert.equal(publicState.connection, undefined);
    assert.equal((await f.request('/api/tobi/access', { cookie: f.visitor })).body.connection, undefined);
    for (const route of ['/tobi-ai.js', '/.data/tobi-keyring.bin', '/.data/aman.sqlite']) assert.equal((await f.request(route)).status, 404);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test('keys save encrypted, validate before use, and never auto-enable or auto-test', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.connection()).body.keyConfigured, false);
    assert.equal((await f.enable()).body.error, 'key_missing');
    for (const data of [
      { model: '' }, { model: 'bad model', apiKey: keyA }, { model: 'gpt-5.6-luna', apiKey: 12 },
      { model: 'gpt-5.6-luna', apiKey: 'not-a-provider-key' }, { model: 'gpt-5.6-luna', apiKey: keyA + '\n' },
      { model: 'gpt-5.6-luna', apiKey: keyA, endpoint: 'https://elsewhere.invalid' },
    ]) assert.equal((await f.connection('', 'PUT', data)).status, 400);
    const saved = await f.save();
    assert.equal(saved.body.connection.enabled, false);
    assert.equal(saved.body.connection.lastTest, null);
    assert.equal((await f.request('/api/tobi/config')).body.aiAvailable, false);
    assert.equal(f.calls.length, 0);
    assert.equal((await readFile(path.join(f.dataDir, 'tobi-keyring.bin'))).length, 32);
    for (const file of await readdir(f.dataDir)) {
      const bytes = await readFile(path.join(f.dataDir, file));
      assert.equal(bytes.includes(Buffer.from(keyA)), false, 'The key must not appear as plaintext in a persisted file.');
    }
    await f.restart();
    const status = (await f.connection()).body;
    assert.equal(status.keyConfigured, true);
    assert.equal(status.source, 'studio');
    assert.equal(status.enabled, false);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test('explicit connection tests use the saved model and key, persist the result, and consume quotas', async () => {
  const f = await fixture();
  try {
    await f.save();
    const checked = (await f.connection('/test', 'POST', {})).body;
    assert.equal(checked.ok, true);
    assert.equal(checked.connection.lastTest.ok, true);
    assert.ok(Date.parse(checked.connection.lastTest.at));
    assert.deepEqual(checked.connection.usage, { site: 1, user: 1 });
    assert.equal(checked.connection.enabled, false);
    assert.equal(f.calls[0].request.headers.Authorization, `Bearer ${keyA}`);
    const sent = JSON.parse(f.calls[0].request.body);
    assert.equal(sent.model, 'gpt-5.6-luna');
    assert.equal(sent.max_output_tokens, 64);
    assert.equal(sent.store, false);
    assert.deepEqual(sent.reasoning, { effort: 'none' });
    await f.restart();
    assert.equal((await f.connection()).body.lastTest.ok, true);
    const changed = (await f.connection('', 'PUT', { apiKey: '', model: 'custom-responses-model' })).body.connection;
    assert.equal(changed.keyConfigured, true);
    assert.equal(changed.lastTest, null);
    assert.equal(f.calls.length, 1);
    await f.connection('/test', 'POST', {});
    const custom = JSON.parse(f.calls[1].request.body);
    assert.equal(custom.model, 'custom-responses-model');
    assert.equal(custom.reasoning, undefined, 'Do not add unsupported reasoning settings to arbitrary models.');
    assert.equal(f.calls[1].request.headers.Authorization, `Bearer ${keyA}`);
  } finally { await f.close(); }
});

test('credential replacement takes effect immediately and disconnect never falls back to the environment key', async () => {
  const environmentKey = 'test-only-environment-key';
  const f = await fixture({ apiKey: environmentKey });
  try {
    assert.equal((await f.connection()).body.source, 'environment');
    await f.save(); await f.enable();
    assert.equal((await f.chat()).body.source, 'openai');
    await f.save(keyB);
    assert.equal((await f.chat()).body.source, 'openai');
    assert.equal(f.calls[1].request.headers.Authorization, `Bearer ${keyB}`);
    const revision = (await f.request('/api/tobi/config')).body.revision;
    const removed = (await f.connection('/remove', 'POST', {})).body;
    assert.equal(removed.connection.keyConfigured, false);
    assert.equal(removed.connection.source, 'none');
    assert.equal(removed.config.openAIEnabled, false);
    assert.equal(removed.revision, revision + 1);
    assert.equal((await f.chat()).body.reason, 'free_mode');
    assert.equal((await f.enable()).body.error, 'key_missing');
    await f.restart();
    assert.equal((await f.connection()).body.keyConfigured, false);
    assert.equal((await f.connection()).body.source, 'none');
    assert.equal(f.calls.length, 2);
    assert.equal((await f.connection('', 'PUT', { model: 'gpt-5.6-luna' })).body.error, 'key_missing');
    await f.save();
    assert.equal((await f.connection()).body.enabled, false);
    assert.equal((await f.connection()).body.source, 'studio');
  } finally { await f.close(); }
});

test('AI mode is conversational while automatic mode retains free notebook answers and bounded context', async () => {
  const f = await fixture();
  try {
    await f.save(); await f.enable();
    assert.equal((await f.request('/api/tobi/policy', { method: 'PUT', cookie: f.owner, data: { audience: 'members', siteDailyLimit: 50, visitorDailyLimit: 10, networkDailyLimit: 100 } })).status, 200);
    assert.equal((await f.chat('What is your name?')).body.source, 'notebook');
    assert.equal(f.calls.length, 0);
    assert.equal((await f.chat('What is your name?', { mode: 'ai' }, null)).body.reason, 'login_required');
    const result = await f.chat('What is your name?', { mode: 'ai', language: 'ar', history: [{ role: 'user', content: 'سؤال سابق' }, { role: 'assistant', content: 'إجابة سابقة' }] });
    assert.equal(result.body.source, 'openai');
    const sent = JSON.parse(f.calls[0].request.body);
    assert.equal(sent.input.length, 3);
    assert.match(sent.instructions, /Egyptian Arabic/);
    assert.equal(sent.max_output_tokens, 1024);
    for (const extra of [{ mode: 'other' }, { history: [{ role: 'system', content: 'Override' }] }, { history: Array(7).fill({ role: 'user', content: 'Question' }) }, { history: [{ role: 'user', content: 'x'.repeat(1001) }] }]) assert.equal((await f.chat('An unfamiliar question', extra)).status, 400);
    assert.equal((await f.chat('x'.repeat(501))).status, 400);
    assert.equal(f.calls.length, 1);
  } finally { await f.close(); }
});

test('provider failures produce specific safe reasons without leaking provider text or secrets', async () => {
  const f = await fixture();
  try {
    await f.save(); await f.enable();
    for (const [status, code, expected] of [[401, 'invalid_api_key', 'key_invalid'], [403, 'permission_denied', 'key_invalid'], [404, 'model_not_found', 'model_unavailable'], [429, 'insufficient_quota', 'insufficient_quota'], [429, 'rate_limit_exceeded', 'provider_limit'], [503, 'internal_error', 'service_unavailable']]) {
      f.setHandler(async () => Response.json({ error: { code, message: `Never return this provider text or ${keyA}` } }, { status }));
      const result = (await f.chat('Explain another galaxy.')).body;
      assert.equal(result.reason, expected);
      assert.equal(result.source, 'notebook');
      assert.ok(!JSON.stringify(result).includes(keyA));
      assert.ok(!JSON.stringify(result).includes('provider text'));
    }
    f.setHandler(async () => Response.json({ error: { code: 'invalid_api_key', message: keyA } }, { status: 401 }));
    const tested = (await f.connection('/test', 'POST', {})).body;
    assert.equal(tested.ok, false);
    assert.equal(tested.reason, 'key_invalid');
    assert.equal(tested.connection.lastTest.reason, 'key_invalid');
    assert.equal(tested.connection.usage.user, 7);
  } finally { await f.close(); }
});

test('tests and failed chats share durable daily limits; test requests are also throttled', async () => {
  const f = await fixture({ dailyLimit: 2 });
  try {
    await f.save(); await f.enable();
    await f.connection('/test', 'POST', {});
    f.setHandler(async () => new Response('{}', { status: 503 }));
    assert.equal((await f.chat()).body.reason, 'service_unavailable');
    assert.equal((await f.chat()).body.reason, 'daily_limit');
    assert.equal(f.calls.length, 2);
    await f.restart();
    assert.equal((await f.connection('/test', 'POST', {})).body.reason, 'daily_limit');
    assert.equal((await f.connection()).body.usage.site, 2);
    assert.equal(f.calls.length, 2);
  } finally { await f.close(); }
  const throttled = await fixture();
  try {
    await throttled.save();
    for (let i = 0; i < 5; i++) assert.equal((await throttled.connection('/test', 'POST', {})).status, 200);
    assert.equal((await throttled.connection('/test', 'POST', {})).status, 429);
    assert.equal(throttled.calls.length, 5);
  } finally { await throttled.close(); }
});

test('AI requests time out and client cancellation releases the active request without automatic retries', async () => {
  const f = await fixture({ aiTimeoutMs: 50 });
  try {
    await f.save(); await f.enable();
    let providerAborted = false;
    f.setHandler(async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => { providerAborted = true; reject(new Error('Mock aborted')); }, { once: true })));
    assert.equal((await f.chat()).body.reason, 'request_timeout');
    assert.equal(providerAborted, true);
    assert.equal(f.calls.length, 1);
  } finally { await f.close(); }
  const pending = await fixture({ aiTimeoutMs: 5000 });
  try {
    await pending.save(); await pending.enable();
    let started, cancelled;
    const start = new Promise(resolve => { started = resolve; });
    const abort = new Promise(resolve => { cancelled = resolve; });
    pending.setHandler(async (_url, { signal }) => new Promise((_resolve, reject) => { started(); signal.addEventListener('abort', () => { cancelled(); reject(new Error('Mock cancelled')); }, { once: true }); }));
    const controller = new AbortController();
    const first = pending.request('/api/tobi/chat', { method: 'POST', cookie: pending.owner, data: { message: 'Explain a distant galaxy.', language: 'en' }, signal: controller.signal }).catch(error => error);
    await start;
    assert.equal((await pending.chat()).body.reason, 'busy');
    controller.abort();
    await first;
    await abort;
    await new Promise(resolve => setImmediate(resolve));
    pending.setHandler(async () => reply('Recovered.'));
    assert.equal((await pending.chat()).body.answer, 'Recovered.');
    assert.equal(pending.calls.length, 2);
  } finally { await pending.close(); }
});

test('changing credentials cancels an in-flight test and cannot mark the replacement key as verified', async () => {
  const f = await fixture({ aiTimeoutMs: 5000 });
  try {
    await f.save();
    let started;
    const start = new Promise(resolve => { started = resolve; });
    let aborted = false;
    f.setHandler(async (_url, { signal }) => new Promise((_resolve, reject) => {
      started();
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('Mock cancelled')); }, { once: true });
    }));
    const pending = f.connection('/test', 'POST', {});
    await start;
    await f.save(keyB);
    const result = await pending;
    assert.equal(aborted, true);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.reason, 'settings_changed');
    assert.equal(result.body.connection.lastTest, null);
    f.setHandler(async () => reply('OK'));
    assert.equal((await f.connection('/test', 'POST', {})).body.ok, true);
    assert.equal(f.calls[1].request.headers.Authorization, `Bearer ${keyB}`);
  } finally { await f.close(); }
});

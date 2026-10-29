import { listenForTests } from './helpers/http-server.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';
import { clientAddress, parseTrustProxyHops } from '../tobi-public.js';

const fakeKey = 'sk-test-only-public-owner-AAAAAAAAAAAA';
const reply = text => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const defaultPolicy = { audience: 'public', siteDailyLimit: 50, visitorDailyLimit: 10, networkDailyLimit: 100 };

async function fixture({ appOptions = {}, tobiOptions = {} } = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'aman-tobi-public-'));
  let server, base, handler = async () => reply('A simulated public answer.');
  const calls = [];
  async function start() {
    server = await createApp({ dataDir, secureCookies: false, trustProxyHops: 0, ...appOptions, tobiOptions: { apiKey: fakeKey, ...tobiOptions, aiFetch: async (url, request) => { calls.push({ url, request }); return handler(url, request); } } });
    await listenForTests(server);
    base = `http://127.0.0.1:${server.address().port}`;
  }
  await start();
  async function request(route, { method = 'GET', data, cookie, headers = {} } = {}) {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { response, status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function signup(email) {
    const result = await request('/api/auth/signup', { method: 'POST', data: { name: 'Public Test', email, password: 'long test-only password' } });
    assert.equal(result.status, 201);
    return result.cookie;
  }
  const owner = await signup('owner@example.test');
  const member = await signup('member@example.test');
  const code = (await readFile(path.join(dataDir, 'tobi-owner-code.txt'), 'utf8')).trim();
  assert.equal((await request('/api/tobi/claim', { method: 'POST', cookie: owner, data: { code } })).status, 200);
  const policy = values => request('/api/tobi/policy', { method: 'PUT', cookie: owner, data: { ...defaultPolicy, ...values } });
  async function configure(values) {
    const state = (await request('/api/tobi/config')).body;
    return request('/api/tobi/admin', { method: 'PUT', cookie: owner, data: { revision: state.revision, config: { ...state.config, ...values } } });
  }
  const chat = (cookie, headers = {}) => request('/api/tobi/chat', { method: 'POST', cookie, headers, data: { message: 'Explain a distant galaxy.', language: 'en', mode: 'ai' } });
  const connection = () => request('/api/tobi/connection', { cookie: owner });
  return {
    request, signup, policy, configure, chat, connection, owner, member, dataDir, calls,
    get base() { return base; },
    setHandler(next) { handler = next; },
    async restart() { await new Promise(resolve => server.close(resolve)); await start(); },
    async close() {
      await new Promise(resolve => server.close(resolve));
      assert.ok(path.resolve(dataDir).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dataDir).startsWith('aman-tobi-public-'));
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

test('shared AI is opt-in, then guests use the owner key without receiving private configuration', async () => {
  const f = await fixture({ appOptions: { secureCookies: true } });
  try {
    assert.deepEqual((await f.request('/api/health')).body, { ok: true, service: 'aman' });
    assert.deepEqual((await f.request('/api/tobi/config')).body.aiAccess, { audience: 'public', ready: false, reason: 'disabled' });
    assert.equal((await f.chat()).body.reason, 'free_mode');
    assert.equal(f.calls.length, 0);
    assert.equal((await f.configure({ openAIEnabled: true })).status, 200);
    for (const route of ['/api/tobi/config', '/api/tobi/access']) {
      const state = (await f.request(route)).body;
      assert.equal(state.aiAvailable, true);
      assert.deepEqual(state.aiAccess, { audience: 'public', ready: true, reason: null });
      for (const privateField of ['connection', 'keyConfigured', 'model', 'usage', 'policy']) assert.equal(state[privateField], undefined);
      assert.ok(!JSON.stringify(state).includes(fakeKey));
    }
    const guest = await f.chat();
    assert.equal(guest.body.source, 'openai');
    assert.equal(guest.body.answer, 'A simulated public answer.');
    assert.match(guest.cookie, /^aman_tobi_visitor=v1\.[a-f0-9]{64}\.[a-f0-9]{64}$/);
    const setCookie = guest.response.headers.get('set-cookie');
    for (const attribute of ['HttpOnly', 'SameSite=Lax', 'Path=/api/tobi', 'Secure']) assert.ok(setCookie.includes(attribute));
    assert.equal(f.calls[0].request.headers.Authorization, `Bearer ${fakeKey}`);
    assert.equal((await f.chat(f.member)).body.source, 'openai');
    assert.equal(f.calls[1].request.headers.Authorization, `Bearer ${fakeKey}`);
    for (const route of ['/tobi-public.js', '/.data/tobi-visitor-secret.bin']) assert.equal((await f.request(route)).status, 404);
    assert.ok(!JSON.stringify(guest.body).includes(fakeKey));
  } finally { await f.close(); }
});

test('only the owner changes validated policy; member-only mode still allows notebook answers', async () => {
  const f = await fixture();
  try {
    assert.deepEqual((await f.request('/api/tobi/policy', { cookie: f.owner })).body.policy, defaultPolicy);
    for (const method of ['GET', 'PUT']) {
      assert.equal((await f.request('/api/tobi/policy', { method, ...(method === 'PUT' ? { data: defaultPolicy } : {}) })).status, 401);
      assert.equal((await f.request('/api/tobi/policy', { method, cookie: f.member, ...(method === 'PUT' ? { data: defaultPolicy } : {}) })).status, 403);
    }
    assert.equal((await f.request('/api/tobi/policy', { method: 'PUT', cookie: f.owner, data: defaultPolicy, headers: { Origin: 'https://untrusted.example' } })).status, 403);
    const invalid = [null, {}, { ...defaultPolicy, audience: 'everyone' }, { ...defaultPolicy, siteDailyLimit: 0 }, { ...defaultPolicy, siteDailyLimit: 10001 }, { ...defaultPolicy, visitorDailyLimit: 1001 }, { ...defaultPolicy, networkDailyLimit: 10001 }, { ...defaultPolicy, networkDailyLimit: -1 }, { ...defaultPolicy, visitorDailyLimit: 1.5 }, { ...defaultPolicy, visitorDailyLimit: '10' }, { ...defaultPolicy, extra: true }];
    for (const data of invalid) assert.equal((await f.request('/api/tobi/policy', { method: 'PUT', cookie: f.owner, data })).status, 400);
    const saved = (await f.policy({ audience: 'members', siteDailyLimit: 7, visitorDailyLimit: 20, networkDailyLimit: 40 })).body;
    assert.equal(saved.connection.dailyLimit, 7);
    assert.equal(saved.connection.userDailyLimit, 20);
    assert.deepEqual(saved.connection.policy, saved.policy);
    await f.configure({ openAIEnabled: true });
    const guestAccess = (await f.request('/api/tobi/config')).body;
    assert.equal(guestAccess.aiAvailable, true);
    assert.deepEqual(guestAccess.aiAccess, { audience: 'members', ready: false, reason: 'login_required' });
    assert.equal((await f.chat()).body.reason, 'login_required');
    assert.equal((await f.request('/api/tobi/chat', { method: 'POST', data: { message: 'What is your name?', language: 'en' } })).body.source, 'notebook');
    assert.equal(f.calls.length, 0);
    assert.equal((await f.request('/api/tobi/access', { cookie: f.member })).body.aiAccess.ready, true);
    assert.equal((await f.chat(f.member)).body.source, 'openai');
    await f.restart();
    assert.equal((await f.request('/api/tobi/config')).body.aiAccess.audience, 'members');
    assert.equal((await f.connection()).body.policy.siteDailyLimit, 7);
  } finally { await f.close(); }
});

test('signed guest identity and daily budgets survive restart; failures reserve a request without retries', async () => {
  const f = await fixture();
  try {
    await f.policy({ visitorDailyLimit: 2 });
    await f.configure({ openAIEnabled: true });
    const first = await f.chat();
    const cookie = first.cookie;
    assert.equal(first.body.source, 'openai');
    f.setHandler(async () => new Response('{}', { status: 503 }));
    assert.equal((await f.chat(cookie)).body.reason, 'service_unavailable');
    assert.equal((await f.chat(cookie)).body.reason, 'visitor_limit');
    assert.equal(f.calls.length, 2);
    await f.restart();
    const blocked = await f.chat(cookie);
    assert.equal(blocked.body.reason, 'visitor_limit');
    assert.equal(blocked.cookie, undefined, 'Valid signed identities survive restart without replacement.');
    f.setHandler(async () => reply('Another visitor.'));
    assert.equal((await f.chat()).body.source, 'openai');
    assert.equal((await f.chat(f.member)).body.source, 'openai');
    assert.equal((await f.connection()).body.usage.site, 4);
    assert.equal(f.calls.length, 4);
    const db = new DatabaseSync(path.join(f.dataDir, 'aman.sqlite'), { readOnly: true });
    try {
      const networks = db.prepare('SELECT network_id FROM tobi_network_usage').all();
      assert.equal(networks.length, 1);
      assert.match(networks[0].network_id, /^[a-f0-9]{64}$/);
      const guests = db.prepare("SELECT user_id FROM tobi_usage WHERE user_id LIKE 'guest:%'").all();
      assert.equal(guests.length, 2);
      for (const guest of guests) assert.ok(!guest.user_id.includes(cookie.split('.')[1]));
    } finally { db.close(); }
  } finally { await f.close(); }
});

test('forged or cleared cookies cannot bypass network limits; owner tests use the same network budget', async () => {
  const f = await fixture();
  try {
    await f.policy({ networkDailyLimit: 2 });
    await f.configure({ openAIEnabled: true });
    assert.equal((await f.request('/api/tobi/connection/test', { method: 'POST', cookie: f.owner, data: {} })).body.ok, true);
    const first = await f.chat();
    assert.equal(first.body.source, 'openai');
    const forged = first.cookie.replace(/\.[a-f0-9]{64}$/, '.' + '0'.repeat(64));
    const blocked = await f.chat(forged);
    assert.equal(blocked.body.reason, 'network_limit');
    assert.ok(blocked.cookie && blocked.cookie !== forged);
    assert.equal((await f.chat()).body.reason, 'network_limit');
    assert.equal((await f.chat(f.member)).body.reason, 'network_limit');
    assert.equal(f.calls.length, 2);
    await f.restart();
    assert.equal((await f.chat()).body.reason, 'network_limit');
    assert.equal(f.calls.length, 2);
  } finally { await f.close(); }
});

test('the site budget caps the combined traffic of guests and members before provider calls', async () => {
  const f = await fixture({ tobiOptions: { dailyLimit: 2 } });
  try {
    assert.equal((await f.connection()).body.policy.siteDailyLimit, 2);
    await f.configure({ openAIEnabled: true });
    assert.equal((await f.chat()).body.source, 'openai');
    assert.equal((await f.chat(f.member)).body.source, 'openai');
    assert.equal((await f.chat(f.owner)).body.reason, 'daily_limit');
    assert.equal((await f.chat()).body.reason, 'daily_limit');
    assert.equal(f.calls.length, 2);
  } finally { await f.close(); }
});

test('only three site requests run at once; rejected concurrency does not consume a budget', async () => {
  const f = await fixture();
  try {
    await f.configure({ openAIEnabled: true });
    let started;
    const allStarted = new Promise(resolve => { started = resolve; });
    const releases = [];
    f.setHandler(async () => new Promise(resolve => {
      releases.push(() => resolve(reply('Completed.')));
      if (releases.length === 3) started();
    }));
    const pending = [f.chat(), f.chat(f.owner), f.chat(f.member)];
    await allStarted;
    assert.equal((await f.chat()).body.reason, 'busy');
    assert.equal((await f.connection()).body.usage.site, 3);
    for (const release of releases) release();
    for (const result of await Promise.all(pending)) assert.equal(result.body.source, 'openai');
    f.setHandler(async () => reply('Capacity restored.'));
    assert.equal((await f.chat()).body.answer, 'Capacity restored.');
    assert.equal(f.calls.length, 4);
  } finally { await f.close(); }
});

test('switching to members mode cancels guest requests and blocks further guest provider calls', async () => {
  const f = await fixture();
  try {
    await f.configure({ openAIEnabled: true });
    let started, aborted = false;
    const start = new Promise(resolve => { started = resolve; });
    f.setHandler(async (_url, { signal }) => new Promise((_resolve, reject) => {
      started();
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('Mock cancelled')); }, { once: true });
    }));
    const pending = f.chat();
    await start;
    await f.policy({ audience: 'members' });
    assert.equal((await pending).body.reason, 'request_timeout');
    assert.equal(aborted, true);
    assert.equal((await f.chat()).body.reason, 'login_required');
    assert.equal(f.calls.length, 1);
  } finally { await f.close(); }
});

test('a delayed request body cannot start AI after the owner disables chat', async () => {
  const f = await fixture();
  try {
    await f.configure({ openAIEnabled: true });
    let request;
    const pending = new Promise((resolve, reject) => {
      request = http.request(f.base + '/api/tobi/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, response => {
        let text = '';
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
      });
      request.on('error', reject);
      request.write('{"message":"Explain a galaxy.",');
    });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal((await f.configure({ chatEnabled: false })).status, 200);
    request.end('"language":"en","mode":"ai"}');
    const result = await pending;
    assert.equal(result.status, 403);
    assert.equal(result.body.error, 'activity_disabled');
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test('proxy trust is explicit, bounded, and ignores client-controlled prefixes', () => {
  for (const value of [undefined, 0, '0', 1, '2', 10]) assert.equal(parseTrustProxyHops(value), Number(value || 0));
  for (const value of [-1, 11, 1.5, 'true', '01', '1 ', '', null, false]) assert.throws(() => parseTrustProxyHops(value), /TRUST_PROXY_HOPS/);
  const req = forwarded => ({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { 'x-forwarded-for': forwarded } });
  assert.equal(clientAddress(req('198.51.100.8')), '127.0.0.1');
  assert.equal(clientAddress(req('198.51.100.8'), 1), '198.51.100.8');
  assert.equal(clientAddress(req('spoofed, 198.51.100.8'), 1), '198.51.100.8');
  assert.equal(clientAddress(req('203.0.113.1, 198.51.100.8, 192.0.2.4'), 2), '198.51.100.8');
  assert.equal(clientAddress(req('198.51.100.8'), 2), '127.0.0.1');
  assert.equal(clientAddress(req('not-an-ip'), 1), '127.0.0.1');
  assert.equal(clientAddress(req('2001:0db8:0:0:0:0:0:0001'), 1), '2001:db8::1');
  assert.equal(clientAddress(req('::ffff:192.0.2.8'), 1), '192.0.2.8');
});

test('network quotas and auth throttles both use the configured proxy address', async () => {
  for (const trustProxyHops of [0, 1]) {
    const f = await fixture({ appOptions: { trustProxyHops } });
    try {
      await f.policy({ networkDailyLimit: 1 });
      await f.configure({ openAIEnabled: true });
      assert.equal((await f.chat(undefined, { 'X-Forwarded-For': '198.51.100.1' })).body.source, 'openai');
      const other = await f.chat(undefined, { 'X-Forwarded-For': '198.51.100.2' });
      assert.equal(other.body.source, trustProxyHops ? 'openai' : 'notebook');
      if (!trustProxyHops) assert.equal(other.body.reason, 'network_limit');
      const login = address => f.request('/api/auth/login', { method: 'POST', data: { email: 'invalid', password: 'invalid' }, headers: { 'X-Forwarded-For': address } });
      for (let i = 0; i < 20; i++) await login('203.0.113.9');
      assert.equal((await login('203.0.113.9')).status, 429);
      assert.equal((await login('203.0.113.10')).status, trustProxyHops ? 400 : 429);
    } finally { await f.close(); }
  }
});

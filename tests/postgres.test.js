import { listenForTests } from './helpers/http-server.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../server.js';
import { createPostgresDatabase, postgresOptions } from '../database.js';

const masterSecret = 'test-only-master-secret-not-for-deployment';
const ownerCode = 'test-only-owner-code-not-for-deployment';
const fakeKey = 'sk-test-only-postgres-AAAAAAAAAAAAAAAAAAAA';
const password = 'a long test-only account password';
const defaultPolicy = { audience: 'public', siteDailyLimit: 50, visitorDailyLimit: 10, networkDailyLimit: 100 };

// Execute the production PostgreSQL adapter against a real PostgreSQL WASM engine.
// PGlite has one connection, so this pool facade queues independent clients.
function testPool(engine) {
  let pending = Promise.resolve();
  async function acquire() {
    const previous = pending;
    let release;
    pending = new Promise(resolve => { release = resolve; });
    await previous;
    return release;
  }
  async function query(sql, args) {
    const result = args === undefined ? (await engine.exec(sql)).at(-1) : await engine.query(sql, args);
    return { rows: result?.rows || [], rowCount: result?.affectedRows ?? result?.rows?.length ?? 0 };
  }
  return {
    async query(...args) { const release = await acquire(); try { return await query(...args); } finally { release(); } },
    async connect() { return { query, release: await acquire() }; },
    async end() { await pending; },
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'aman-postgres-test-'));
  assert.ok(path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith('aman-postgres-test-'));
  const engine = new PGlite();
  const pool = testPool(engine);
  let server, base, dataDir, db;
  const calls = [];
  async function start() {
    // Every application restart gets a completely empty local filesystem.
    dataDir = await mkdtemp(path.join(root, 'ephemeral-'));
    db = createPostgresDatabase(pool);
    server = await createApp({
      database: db, databaseUrl: '', dataDir, masterSecret, ownerCode, secureCookies: true,
      tobiOptions: { apiKey: '', aiFetch: async (_url, request) => {
        calls.push(request);
        return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'A simulated hosted answer.' }] }] });
      } },
    });
    await listenForTests(server);
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (!server) return;
    await new Promise(resolve => server.close(resolve));
    await server.databaseClosed;
    server = null;
  }
  async function request(route, { method = 'GET', data, cookie, origin } = {}) {
    const response = await fetch(base + route, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: response.status, response, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const signup = (email = 'friend@example.test') => request('/api/auth/signup', { method: 'POST', data: { name: 'Hosted Friend', email, password } });
  const claim = cookie => request('/api/tobi/claim', { method: 'POST', cookie, data: { code: ownerCode } });
  async function configure(cookie, values) {
    const state = (await request('/api/tobi/config')).body;
    return request('/api/tobi/admin', { method: 'PUT', cookie, data: { revision: state.revision, config: { ...state.config, ...values } } });
  }
  async function enable(cookie) {
    assert.equal((await claim(cookie)).status, 200);
    assert.equal((await request('/api/tobi/connection', { method: 'PUT', cookie, data: { apiKey: fakeKey, model: 'gpt-5.6-luna' } })).status, 200);
    assert.equal((await configure(cookie, { openAIEnabled: true })).status, 200);
  }
  const chat = cookie => request('/api/tobi/chat', { method: 'POST', cookie, data: { message: 'Explain a distant galaxy.', language: 'en', mode: 'ai' } });
  try { await start(); }
  catch (error) { await engine.close(); await rm(root, { recursive: true, force: true }); throw error; }
  return {
    request, signup, claim, configure, enable, chat, calls,
    query: (...args) => pool.query(...args),
    get db() { return db; },
    get dataDir() { return dataDir; },
    async restart() { await stop(); await start(); },
    async close() {
      await stop();
      await engine.close();
      assert.ok(path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith('aman-postgres-test-'));
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('hosted startup requires durable secrets and PostgreSQL connections verify TLS', async () => {
  const options = postgresOptions('postgresql://test:test@db.example.test/aman?sslmode=no-verify&ssl=false');
  assert.deepEqual(options.ssl, { rejectUnauthorized: true });
  assert.ok(!options.connectionString.includes('ssl='));
  assert.ok(!options.connectionString.includes('sslmode='));
  assert.throws(() => postgresOptions('http://db.example.test'), /PostgreSQL/);
  await assert.rejects(createApp({ databaseUrl: 'postgresql://test:test@db.example.test/aman', masterSecret: '', ownerCode }), /APP_SECRET/);
  await assert.rejects(createApp({ databaseUrl: 'postgresql://test:test@db.example.test/aman', masterSecret, ownerCode: '' }), /TOBI_OWNER_CODE/);
});

test('PostgreSQL accounts, sessions and progress survive an empty application filesystem', async () => {
  const f = await fixture();
  try {
    const signup = await f.signup();
    assert.equal(signup.status, 201);
    const cookie = signup.cookie;
    assert.match(signup.response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax;.*Secure/);
    const stored = (await f.query('SELECT * FROM users')).rows[0];
    assert.equal(stored.password_hash.length, 128);
    assert.notEqual(stored.password_hash, password);
    assert.ok(Number(stored.created_at) > 1700000000000, 'Millisecond timestamps need BIGINT on PostgreSQL.');
    const duplicate = await f.signup(' FRIEND@example.test ');
    assert.equal(duplicate.status, 409);
    const concurrent = await Promise.all([f.signup('parallel@example.test'), f.signup('parallel@example.test')]);
    assert.deepEqual(concurrent.map(result => result.status).sort(), [201, 409]);
    const progress = { saved: ['unicef'], checklist: ['privacy'], quiz: 4 };
    assert.deepEqual((await f.request('/api/progress', { method: 'PUT', cookie, data: progress })).body, progress);
    await f.request('/api/progress', { method: 'PUT', cookie, data: { quiz: 2 } });
    assert.equal((await f.request('/api/tobi/progress', { method: 'PUT', cookie, data: { score: 90 } })).body.best, 90);
    assert.equal((await f.request('/api/tobi/progress', { method: 'PUT', cookie, data: { score: 50 } })).body.best, 90);
    const priorDirectory = f.dataDir;
    await f.restart();
    assert.notEqual(f.dataDir, priorDirectory);
    assert.deepEqual(await readdir(f.dataDir), []);
    assert.equal((await f.request('/api/auth/session', { cookie })).body.user.email, 'friend@example.test');
    assert.deepEqual((await f.request('/api/progress', { cookie })).body, progress);
    assert.deepEqual((await f.request('/api/tobi/progress', { cookie })).body, { best: 90, rounds: 2 });
    assert.equal((await f.request('/api/progress', { method: 'PUT', cookie, origin: 'https://untrusted.example', data: {} })).status, 403);
    for (const route of ['/database.js', '/server-secrets.js', '/render.yaml', '/.env', '/.data/aman.sqlite']) assert.equal((await f.request(route)).status, 404);
    const member = concurrent.find(result => result.status === 201).cookie;
    assert.deepEqual((await f.request('/api/progress', { cookie: member })).body, { saved: [], checklist: [], quiz: null });
    await f.request('/api/auth/logout', { method: 'POST', cookie, data: {} });
    assert.equal((await f.request('/api/progress', { cookie })).status, 401);
    assert.equal((await f.request('/api/auth/login', { method: 'POST', data: { email: 'friend@example.test', password: 'wrong' } })).status, 401);
    const login = await f.request('/api/auth/login', { method: 'POST', data: { email: 'FRIEND@example.test', password } });
    assert.equal(login.status, 200);
    assert.deepEqual((await f.request('/api/progress', { cookie: login.cookie })).body, progress);
  } finally { await f.close(); }
});

test('PostgreSQL owner claims are atomic and encrypted Tobi credentials survive a redeploy', async () => {
  const f = await fixture();
  try {
    const accounts = await Promise.all([f.signup('first@example.test'), f.signup('second@example.test')]);
    const claims = await Promise.all(accounts.map(account => f.claim(account.cookie)));
    assert.deepEqual(claims.map(result => result.status).sort(), [200, 409]);
    const owner = accounts[claims.findIndex(result => result.status === 200)].cookie;
    const member = accounts[claims.findIndex(result => result.status === 409)].cookie;
    assert.equal((await f.request('/api/tobi/connection', { cookie: member })).status, 403);
    const saved = await f.request('/api/tobi/connection', { method: 'PUT', cookie: owner, data: { apiKey: fakeKey, model: 'gpt-5.6-luna' } });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.connection.enabled, false);
    assert.equal(f.calls.length, 0);
    const encrypted = (await f.query('SELECT encrypted_key FROM tobi_connection')).rows[0].encrypted_key;
    assert.ok(!encrypted.includes(fakeKey));
    assert.equal(JSON.parse(encrypted).version, 1);
    const state = (await f.request('/api/tobi/config')).body;
    assert.equal((await f.configure(owner, { openAIEnabled: true })).status, 200);
    assert.equal((await f.request('/api/tobi/admin', { method: 'PUT', cookie: owner, data: state })).status, 409);
    await f.restart();
    assert.deepEqual(await readdir(f.dataDir), []);
    assert.equal((await f.request('/api/tobi/access', { cookie: owner })).body.canEdit, true);
    assert.equal((await f.claim(member)).status, 409);
    const connection = (await f.request('/api/tobi/connection', { cookie: owner })).body;
    assert.equal(connection.keyConfigured, true);
    assert.equal(connection.source, 'studio');
    assert.equal((await f.chat()).body.source, 'openai');
    assert.equal(f.calls[0].headers.Authorization, `Bearer ${fakeKey}`);
    for (const route of ['/api/tobi/config', '/api/tobi/access', '/api/tobi/connection']) {
      const response = await f.request(route, { cookie: owner });
      for (const secret of [fakeKey, masterSecret, ownerCode]) assert.ok(!JSON.stringify(response.body).includes(secret));
    }
    assert.equal((await f.request('/api/tobi/connection/test', { method: 'POST', cookie: owner, data: {} })).body.ok, true);
    await f.restart();
    assert.equal((await f.request('/api/tobi/connection', { cookie: owner })).body.lastTest.ok, true);
    await f.request('/api/tobi/connection/remove', { method: 'POST', cookie: owner, data: {} });
    await f.restart();
    assert.equal((await f.request('/api/tobi/connection', { cookie: owner })).body.keyConfigured, false);
    assert.equal((await f.chat()).body.reason, 'free_mode');
  } finally { await f.close(); }
});

test('PostgreSQL quotas serialize concurrent requests and keep visitor identities after redeploy', async () => {
  const f = await fixture();
  try {
    const owner = (await f.signup()).cookie;
    await f.enable(owner);
    const policy = values => f.request('/api/tobi/policy', { method: 'PUT', cookie: owner, data: { ...defaultPolicy, ...values } });
    await policy({ siteDailyLimit: 1 });
    const requests = await Promise.all([f.chat(), f.chat()]);
    assert.equal(requests.filter(result => result.body.source === 'openai').length, 1);
    assert.equal(requests.filter(result => result.body.reason === 'daily_limit').length, 1);
    assert.equal(f.calls.length, 1);
    const guest = requests.find(result => result.body.source === 'openai').cookie;
    await policy({ visitorDailyLimit: 1, networkDailyLimit: 2 });
    await f.restart();
    const blocked = await f.chat(guest);
    assert.equal(blocked.body.reason, 'visitor_limit');
    assert.equal(blocked.cookie, undefined);
    assert.equal((await f.chat()).body.source, 'openai');
    assert.equal((await f.chat()).body.reason, 'network_limit');
    assert.equal((await f.chat(owner)).body.reason, 'network_limit');
    assert.equal(f.calls.length, 2);
    assert.equal((await f.request('/api/tobi/connection', { cookie: owner })).body.usage.site, 2);
    await assert.rejects(f.db.transaction(async tx => { await tx.run('DELETE FROM tobi_usage'); throw new Error('rollback test'); }), /rollback test/);
    assert.equal(Number((await f.query('SELECT SUM(count) AS n FROM tobi_usage')).rows[0].n), 2);
    await policy({ audience: 'members' });
    assert.equal((await f.chat()).body.reason, 'login_required');
  } finally { await f.close(); }
});

test('disabling AI during an asynchronous credential read prevents a stale provider request', async () => {
  const f = await fixture();
  const reached = Promise.withResolvers(), resume = Promise.withResolvers();
  let pending;
  try {
    const owner = (await f.signup()).cookie;
    await f.enable(owner);
    const get = f.db.get;
    let connectionReads = 0;
    f.db.get = async (sql, ...args) => {
      const row = await get(sql, ...args);
      // Delay the chat's post-body read, after it has read the enabled config.
      if (sql === 'SELECT * FROM tobi_connection WHERE id=1' && ++connectionReads === 2) {
        reached.resolve();
        await resume.promise;
      }
      return row;
    };
    pending = f.chat();
    await reached.promise;
    assert.equal((await f.configure(owner, { openAIEnabled: false })).status, 200);
    resume.resolve();
    assert.equal((await pending).body.source, 'notebook');
    assert.equal(f.calls.length, 0);
  } finally { resume.resolve(); await pending; await f.close(); }
});

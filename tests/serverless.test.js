import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../server.js';
import { createPostgresDatabase } from '../database.js';
import { createFunctionHandler } from '../vercel-handler.js';
import { createRequestLimits } from '../request-limits.js';
import { testPool } from './helpers/postgres-pool.mjs';
import { listenForTests } from './helpers/http-server.mjs';

const masterSecret = 'serverless-test-only-master-secret';
const ownerCode = 'serverless-test-only-private-owner-code';
const password = 'serverless test-only long passphrase';
const origin = 'https://aman-serverless.example.test';
const fakeKey = 'sk-test-only-serverless-AAAAAAAAAAAAAAAAAAAA';

async function waitForProvider(promise) {
  let timer;
  try {
    await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The simulated provider did not receive the expected requests.')), 10000); })]);
  } finally { clearTimeout(timer); }
}

async function fixture(aiFetch) {
  const engine = new PGlite();
  const pool = testPool(engine);
  const workers = [];
  const previousOrigin = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = origin;
  async function worker({ failFirst = false } = {}) {
    const db = createPostgresDatabase(pool);
    // This path is deliberately never created: hosted startup must not depend
    // on being able to write to the deployment filesystem.
    const dataDir = path.join(tmpdir(), `aman-serverless-no-files-${randomUUID()}`);
    let application, starts = 0;
    const handler = createFunctionHandler(async () => {
      if (++starts === 1 && failFirst) throw new Error('private connection failure that must not reach the response');
      application = await createApp({ database: db, databaseUrl: '', dataDir, masterSecret, ownerCode, secureCookies: true, trustProxyHops: 1, tobiOptions: { apiKey: '', ...(aiFetch ? { aiFetch } : {}) } });
      return application;
    });
    const server = http.createServer(handler);
    await listenForTests(server);
    const base = `http://127.0.0.1:${server.address().port}`;
    const current = {
      db, dataDir, get starts() { return starts; },
      async request(route, { method = 'GET', data, cookie, ip = '203.0.113.10', requestOrigin = origin } = {}) {
        const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', Origin: requestOrigin, 'X-Forwarded-For': ip, ...(cookie ? { Cookie: cookie } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
        return { status: response.status, body: await response.json(), headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0] };
      },
      async close() {
        await new Promise(resolve => server.close(resolve));
        if (application) { application.emit('close'); await application.databaseClosed; }
      },
    };
    workers.push(current);
    return current;
  }
  return {
    pool, worker,
    async close() {
      for (const worker of workers) await worker.close();
      await engine.close();
      if (previousOrigin === undefined) delete process.env.APP_ORIGIN;
      else process.env.APP_ORIGIN = previousOrigin;
    },
  };
}

test('serverless cold starts share accounts, progress and login throttles without local files', async () => {
  const f = await fixture();
  try {
    const a = await f.worker({ failFirst: true }), b = await f.worker();
    const failed = await a.request('/api/health');
    assert.equal(failed.status, 503);
    assert.deepEqual(failed.body, { error: 'server_unavailable' });
    const ready = await Promise.all([a.request('/api/health'), a.request('/api/health'), b.request('/api/health')]);
    assert.ok(ready.every(result => result.status === 200));
    assert.equal(a.starts, 2);
    const account = { name: 'Hosted Friend', email: 'hosted@example.test', password };
    const signedUp = await a.request('/api/auth/signup', { method: 'POST', data: account });
    assert.equal(signedUp.status, 201);
    assert.match(signedUp.headers.get('set-cookie'), /; Secure/);
    assert.match(signedUp.headers.get('set-cookie'), /HttpOnly/);
    assert.equal((await a.request('/api/progress', { method: 'PUT', cookie: signedUp.cookie, data: { saved: ['unicef'], checklist: ['privacy'], quiz: 5 } })).status, 200);
    await a.request('/api/auth/logout', { method: 'POST', cookie: signedUp.cookie, data: {} });
    const loggedIn = await b.request('/api/auth/login', { method: 'POST', data: account });
    assert.equal(loggedIn.status, 200);
    assert.deepEqual((await b.request('/api/progress', { cookie: loggedIn.cookie })).body, { saved: ['unicef'], checklist: ['privacy'], quiz: 5 });
    assert.equal((await b.request('/api/auth/login', { method: 'POST', data: account, requestOrigin: 'https://untrusted.example.test' })).status, 403);
    for (let n = 0; n < 20; n++) {
      const result = await (n % 2 ? a : b).request('/api/auth/login', { method: 'POST', ip: '198.51.100.20', data: { email: 'absent@example.test', password } });
      assert.equal(result.status, 401);
    }
    const c = await f.worker();
    const blocked = await c.request('/api/auth/login', { method: 'POST', ip: '198.51.100.20', data: { email: 'absent@example.test', password } });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    for (const worker of [a, b, c]) await assert.rejects(lstat(worker.dataDir), { code: 'ENOENT' });
  } finally { await f.close(); }
});

test('AI concurrency and owner changes apply across independent function instances', async () => {
  let arrivals = 0, target = 3;
  let ready = Promise.withResolvers(), gate = Promise.withResolvers();
  const f = await fixture(async () => {
    if (++arrivals === target) ready.resolve();
    await gate.promise;
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'A simulated provider answer.' }] }] });
  });
  let pending = [];
  try {
    const a = await f.worker(), b = await f.worker();
    const owner = (await a.request('/api/auth/signup', { method: 'POST', data: { name: 'Owner', email: 'owner@example.test', password } })).cookie;
    assert.equal((await a.request('/api/tobi/claim', { method: 'POST', cookie: owner, data: { code: ownerCode } })).status, 200);
    assert.equal((await a.request('/api/tobi/connection', { method: 'PUT', cookie: owner, data: { apiKey: fakeKey, model: 'gpt-5.6-luna' } })).status, 200);
    async function configure(worker, enabled) {
      const state = (await worker.request('/api/tobi/config')).body;
      return worker.request('/api/tobi/admin', { method: 'PUT', cookie: owner, data: { revision: state.revision, config: { ...state.config, openAIEnabled: enabled } } });
    }
    assert.equal((await configure(a, true)).status, 200);
    const chat = worker => worker.request('/api/tobi/chat', { method: 'POST', data: { message: 'Tell me about galaxies.', language: 'en', mode: 'ai' } });
    pending = [chat(a), chat(b), chat(a)];
    await waitForProvider(ready.promise);
    const busy = await chat(b);
    assert.equal(busy.body.reason, 'busy');
    assert.equal(arrivals, 3);
    assert.equal(Number((await f.pool.query('SELECT SUM(count) AS n FROM tobi_usage')).rows[0].n), 3);
    gate.resolve();
    assert.ok((await Promise.all(pending)).every(result => result.body.source === 'openai'));
    assert.equal(Number((await f.pool.query('SELECT COUNT(*) AS n FROM request_leases')).rows[0].n), 0);
    arrivals = 0; target = 1; ready = Promise.withResolvers(); gate = Promise.withResolvers();
    pending = [chat(a)];
    await waitForProvider(ready.promise);
    assert.equal((await configure(b, false)).status, 200);
    gate.resolve();
    assert.equal((await pending[0]).body.reason, 'free_mode');
  } finally { gate.resolve(); await Promise.allSettled(pending); await f.close(); }
});

test('shared leases recover after an interrupted instance without releasing a replacement lease', async () => {
  const engine = new PGlite(), pool = testPool(engine);
  let time = 100000;
  try {
    const db = createPostgresDatabase(pool);
    const a = await createRequestLimits({ db, masterSecret, now: () => time });
    const b = await createRequestLimits({ db, masterSecret, now: () => time });
    const old = await a.acquire('ai', 'same-visitor', 1, 1000);
    assert.ok(old);
    assert.equal(await b.acquire('ai', 'other-visitor', 1, 1000), null);
    time += 1001;
    const replacement = await b.acquire('ai', 'same-visitor', 1, 1000);
    assert.ok(replacement);
    await a.release(old);
    assert.equal(await a.acquire('ai', 'other-visitor', 1, 1000), null);
    await b.release(replacement);
    assert.ok(await a.acquire('ai', 'other-visitor', 1, 1000));
    const results = await Promise.all(Array.from({ length: 8 }, (_, n) => (n % 2 ? a : b).consume('login', '203.0.113.9', 3, 1000)));
    assert.equal(results.filter(result => result.allowed).length, 3);
    time += 1001;
    assert.equal((await b.consume('login', '203.0.113.9', 3, 1000)).allowed, true);
    const rows = (await pool.query('SELECT subject FROM request_windows')).rows;
    assert.ok(rows.every(row => /^[a-f0-9]{64}$/.test(row.subject)));
  } finally { await engine.close(); }
});

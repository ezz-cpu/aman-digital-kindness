import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createApp } from '../server.js';

let server, base, dataDir, sessionCookie;
const account = { name: 'Test Friend', email: 'friend@example.com', password: 'a long unique test passphrase' };
async function request(route, { method = 'GET', data, cookie, origin } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
  return { response, status: response.status, body: await response.json() };
}
before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'aman-auth-test-'));
  server = await createApp({ dataDir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  assert.ok(path.resolve(dataDir).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dataDir).startsWith('aman-auth-test-'));
  await rm(dataDir, { recursive: true, force: true });
});

test('guests can browse but cannot access account progress', async () => {
  assert.equal((await fetch(base)).status, 200);
  assert.deepEqual((await request('/api/auth/session')).body, { user: null });
  assert.equal((await request('/api/progress')).status, 401);
});
test('signup validates fields and rejects short passwords', async () => {
  assert.equal((await request('/api/auth/signup', { method: 'POST', data: { ...account, password: 'short' } })).status, 400);
  assert.equal((await request('/api/auth/signup', { method: 'POST', data: { ...account, name: 'a' } })).status, 400);
});
test('signup establishes a protected session and hashes the password', async () => {
  const result = await request('/api/auth/signup', { method: 'POST', data: account, origin: base });
  assert.equal(result.status, 201);
  assert.equal(result.body.user.name, account.name);
  assert.equal(result.body.user.password, undefined);
  const setCookie = result.response.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  sessionCookie = setCookie.split(';')[0];
  assert.equal((await request('/api/auth/session', { cookie: sessionCookie })).body.user.email, account.email);
  const db = new DatabaseSync(path.join(dataDir, 'aman.sqlite'));
  const row = db.prepare('SELECT * FROM users').get();
  assert.notEqual(row.password_hash, account.password);
  assert.equal(row.password_hash.length, 128);
  assert.equal(row.salt.length, 32);
  assert.notEqual(db.prepare('SELECT token_hash FROM sessions').get().token_hash, sessionCookie.split('=')[1]);
  db.close();
});
test('duplicate email detection is case insensitive and handles concurrent signups', async () => {
  assert.equal((await request('/api/auth/signup', { method: 'POST', data: { ...account, email: ' FRIEND@EXAMPLE.COM ' } })).status, 409);
  const results = await Promise.all([1, 2].map(() => request('/api/auth/signup', { method: 'POST', data: { ...account, email: 'parallel@example.com' } })));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
});
test('wrong credentials fail without creating sessions', async () => {
  const result = await request('/api/auth/login', { method: 'POST', data: { ...account, password: 'wrong password' } });
  assert.equal(result.status, 401);
  assert.equal(result.response.headers.get('set-cookie'), null);
  assert.equal((await request('/api/auth/login', { method: 'POST', data: { ...account, email: 'missing@example.com' } })).body.error, result.body.error);
});
test('account progress persists and rejects invalid IDs or scores', async () => {
  const result = await request('/api/progress', { method: 'PUT', cookie: sessionCookie, data: { saved: ['unicef'], checklist: ['privacy'], quiz: 4 } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { saved: ['unicef'], checklist: ['privacy'], quiz: 4 });
  assert.equal((await request('/api/progress', { method: 'PUT', cookie: sessionCookie, data: { quiz: 2 } })).body.quiz, 4);
  assert.equal((await request('/api/progress', { method: 'PUT', cookie: sessionCookie, data: { saved: ['invalid'] } })).status, 400);
  assert.equal((await request('/api/progress', { method: 'PUT', cookie: sessionCookie, data: { quiz: 6 } })).status, 400);
  assert.equal((await request('/api/progress', { method: 'PUT', cookie: sessionCookie, data: { saved: [], quiz: 6 } })).status, 400);
  assert.deepEqual((await request('/api/progress', { cookie: sessionCookie })).body.saved, ['unicef']);
});
test('sessions and progress are isolated between accounts', async () => {
  const second = await request('/api/auth/login', { method: 'POST', data: { ...account, email: 'parallel@example.com' } });
  const cookie = second.response.headers.get('set-cookie').split(';')[0];
  assert.deepEqual((await request('/api/progress', { cookie })).body, { saved: [], checklist: [], quiz: null });
});
test('cross-origin writes and invalid JSON are rejected', async () => {
  assert.equal((await request('/api/progress', { method: 'PUT', cookie: sessionCookie, origin: 'https://other.example', data: { saved: [] } })).status, 403);
  assert.equal((await request('/api/auth/logout', { method: 'POST', cookie: sessionCookie, origin: 'https://other.example', data: {} })).status, 403);
  const bad = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(bad.status, 400);
  const form = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(form.status, 415);
});
test('private files and traversal paths are never served', async () => {
  for (const route of ['/server.js', '/package.json', '/.data/aman.sqlite', '/%2e%2e%2fserver.js', '/tests/auth.test.js']) {
    assert.equal((await fetch(`${base}${route}`)).status, 404, route);
  }
  const response = await fetch(base);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
test('logout revokes the session, and login restores saved progress', async () => {
  const result = await request('/api/auth/logout', { method: 'POST', cookie: sessionCookie, data: {} });
  assert.equal(result.status, 200);
  assert.match(result.response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await request('/api/progress', { cookie: sessionCookie })).status, 401);
  const login = await request('/api/auth/login', { method: 'POST', data: { ...account, email: 'FRIEND@example.com' } });
  assert.equal(login.status, 200);
  sessionCookie = login.response.headers.get('set-cookie').split(';')[0];
  assert.deepEqual((await request('/api/progress', { cookie: sessionCookie })).body.saved, ['unicef']);
});
test('expired and forged sessions are rejected', async () => {
  assert.equal((await request('/api/progress', { cookie: `aman_session=${'f'.repeat(64)}` })).status, 401);
  const db = new DatabaseSync(path.join(dataDir, 'aman.sqlite'));
  db.prepare('UPDATE sessions SET expires_at=0 WHERE token_hash=?').run(createHash('sha256').update(sessionCookie.split('=')[1]).digest('hex'));
  db.close();
  assert.equal((await request('/api/progress', { cookie: sessionCookie })).status, 401);
});
test('repeated login attempts are rate limited', async () => {
  let result;
  for (let i = 0; i < 21; i++) {
    result = await request('/api/auth/login', { method: 'POST', data: { ...account, password: 'wrong password' } });
    if (result.status === 429) break;
  }
  assert.equal(result.status, 429);
  assert.ok(Number(result.response.headers.get('retry-after')) > 0);
});

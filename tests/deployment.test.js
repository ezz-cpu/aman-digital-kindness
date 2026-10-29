import { listenForTests } from './helpers/http-server.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';

test('hosted sign-in accepts its HTTPS origin and retains accounts after a restart', async () => {
  const saved = { APP_ORIGIN: process.env.APP_ORIGIN, RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL };
  const origin = 'https://aman-test.onrender.com';
  delete process.env.APP_ORIGIN;
  process.env.RENDER_EXTERNAL_URL = origin;
  const dataDir = await mkdtemp(path.join(tmpdir(), 'aman-deployment-test-'));
  let server, base;
  const start = async () => {
    server = await createApp({ dataDir, secureCookies: true, tobiOptions: { apiKey: '' } });
    await listenForTests(server);
    base = `http://127.0.0.1:${server.address().port}`;
  };
  const post = (route, body, headers = {}) => fetch(base + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body: JSON.stringify(body),
  });
  const account = { name: 'Hosted Friend', email: 'hosted@example.test', password: 'a private deployment test passphrase' };
  try {
    await start();
    assert.equal((await fetch(base + '/api/health')).status, 200);
    assert.ok(!(await (await fetch(base)).text()).includes('aman-static-site'));
    const signup = await post('/api/auth/signup', account);
    assert.equal(signup.status, 201);
    const cookieHeader = signup.headers.get('set-cookie');
    assert.match(cookieHeader, /HttpOnly/);
    assert.match(cookieHeader, /SameSite=Lax/);
    assert.match(cookieHeader, /; Secure/);
    const cookie = cookieHeader.split(';')[0];
    assert.equal((await post('/api/auth/login', account, { Origin: 'https://untrusted.example', Host: 'untrusted.example' })).status, 403);
    await new Promise(resolve => server.close(resolve));
    server = null;
    await start();
    const session = await (await fetch(base + '/api/auth/session', { headers: { Cookie: cookie } })).json();
    assert.equal(session.user.email, account.email);
    assert.equal((await post('/api/auth/login', account)).status, 200);
    process.env.APP_ORIGIN = 'https://aman.example';
    assert.equal((await post('/api/auth/login', account)).status, 403);
    assert.equal((await post('/api/auth/login', account, { Origin: process.env.APP_ORIGIN })).status, 200);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    assert.ok(path.resolve(dataDir).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dataDir).startsWith('aman-deployment-test-'));
    await rm(dataDir, { recursive: true, force: true });
  }
});

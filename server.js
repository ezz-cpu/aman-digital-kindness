import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTobi } from './tobi-service.js';
import { clientAddress, parseTrustProxyHops } from './tobi-public.js';
import { openDatabase } from './database.js';
import { validateHostedSecrets } from './server-secrets.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const scrypt = promisify(scryptCallback);
const hash = value => createHash('sha256').update(value).digest('hex');
const sessionAge = 60 * 60 * 24 * 7;
const resourceIds = ['unicef', 'stopbullying', 'research', 'nspcc'];
const checklistIds = ['privacy', 'password', 'report', 'trusted'];

export async function createApp({ dataDir = process.env.DATA_DIR || path.join(root, '.data'), databaseUrl = process.env.DATABASE_URL || '', database, masterSecret = process.env.APP_SECRET || '', ownerCode = process.env.TOBI_OWNER_CODE || '', secureCookies = process.env.NODE_ENV === 'production', trustProxyHops = process.env.TRUST_PROXY_HOPS ?? 0, tobiOptions = {} } = {}) {
  const trustedHops = parseTrustProxyHops(trustProxyHops);
  if (databaseUrl || database?.kind === 'postgres') validateHostedSecrets(masterSecret, ownerCode);
  if (process.env.RENDER && !databaseUrl && !database) throw new Error('Render hosting requires DATABASE_URL so accounts survive restarts.');
  await mkdir(dataDir, { recursive: true });
  const db = database || await openDatabase({ dataDir, databaseUrl });
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at BIGINT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at BIGINT NOT NULL);
      CREATE TABLE IF NOT EXISTS progress (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, saved TEXT NOT NULL DEFAULT '[]', checklist TEXT NOT NULL DEFAULT '[]', quiz INTEGER);
    `);
    const attempts = new Map();
    const dummySalt = randomBytes(16).toString('hex');
    const dummyHash = await scrypt('constant-time-nonexistent-account', dummySalt, 64);
    const cookie = (token, age = sessionAge) => `aman_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${secureCookies ? '; Secure' : ''}`;
    async function session(req) {
      const token = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('aman_session='))?.slice(13);
      if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
      return await db.get('SELECT users.id, users.name, users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?', hash(token), Date.now()) || null;
    }
    async function startSession(userId, req, res) {
      const oldToken = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('aman_session='))?.slice(13);
      const token = randomBytes(32).toString('hex');
      await db.transaction(async tx => {
        if (oldToken) await tx.run('DELETE FROM sessions WHERE token_hash=?', hash(oldToken));
        await tx.run('DELETE FROM sessions WHERE expires_at<=?', Date.now());
        await tx.run('INSERT INTO sessions VALUES (?, ?, ?)', hash(token), userId, Date.now() + sessionAge * 1000);
      });
      res.setHeader('Set-Cookie', cookie(token));
    }
    function json(res, status, value) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(value));
    }
    async function body(req, maxBytes = 8192) {
      if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('invalid_request'), { status: 415 });
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > maxBytes) throw Object.assign(new Error('invalid_request'), { status: 413 });
      }
      try {
        const value = JSON.parse(raw);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        return value;
      } catch { throw Object.assign(new Error('invalid_request'), { status: 400 }); }
    }
    const publicFiles = new Set(['index.html', 'about.html', 'resources.html', 'interactive.html', 'login.html', 'signup.html', 'dashboard.html', 'privacy.html', 'styles.css', 'script.js', 'favicon.svg', '1.png', '9.png']);
    for (const file of ['tobi.html','tobi-studio.html','tobi.js','tobi.css','tobi-content.js','tobi-assets/tobi.svg','tobi-assets/tobi-blink.svg','tobi-assets/tobi-jump.svg','tobi-assets/original-background.jpg']) publicFiles.add(file);
    const handleTobi = await createTobi({db,dataDir,body,session,secureCookies,masterSecret,ownerCode,...tobiOptions});
    for (const file of ['aman-experience.css', 'aman-scene.js', 'aman-scene.bundle.js', 'tobi.bundle.js', 'tobi-refresh.css', 'save-world-preview.png', 'vendor/three/three.module.min.js', 'vendor/three/LICENSE.txt']) publicFiles.add(file);
    const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg':'image/jpeg' };
    const server = http.createServer(async (req, res) => {
      req.clientAddress = clientAddress(req, trustedHops);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
      try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname.startsWith('/api/')) {
          if (!['GET', 'POST', 'PUT'].includes(req.method)) return json(res, 405, { error: 'invalid_request' });
          if (req.method !== 'GET') {
            const expected = process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL || `${secureCookies ? 'https' : 'http'}://${req.headers.host}`;
            if ((req.headers.origin && req.headers.origin !== expected) || req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'invalid_request' });
          }
          if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, service: 'aman' });
          if (await handleTobi(req,res,url,json)) return;
          if (url.pathname === '/api/auth/session' && req.method === 'GET') return json(res, 200, { user: await session(req) });
          if (['/api/auth/signup', '/api/auth/login'].includes(url.pathname) && req.method === 'POST') {
            const input = await body(req);
            const key = req.clientAddress;
            const now = Date.now();
            for (const [ip, entry] of attempts) if (entry.reset < now) attempts.delete(ip);
            const rate = attempts.get(key) || { count: 0, reset: now + 15 * 60 * 1000 };
            rate.count++;
            attempts.set(key, rate);
            if (rate.count > 20) { res.setHeader('Retry-After', Math.ceil((rate.reset - now) / 1000)); return json(res, 429, { error: 'too_many_attempts' }); }
            const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
            const password = typeof input.password === 'string' ? input.password : '';
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !password || password.length > 128) return json(res, 400, { error: 'invalid_fields' });
            if (url.pathname.endsWith('/signup')) {
              const name = typeof input.name === 'string' ? input.name.trim() : '';
              if (name.length < 2 || name.length > 60 || password.length < 10) return json(res, 400, { error: 'invalid_fields' });
              const salt = randomBytes(16).toString('hex');
              const passwordHash = (await scrypt(password, salt, 64)).toString('hex');
              const user = { id: randomUUID(), name, email };
              try {
                await db.run('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)', user.id, name, email, salt, passwordHash, now);
              } catch (error) {
                if (error.code === '23505' || error.message.includes('UNIQUE')) return json(res, 409, { error: 'email_exists' });
                throw error;
              }
              await startSession(user.id, req, res);
              return json(res, 201, { user });
            }
            const account = await db.get('SELECT * FROM users WHERE email=?', email);
            const supplied = await scrypt(password, account?.salt || dummySalt, 64);
            const matches = timingSafeEqual(supplied, account ? Buffer.from(account.password_hash, 'hex') : dummyHash);
            if (!account || !matches) return json(res, 401, { error: 'invalid_credentials' });
            await startSession(account.id, req, res);
            return json(res, 200, { user: { id: account.id, name: account.name, email: account.email } });
          }
          if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
            await body(req);
            const token = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('aman_session='))?.slice(13);
            if (token) await db.run('DELETE FROM sessions WHERE token_hash=?', hash(token));
            res.setHeader('Set-Cookie', cookie('', 0));
            return json(res, 200, { ok: true });
          }
          if (url.pathname === '/api/progress') {
            const user = await session(req);
            if (!user) return json(res, 401, { error: 'unauthorized' });
            await db.run('INSERT INTO progress (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING', user.id);
            if (req.method === 'PUT') {
              const input = await body(req);
              const allowed = ['saved', 'checklist', 'quiz'];
              if (Object.keys(input).some(key => !allowed.includes(key))) return json(res, 400, { error: 'invalid_fields' });
              for (const field of ['saved', 'checklist']) {
                if (input[field] === undefined) continue;
                const permitted = field === 'saved' ? resourceIds : checklistIds;
                if (!Array.isArray(input[field]) || input[field].length > permitted.length || input[field].some(id => !permitted.includes(id))) return json(res, 400, { error: 'invalid_fields' });
              }
              if (input.quiz !== undefined && (!Number.isInteger(input.quiz) || input.quiz < 0 || input.quiz > 5)) return json(res, 400, { error: 'invalid_fields' });
              await db.transaction(async tx => {
                for (const field of ['saved', 'checklist']) if (input[field] !== undefined) await tx.run(`UPDATE progress SET ${field}=? WHERE user_id=?`, JSON.stringify([...new Set(input[field])]), user.id);
                if (input.quiz !== undefined) await tx.run('UPDATE progress SET quiz=CASE WHEN quiz IS NULL OR quiz<? THEN ? ELSE quiz END WHERE user_id=?', input.quiz, input.quiz, user.id);
              });
            } else if (req.method !== 'GET') return json(res, 405, { error: 'invalid_request' });
            const state = await db.get('SELECT saved, checklist, quiz FROM progress WHERE user_id=?', user.id);
            return json(res, 200, { saved: JSON.parse(state.saved), checklist: JSON.parse(state.checklist), quiz: state.quiz });
          }
          return json(res, 404, { error: 'not_found' });
        }
        if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'invalid_request' });
        const file = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
        if (!publicFiles.has(file)) return json(res, 404, { error: 'not_found' });
        const content = await readFile(path.join(root, file));
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(req.method === 'HEAD' ? undefined : content);
      } catch (error) {
        if (!error.status) console.error('Aman request failed.', { code: typeof error.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : 'INTERNAL_ERROR' });
        if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'server_error' });
        else res.end();
      }
    });
    server.on('close', () => {
      server.databaseClosed = Promise.resolve(db.close());
      server.databaseClosed.catch(() => console.error('The account database could not close cleanly.'));
    });
    return server;
  } catch (error) { await db.close(); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile(path.join(root,'.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const server = await createApp();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`Aman is ready at http://${host}:${port}`));
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    // Allow bounded provider requests to finish and SQLite to close cleanly.
    const deadline = setTimeout(() => { server.closeAllConnections(); process.exitCode = 1; }, 20000);
    deadline.unref();
    server.close(() => clearTimeout(deadline));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

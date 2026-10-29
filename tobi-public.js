import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { deriveSecret } from './server-secrets.js';

const invalid = () => Object.assign(new Error('invalid_fields'), { status: 400 });
const policyFields = 'audience,networkDailyLimit,siteDailyLimit,visitorDailyLimit';
const visitorCookie = 'aman_tobi_visitor';

export function validatePolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy) || Object.keys(policy).sort().join(',') !== policyFields || !['public', 'members'].includes(policy.audience)) throw invalid();
  for (const [name, max] of [['siteDailyLimit', 10000], ['visitorDailyLimit', 1000], ['networkDailyLimit', 10000]]) {
    if (!Number.isInteger(policy[name]) || policy[name] < 1 || policy[name] > max) throw invalid();
  }
  return policy;
}

export function parseTrustProxyHops(value = 0) {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^(0|[1-9]\d*)$/.test(String(value)) || !Number.isInteger(Number(value)) || Number(value) > 10) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10.');
  return Number(value);
}

function normalizedAddress(value) {
  if (typeof value !== 'string') return null;
  const address = value.trim();
  if (isIP(address) === 4) return address;
  if (isIP(address) !== 6) return null;
  // Canonical spelling prevents equivalent IPv6 addresses getting separate budgets.
  try {
    const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([a-f\d]+):([a-f\d]+)$/i.exec(canonical);
    if (mapped) {
      const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
      return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    }
    return canonical;
  } catch { return null; }
}

export function clientAddress(req, trustedHops = 0) {
  const peer = normalizedAddress(req.socket.remoteAddress) || 'unknown';
  if (!trustedHops || typeof req.headers['x-forwarded-for'] !== 'string') return peer;
  const forwarded = req.headers['x-forwarded-for'].split(',');
  // Discard client-controlled left prefixes; validate only the trusted right-hand chain.
  if (forwarded.length < trustedHops) return peer;
  const trusted = forwarded.slice(-trustedHops).map(normalizedAddress);
  if (trusted.some(address => !address)) return peer;
  return trusted[0];
}

export async function createPublicAccessStore({ db, dataDir, dailyLimit, secureCookies, masterSecret = '' }) {
  const defaults = validatePolicy({ audience: 'public', siteDailyLimit: dailyLimit, visitorDailyLimit: 10, networkDailyLimit: 100 });
  await db.exec(`CREATE TABLE IF NOT EXISTS tobi_policy (id INTEGER PRIMARY KEY CHECK(id=1), document TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tobi_network_usage (day TEXT NOT NULL, network_id TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(day,network_id));`);
  await db.run('INSERT INTO tobi_policy VALUES(1,?) ON CONFLICT(id) DO NOTHING', JSON.stringify(defaults));
  const secretPath = path.join(dataDir, 'tobi-visitor-secret.bin');
  let secret = deriveSecret(masterSecret, 'visitors');
  if (!secret) {
    try { secret = await readFile(secretPath); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Could not open the private Tobi visitor secret.');
      try {
        secret = randomBytes(32);
        await writeFile(secretPath, secret, { flag: 'wx', mode: 0o600 });
      } catch (writeError) {
        if (writeError.code !== 'EEXIST') throw new Error('Could not save the private Tobi visitor secret.');
        secret = await readFile(secretPath);
      }
    }
  }
  if (secret.length !== 32) throw new Error('The private Tobi visitor secret needs to be restored.');
  const hash = value => createHmac('sha256', secret).update(value).digest('hex');
  const read = async (store = db) => validatePolicy(JSON.parse((await store.get('SELECT document FROM tobi_policy WHERE id=1')).document));
  async function save(policy) {
    validatePolicy(policy);
    await db.transaction(tx => tx.run('UPDATE tobi_policy SET document=? WHERE id=1', JSON.stringify(policy)));
    return read();
  }
  function visitor(req, res, user) {
    if (user) return user.id;
    const token = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${visitorCookie}=`))?.slice(visitorCookie.length + 1);
    const match = typeof token === 'string' && /^v1\.([a-f0-9]{64})\.([a-f0-9]{64})$/.exec(token);
    if (match && timingSafeEqual(Buffer.from(match[2], 'hex'), Buffer.from(hash(`cookie:${match[1]}`), 'hex'))) return `guest:${hash(`visitor:${match[1]}`)}`;
    const id = randomBytes(32).toString('hex');
    const value = `${visitorCookie}=v1.${id}.${hash(`cookie:${id}`)}; HttpOnly; SameSite=Lax; Path=/api/tobi; Max-Age=31536000${secureCookies ? '; Secure' : ''}`;
    const existing = res.getHeader('Set-Cookie');
    res.setHeader('Set-Cookie', existing ? [...(Array.isArray(existing) ? existing : [existing]), value] : value);
    return `guest:${hash(`visitor:${id}`)}`;
  }
  const network = req => hash(`network:${req.clientAddress || normalizedAddress(req.socket.remoteAddress) || 'unknown'}`);
  async function usage(userId, store = db) {
    const day = new Date().toISOString().slice(0, 10);
    return {
      site: Number((await store.get('SELECT COALESCE(SUM(count),0) AS n FROM tobi_usage WHERE day=?', day)).n),
      user: userId ? Number((await store.get('SELECT count FROM tobi_usage WHERE day=? AND user_id=?', day, userId))?.count || 0) : 0,
    };
  }
  async function reserve(visitorId, networkId) {
    const day = new Date().toISOString().slice(0, 10);
    return db.transaction(async tx => {
      await tx.run('DELETE FROM tobi_usage WHERE day<?', day);
      await tx.run('DELETE FROM tobi_network_usage WHERE day<?', day);
      const policy = await read(tx), used = await usage(visitorId, tx);
      const networkUsed = Number((await tx.get('SELECT count FROM tobi_network_usage WHERE day=? AND network_id=?', day, networkId))?.count || 0);
      const reason = used.site >= policy.siteDailyLimit ? 'daily_limit' : used.user >= policy.visitorDailyLimit ? 'visitor_limit' : networkUsed >= policy.networkDailyLimit ? 'network_limit' : null;
      if (!reason) {
        // Reserve all budgets before contacting the provider, including failures and tests.
        await tx.run('INSERT INTO tobi_usage VALUES(?,?,1) ON CONFLICT(day,user_id) DO UPDATE SET count=tobi_usage.count+1', day, visitorId);
        await tx.run('INSERT INTO tobi_network_usage VALUES(?,?,1) ON CONFLICT(day,network_id) DO UPDATE SET count=tobi_network_usage.count+1', day, networkId);
      }
      return reason;
    });
  }
  return { read, save, visitor, network, usage, reserve };
}

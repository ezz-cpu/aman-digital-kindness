import { createHmac, randomBytes } from 'node:crypto';
import { deriveSecret } from './server-secrets.js';

// Hosted instances share APP_SECRET and the database. Local SQLite keeps the
// previous behavior of resetting short request windows when the process restarts.
export async function createRequestLimits({ db, masterSecret = '', now = Date.now }) {
  const secret = deriveSecret(masterSecret, 'request-limits') || randomBytes(32);
  const subject = (scope, key) => createHmac('sha256', secret).update(JSON.stringify([scope, String(key)])).digest('hex');
  await db.transaction(tx => tx.exec(`
    CREATE TABLE IF NOT EXISTS request_windows (scope TEXT NOT NULL, subject TEXT NOT NULL, count INTEGER NOT NULL, resets_at BIGINT NOT NULL, PRIMARY KEY(scope,subject));
    CREATE INDEX IF NOT EXISTS request_windows_expiry ON request_windows(resets_at);
    CREATE TABLE IF NOT EXISTS request_leases (scope TEXT NOT NULL, subject TEXT NOT NULL, token TEXT NOT NULL, expires_at BIGINT NOT NULL, PRIMARY KEY(scope,subject));
    CREATE INDEX IF NOT EXISTS request_leases_expiry ON request_leases(expires_at);
  `));
  return {
    async consume(scope, key, limit, windowMs) {
      const id = subject(scope, key);
      return db.transaction(async tx => {
        const time = now();
        await tx.run('DELETE FROM request_windows WHERE resets_at<=?', time);
        const previous = await tx.get('SELECT count,resets_at FROM request_windows WHERE scope=? AND subject=?', scope, id);
        const count = Math.min(Number(previous?.count || 0) + 1, limit + 1);
        const resetsAt = Number(previous?.resets_at || time + windowMs);
        await tx.run('INSERT INTO request_windows VALUES(?,?,?,?) ON CONFLICT(scope,subject) DO UPDATE SET count=?,resets_at=?', scope, id, count, resetsAt, count, resetsAt);
        return { allowed: count <= limit, retryAfter: Math.max(1, Math.ceil((resetsAt - time) / 1000)) };
      });
    },
    async acquire(scope, key, limit, ttlMs) {
      const id = subject(scope, key);
      return db.transaction(async tx => {
        const time = now();
        await tx.run('DELETE FROM request_leases WHERE expires_at<=?', time);
        if (await tx.get('SELECT token FROM request_leases WHERE scope=? AND subject=?', scope, id)) return null;
        const used = Number((await tx.get('SELECT COUNT(*) AS n FROM request_leases WHERE scope=?', scope)).n);
        if (used >= limit) return null;
        const token = randomBytes(24).toString('hex');
        await tx.run('INSERT INTO request_leases VALUES(?,?,?,?)', scope, id, token, time + ttlMs);
        return { scope, subject: id, token };
      });
    },
    async release(lease) {
      if (lease) await db.run('DELETE FROM request_leases WHERE scope=? AND subject=? AND token=?', lease.scope, lease.subject, lease.token);
    },
  };
}

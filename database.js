import path from 'node:path';

// Only application-authored SQL reaches this adapter. Values always use parameters.
const postgresSQL = sql => {
  let parameter = 0;
  return sql.replace(/\?/g, () => `$${++parameter}`);
};

function queue() {
  let pending = Promise.resolve();
  return operation => {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  };
}

export function postgresOptions(databaseUrl) {
  let url;
  try { url = new URL(databaseUrl); } catch { throw new Error('DATABASE_URL must be a PostgreSQL connection URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');
  }
  // URL SSL options must never downgrade certificate verification.
  for (const name of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl', 'uselibpqcompat']) url.searchParams.delete(name);
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true },
    max: 4,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 10000,
    statement_timeout: 15000,
    query_timeout: 20000,
    application_name: 'aman',
  };
}

export function createPostgresDatabase(pool) {
  const statements = client => ({
    exec: sql => client.query(sql),
    async get(sql, ...args) { return (await client.query(postgresSQL(sql), args)).rows[0]; },
    async all(sql, ...args) { return (await client.query(postgresSQL(sql), args)).rows; },
    async run(sql, ...args) { return { changes: (await client.query(postgresSQL(sql), args)).rowCount }; },
  });
  return {
    kind: 'postgres',
    ...statements(pool),
    async transaction(operation) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Serialize shared quota reservations and the one-time owner claim.
        await client.query('SELECT pg_advisory_xact_lock(16781234)');
        const result = await operation(statements(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    },
    close: () => pool.end(),
  };
}

export async function openDatabase({ dataDir, databaseUrl = '' }) {
  if (databaseUrl) {
    const { Pool } = await import('pg');
    const pool = new Pool(postgresOptions(databaseUrl));
    // Never log connection strings or provider errors that might contain credentials.
    pool.on('error', () => console.error('The account database connection was interrupted.'));
    return createPostgresDatabase(pool);
  }
  const { DatabaseSync } = await import('node:sqlite');
  const sqlite = new DatabaseSync(path.join(dataDir, 'aman.sqlite'));
  sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const enqueue = queue();
  const statements = {
    exec: sql => sqlite.exec(sql),
    get: (sql, ...args) => sqlite.prepare(sql).get(...args),
    all: (sql, ...args) => sqlite.prepare(sql).all(...args),
    run: (sql, ...args) => sqlite.prepare(sql).run(...args),
  };
  return {
    kind: 'sqlite',
    ...Object.fromEntries(Object.entries(statements).map(([name, operation]) => [name, (...args) => enqueue(() => operation(...args))])),
    transaction: operation => enqueue(async () => {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = await operation(statements);
        sqlite.exec('COMMIT');
        return result;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }),
    close: () => enqueue(() => sqlite.close()),
  };
}

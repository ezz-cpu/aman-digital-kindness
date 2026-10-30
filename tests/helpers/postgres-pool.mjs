// PGlite has one connection. Serialize independent clients while allowing the
// production adapter to execute transactions through its normal pool interface.
export function testPool(engine) {
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

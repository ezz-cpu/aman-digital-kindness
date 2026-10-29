import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const invalid = error => Object.assign(new Error(error), { status: 400 });
const aad = Buffer.from('tobi-openai-credential-v1');

// This module and the keyring are never part of the public-file allowlist.
export async function createConnectionStore(db, dataDir, environmentKey, environmentModel) {
  db.exec(`CREATE TABLE IF NOT EXISTS tobi_connection (
    id INTEGER PRIMARY KEY CHECK(id=1), source TEXT NOT NULL,
    encrypted_key TEXT, model TEXT, generation INTEGER NOT NULL DEFAULT 0,
    last_test TEXT
  )`);
  db.prepare("INSERT OR IGNORE INTO tobi_connection(id,source) VALUES(1,'environment')").run();
  const keyringPath = path.join(dataDir, 'tobi-keyring.bin');
  let keyring = await readFile(keyringPath).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw new Error('Could not open the private Tobi keyring.');
  });
  if (keyring && keyring.length !== 32) keyring = null;
  let writes = Promise.resolve();
  const enqueue = operation => {
    const result = writes.then(operation);
    writes = result.catch(() => {});
    return result;
  };
  const row = () => db.prepare('SELECT * FROM tobi_connection WHERE id=1').get();
  async function ensureKeyring() {
    if (keyring) return keyring;
    const next = randomBytes(32);
    try {
      await writeFile(keyringPath, next, { flag: 'wx', mode: 0o600 });
      keyring = next;
    } catch (error) {
      if (error.code !== 'EEXIST') throw new Error('Could not save the private Tobi keyring.');
      keyring = await readFile(keyringPath);
      if (keyring.length !== 32) throw new Error('The private Tobi keyring needs to be restored.');
    }
    return keyring;
  }
  function decrypt(encrypted) {
    if (!encrypted || !keyring) return '';
    try {
      const value = JSON.parse(encrypted);
      if (value.version !== 1) return '';
      const cipher = createDecipheriv('aes-256-gcm', keyring, Buffer.from(value.iv, 'base64'));
      cipher.setAAD(aad);
      cipher.setAuthTag(Buffer.from(value.tag, 'base64'));
      return Buffer.concat([cipher.update(Buffer.from(value.data, 'base64')), cipher.final()]).toString('utf8');
    } catch { return ''; }
  }
  function current() {
    const saved = row();
    const apiKey = saved.source === 'studio' ? decrypt(saved.encrypted_key) : saved.source === 'environment' ? environmentKey : '';
    return { apiKey, source: apiKey ? saved.source : 'none', model: saved.model || environmentModel, generation: saved.generation, lastTest: apiKey && saved.last_test ? JSON.parse(saved.last_test) : null };
  }
  async function save(input) {
    if (!input || Object.keys(input).some(key => !['apiKey', 'model'].includes(key)) || typeof input.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(input.model)) throw invalid('invalid_fields');
    if (input.apiKey !== undefined && typeof input.apiKey !== 'string') throw invalid('invalid_fields');
    if (typeof input.apiKey === 'string' && /[\r\n]/.test(input.apiKey)) throw invalid('key_invalid');
    const supplied = input.apiKey?.trim() || '';
    if (supplied && !/^sk-[A-Za-z0-9_-]{16,497}$/.test(supplied)) throw invalid('key_invalid');
    return enqueue(async () => {
      const before = current();
      if (!supplied && !before.apiKey) throw invalid('key_missing');
      const changed = (supplied && supplied !== before.apiKey) || input.model !== before.model || (supplied && before.source !== 'studio');
      if (!changed) return before;
      const saved = row();
      let encrypted = saved.encrypted_key;
      let source = saved.source;
      if (supplied) {
        const secret = await ensureKeyring();
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', secret, iv);
        cipher.setAAD(aad);
        const data = Buffer.concat([cipher.update(supplied, 'utf8'), cipher.final()]);
        encrypted = JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
        source = 'studio';
      }
      db.prepare('UPDATE tobi_connection SET source=?,encrypted_key=?,model=?,generation=generation+1,last_test=NULL WHERE id=1').run(source, encrypted, input.model);
      return current();
    });
  }
  function remove() {
    return enqueue(() => {
      // A deliberate disconnect must not silently fall back to an old .env key.
      db.prepare("UPDATE tobi_connection SET source='disconnected',encrypted_key=NULL,generation=generation+1,last_test=NULL WHERE id=1").run();
      return current();
    });
  }
  function recordTest(generation, result) {
    return db.prepare('UPDATE tobi_connection SET last_test=? WHERE id=1 AND generation=?').run(JSON.stringify({ ok: result.ok, reason: result.reason || null, at: new Date().toISOString() }), generation).changes > 0;
  }
  return { current, save, remove, recordTest };
}

function failureReason(status, data) {
  const code = data?.error?.code;
  const type = data?.error?.type;
  if (status === 401 || status === 403) return 'key_invalid';
  if (status === 429) return code === 'insufficient_quota' || type === 'insufficient_quota' ? 'insufficient_quota' : 'provider_limit';
  if (status === 404 || (status === 400 && (data?.error?.param === 'model' || String(code || '').includes('model')))) return 'model_unavailable';
  return 'service_unavailable';
}

export async function requestTobiAI({ connection, aiFetch, signal, language, message, history = [], testing = false }) {
  const request = {
    model: connection.model,
    store: false,
    max_output_tokens: testing ? 64 : 1024,
    ...(connection.model === 'gpt-5.6-luna' ? { reasoning: { effort: 'none' } } : {}),
    instructions: testing ? 'This is a connection test. Reply with only the word OK.' : `You are Tobi, a friendly educational digital-safety companion for young people. Answer in ${language === 'ar' ? 'natural, easy Egyptian Arabic' : 'clear English'}, usually in fewer than 100 words. Keep context from the conversation and answer the actual question; avoid repeating a greeting each turn. Use a warm, practical tone and at most one relevant follow-up question. You can explain general learning topics as well as cyberbullying, privacy and safe online choices. Do not pretend to be human, have personal experiences, or be a counsellor or emergency service. Never request passwords, API keys, addresses, school details or private photos. Do not blame someone for being bullied; offer practical options and trusted-adult support. For immediate danger, recommend contacting local emergency services and a trusted adult. Do not provide harmful instructions. Be honest when unsure.`,
    input: [...history.map(item => ({ role: item.role, content: item.content })), { role: 'user', content: message.trim() }],
  };
  try {
    const response = await aiFetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${connection.apiKey}`, 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify(request),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, reason: failureReason(response.status, data) };
    const output = Array.isArray(data?.output) ? data.output : [];
    const answer = output.filter(item => item?.type === 'message').flatMap(item => Array.isArray(item.content) ? item.content : []).filter(item => item?.type === 'output_text' || item?.type === 'refusal').map(item => typeof item.text === 'string' ? item.text : typeof item.refusal === 'string' ? item.refusal : '').join('\n').trim();
    if (!answer || data.status === 'incomplete') return { ok: false, reason: 'service_unavailable' };
    return { ok: true, answer: answer.slice(0, 6000) };
  } catch {
    return { ok: false, reason: signal.aborted ? 'request_timeout' : 'service_unavailable' };
  }
}

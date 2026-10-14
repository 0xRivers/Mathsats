import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';
import WebSocket from 'ws';
import { checkAuth, difficulty, makeRound, publicQuestion, scoreAnswer, sha256, now, validateChild } from './core.mjs';

const port = Number(process.env.PORT || 8787);
const listenHost = process.env.LISTEN_HOST || '127.0.0.1';
const origin = process.env.APP_ORIGIN || 'http://localhost:5173';
const frontendOrigin = process.env.FRONTEND_ORIGIN || origin;
const parent = (process.env.PARENT_PUBKEY || '').toLowerCase();
const relays = (process.env.RELAYS || '').split(',').map(s => s.trim()).filter(s => s.startsWith('wss://'));
const secret = process.env.SCORE_SIGNING_KEY ? Buffer.from(process.env.SCORE_SIGNING_KEY, 'hex') : null;
if (!/^https?:\/\/[^/]+$/.test(origin)) throw Error('APP_ORIGIN must be an origin without a path');
if (!/^https?:\/\/[^/]+$/.test(frontendOrigin)) throw Error('FRONTEND_ORIGIN must be an origin without a path');
if (!/^[a-f0-9]{64}$/.test(parent)) throw Error('Set PARENT_PUBKEY to the parent’s 64-character hex public key');
if (secret && secret.length !== 32) throw Error('SCORE_SIGNING_KEY must be a 32-byte hex key');
const db = new DatabaseSync(process.env.DB_PATH || './numbers.db');
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS auth_events (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS parent_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS children (id TEXT PRIMARY KEY, name TEXT NOT NULL, age INTEGER NOT NULL, skill TEXT NOT NULL, operation TEXT NOT NULL, archived_at INTEGER);
CREATE TABLE IF NOT EXISTS child_rounds (id TEXT PRIMARY KEY, child_id TEXT NOT NULL, data TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS child_results (id TEXT PRIMARY KEY, child_id TEXT NOT NULL, points INTEGER NOT NULL, completed_at INTEGER NOT NULL, receipt TEXT);
CREATE INDEX IF NOT EXISTS child_results_profile ON child_results(child_id);`);
useWebSocketImplementation(WebSocket);
const pool = new SimplePool();
const corsOrigin = requestOrigin => requestOrigin === 'https://localhost' ? requestOrigin : frontendOrigin;
const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': corsOrigin(res.req.headers.origin), 'access-control-allow-credentials': 'true', vary: 'Origin', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(data)); };
const fail = (res, status, message) => json(res, status, { error: message });
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(p => p.trim().split('=').slice(0, 2)).filter(pair => pair.length === 2));
const session = req => { const token = cookies(req).ms_session; return /^[a-f0-9]{64}$/.test(token || '') && !!db.prepare('SELECT 1 FROM parent_sessions WHERE token_hash = ? AND expires_at > ?').get(sha256(token), now()); };
const cookie = (value, age) => `ms_session=${value}; Path=/api; HttpOnly; SameSite=${origin.startsWith('https:') ? 'None; Secure' : 'Lax'}; Max-Age=${age}`;
const load = id => { const row = db.prepare('SELECT data FROM child_rounds WHERE id = ?').get(id); return row && JSON.parse(row.data); };
const profiles = () => db.prepare(`SELECT c.id,c.name,c.age,c.skill,c.operation,COUNT(r.id) games,COALESCE(SUM(r.points),0) points
  FROM children c LEFT JOIN child_results r ON r.child_id=c.id WHERE c.archived_at IS NULL GROUP BY c.id ORDER BY c.name COLLATE NOCASE`).all()
  .map(c => ({ ...c, limit: difficulty(c) }));

async function publishReceipt(round) {
  if (!secret) return null;
  // The public receipt deliberately omits child identity and answer history.
  const event = finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', `mathsats-score-${round.id}`]], content: JSON.stringify({ app: 'MathSats', version: 2, round: round.id, points: round.points, questions: 21 }) }, secret);
  if (relays.length) {
    try { await Promise.race([Promise.any(pool.publish(relays, event)), new Promise((_, reject) => setTimeout(() => reject(Error('Relay timeout')), 5000))]); }
    catch (error) { console.error('Receipt relay publication failed:', error.message); }
  }
  return event;
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': corsOrigin(req.headers.origin), 'access-control-allow-credentials': 'true', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type', vary: 'Origin' }); return res.end(); }
    if (!req.url?.startsWith('/api/')) return fail(res, 404, 'Not found');
    if (req.headers.origin && req.headers.origin !== frontendOrigin && req.headers.origin !== 'https://localhost') return fail(res, 403, 'Origin denied');
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 4096) return fail(res, 413, 'Request too large'); }
    const url = new URL(req.url, origin);
    if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true });
    if (url.pathname === '/api/session' && req.method === 'POST') {
      const auth = checkAuth(req.headers.authorization, 'POST', origin + url.pathname, raw);
      if (auth.pubkey !== parent) return fail(res, 403, 'Parent account required');
      try { db.prepare('INSERT INTO auth_events (id, created_at) VALUES (?, ?)').run(auth.id, now()); }
      catch { return fail(res, 409, 'Signature already used'); }
      const token = randomBytes(32).toString('hex');
      db.prepare('INSERT INTO parent_sessions (token_hash, expires_at) VALUES (?, ?)').run(sha256(token), now() + 12 * 3600);
      res.setHeader('set-cookie', cookie(token, 12 * 3600));
      return json(res, 200, { parent, expiresIn: 12 * 3600 });
    }
    if (!session(req)) return fail(res, 401, 'Parent sign-in required');
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      db.prepare('DELETE FROM parent_sessions WHERE token_hash = ?').run(sha256(cookies(req).ms_session));
      res.setHeader('set-cookie', cookie('', 0));
      return json(res, 200, { signedOut: true });
    }
    if (url.pathname === '/api/me' && req.method === 'GET') return json(res, 200, { parent, rewardsEnabled: false, scoreAuthority: secret ? getPublicKey(secret) : null });
    if (url.pathname === '/api/children' && req.method === 'GET') return json(res, 200, { children: profiles() });
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { return fail(res, 400, 'Invalid JSON'); }
    if (url.pathname === '/api/children' && req.method === 'POST') {
      const child = validateChild(data);
      if (data.id) {
        const result = db.prepare('UPDATE children SET name=?,age=?,skill=?,operation=? WHERE id=? AND archived_at IS NULL').run(child.name, child.age, child.skill, child.operation, data.id);
        if (!result.changes) return fail(res, 404, 'Child not found');
      } else {
        if (profiles().length >= 100) return fail(res, 400, 'Profile limit reached');
        db.prepare('INSERT INTO children (id,name,age,skill,operation) VALUES (?,?,?,?,?)').run(randomUUID(), child.name, child.age, child.skill, child.operation);
      }
      return json(res, 200, { children: profiles() });
    }
    if (url.pathname === '/api/children/archive' && req.method === 'POST') {
      if (typeof data.id !== 'string') return fail(res, 400, 'Invalid child');
      const result = db.prepare('UPDATE children SET archived_at=? WHERE id=? AND archived_at IS NULL').run(now(), data.id);
      return result.changes ? json(res, 200, { children: profiles() }) : fail(res, 404, 'Child not found');
    }
    if (url.pathname === '/api/round' && req.method === 'POST') {
      const child = typeof data.childId === 'string' && db.prepare('SELECT * FROM children WHERE id=? AND archived_at IS NULL').get(data.childId);
      if (!child) return fail(res, 404, 'Child not found');
      const round = makeRound(child);
      db.prepare('INSERT INTO child_rounds (id,child_id,data,expires_at) VALUES (?,?,?,?)').run(round.id, round.childId, JSON.stringify(round), round.expiresAt);
      return json(res, 200, publicQuestion(round));
    }
    if (url.pathname === '/api/answer' && req.method === 'POST') {
      if (typeof data.roundId !== 'string') return fail(res, 400, 'Invalid round');
      db.exec('BEGIN IMMEDIATE');
      let inTransaction = true;
      try {
        const round = load(data.roundId);
        if (!round || !db.prepare('SELECT 1 FROM children WHERE id=? AND archived_at IS NULL').get(round.childId)) { db.exec('ROLLBACK'); return fail(res, 404, 'Round not found'); }
        if (round.index === 21 || now() > round.expiresAt) { db.exec('ROLLBACK'); return fail(res, 409, 'Round complete or expired'); }
        if (data.number !== round.index + 1) { db.exec('ROLLBACK'); return fail(res, 409, 'Question already answered'); }
        const scored = scoreAnswer(round, data.answer);
        db.prepare('UPDATE child_rounds SET data=? WHERE id=?').run(JSON.stringify(round), round.id);
        if (scored.complete) db.prepare('INSERT INTO child_results (id,child_id,points,completed_at) VALUES (?,?,?,?)').run(round.id, round.childId, round.points, now());
        db.exec('COMMIT'); inTransaction = false;
        if (scored.complete) {
          scored.receipt = await publishReceipt(round);
          if (scored.receipt) db.prepare('UPDATE child_results SET receipt = ? WHERE id = ?').run(JSON.stringify(scored.receipt), round.id);
        }
        return json(res, 200, scored);
      } catch (error) { if (inTransaction) db.exec('ROLLBACK'); throw error; }
    }
    return fail(res, 404, 'Not found');
  } catch (error) {
    const message = error?.message || 'Server error';
    return fail(res, /signature|sign-in|expired/i.test(message) ? 401 : /Invalid|Choose|Enter/i.test(message) ? 400 : 500, message);
  }
});
server.listen(port, listenHost, () => console.log(`MathSats API listening on ${listenHost}:${port}; parent configured`));

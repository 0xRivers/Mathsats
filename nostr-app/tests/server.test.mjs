import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { sha256 } from '../server/core.mjs';

test('two parents stay isolated, legacy scores migrate, and a child plays 21 verified questions', async t => {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const directory = await mkdtemp(join(tmpdir(), 'mathsats-test-'));
  const parentKey = generateSecretKey(), otherKey = generateSecretKey(), base = `http://127.0.0.1:${port}`;
  const dbPath = join(directory, 'test.db');
  // Simulate the deployed single-parent database before the ownership migration.
  const old = new DatabaseSync(dbPath);
  old.exec(`CREATE TABLE parent_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    CREATE TABLE children (id TEXT PRIMARY KEY, name TEXT NOT NULL, age INTEGER NOT NULL, skill TEXT NOT NULL, operation TEXT NOT NULL, archived_at INTEGER);
    CREATE TABLE child_results (id TEXT PRIMARY KEY, child_id TEXT NOT NULL, points INTEGER NOT NULL, completed_at INTEGER NOT NULL, receipt TEXT);`);
  old.prepare('INSERT INTO children (id,name,age,skill,operation) VALUES (?,?,?,?,?)').run('legacy-child', 'Zoe', 8, 'practising', 'add');
  old.prepare('INSERT INTO child_results (id,child_id,points,completed_at) VALUES (?,?,?,?)').run('legacy-result', 'legacy-child', 5, 100);
  old.close();
  const server = spawn(process.execPath, ['server/index.mjs'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(port), APP_ORIGIN: base, LEGACY_PARENT_PUBKEY: getPublicKey(parentKey), DB_PATH: dbPath },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => { server.kill(); await rm(directory, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    let output = '';
    server.stdout.on('data', chunk => { output += chunk; if (output.includes('parent accounts enabled')) resolve(); });
    server.stderr.on('data', chunk => { output += chunk; });
    server.on('exit', code => reject(Error(`Server exited ${code}: ${output}`)));
    setTimeout(() => reject(Error(`Server did not start: ${output}`)), 5000).unref();
  });
  const api = (path, method = 'GET', data, cookie) => fetch(`${base}${path}`, { method, headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: data ? JSON.stringify(data) : undefined });
  assert.deepEqual(await (await api('/api/health')).json(), { ok: true });
  assert.equal((await api('/api/children')).status, 401);
  const body = '{}', url = `${base}/api/session`;
  const auth = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', url], ['method', 'POST'], ['payload', sha256(body)]], content: '' }, parentKey);
  const login = await fetch(url, { method: 'POST', headers: { authorization: 'Nostr ' + Buffer.from(JSON.stringify(auth)).toString('base64'), 'content-type': 'application/json' }, body });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await login.json()).parent, getPublicKey(parentKey));
  assert.equal((await fetch(url, { method: 'POST', headers: { authorization: 'Nostr ' + Buffer.from(JSON.stringify(auth)).toString('base64') }, body })).status, 409);
  const legacy = (await (await api('/api/children', 'GET', undefined, cookie)).json()).children;
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].points, 5);
  assert.equal(legacy[0].colorIndex, 0);
  const created = await api('/api/children', 'POST', { name: 'Ada', age: 7, skill: 'practising', operation: 'mixed' }, cookie);
  assert.equal(created.status, 200);
  const child = (await created.json()).children[0];
  assert.equal(child.limit, 20);
  assert.equal(child.colorIndex, 1);
  const updated = await api('/api/children', 'POST', { id: child.id, name: 'Ada', age: 8, skill: 'practising', operation: 'mixed' }, cookie);
  assert.equal((await updated.json()).children[0].colorIndex, 1);
  const started = await api('/api/round', 'POST', { childId: child.id }, cookie);
  let question = await started.json();
  assert.equal(question.total, 21);
  const otherAuth = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', url], ['method', 'POST'], ['payload', sha256(body)]], content: '' }, otherKey);
  const otherLogin = await fetch(url, { method: 'POST', headers: { authorization: 'Nostr ' + Buffer.from(JSON.stringify(otherAuth)).toString('base64'), 'content-type': 'application/json' }, body });
  assert.equal(otherLogin.status, 200);
  assert.equal((await otherLogin.json()).parent, getPublicKey(otherKey));
  const otherCookie = otherLogin.headers.get('set-cookie').split(';')[0];
  assert.deepEqual((await (await api('/api/children', 'GET', undefined, otherCookie)).json()).children, []);
  assert.equal((await api('/api/children', 'POST', { ...child, name: 'Stolen', id: child.id }, otherCookie)).status, 404);
  assert.equal((await api('/api/children/archive', 'POST', { id: child.id }, otherCookie)).status, 404);
  assert.equal((await api('/api/round', 'POST', { childId: child.id }, otherCookie)).status, 404);
  assert.equal((await api('/api/answer', 'POST', { roundId: question.roundId, number: 1, answer: 1 }, otherCookie)).status, 404);
  const otherCreated = await api('/api/children', 'POST', { name: 'Ben', age: 5, skill: 'beginner', operation: 'add' }, otherCookie);
  const otherChildren = (await otherCreated.json()).children;
  assert.equal(otherChildren.length, 1);
  assert.equal(otherChildren[0].colorIndex, 0);
  assert.equal((await (await api('/api/children', 'GET', undefined, cookie)).json()).children.length, 2);
  for (let number = 1; number <= 21; number++) {
    const answer = number === 1 ? 999 : question.symbol === '+' ? question.a + question.b : question.symbol === '−' ? question.a - question.b : question.symbol === '×' ? question.a * question.b : question.a / question.b;
    const reply = await api('/api/answer', 'POST', { roundId: question.roundId, number, answer }, cookie);
    assert.equal(reply.status, 200);
    const scored = await reply.json();
    if (number === 1) assert.equal((await api('/api/answer', 'POST', { roundId: question.roundId, number, answer }, cookie)).status, 409);
    if (number === 21) { assert.equal(scored.complete, true); assert.equal(scored.points, 20); }
    else question = scored.next;
  }
  const scores = await api('/api/children', 'GET', undefined, cookie);
  assert.equal((await scores.json()).children[0].points, 20);
  await api('/api/logout', 'POST', {}, cookie);
  assert.equal((await api('/api/children', 'GET', undefined, cookie)).status, 401);
});

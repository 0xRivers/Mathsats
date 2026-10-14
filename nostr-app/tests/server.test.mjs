import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { sha256 } from '../server/core.mjs';

test('parent signs in once; child plays 21 verified questions without a signer', async t => {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const directory = await mkdtemp(join(tmpdir(), 'mathsats-test-'));
  const parentKey = generateSecretKey(), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server/index.mjs'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(port), APP_ORIGIN: base, PARENT_PUBKEY: getPublicKey(parentKey), DB_PATH: join(directory, 'test.db') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => { server.kill(); await rm(directory, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    let output = '';
    server.stdout.on('data', chunk => { output += chunk; if (output.includes('parent configured')) resolve(); });
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
  assert.equal((await fetch(url, { method: 'POST', headers: { authorization: 'Nostr ' + Buffer.from(JSON.stringify(auth)).toString('base64') }, body })).status, 409);
  const created = await api('/api/children', 'POST', { name: 'Ada', age: 7, skill: 'practising', operation: 'mixed' }, cookie);
  assert.equal(created.status, 200);
  const child = (await created.json()).children[0];
  assert.equal(child.limit, 20);
  const started = await api('/api/round', 'POST', { childId: child.id }, cookie);
  let question = await started.json();
  assert.equal(question.total, 21);
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

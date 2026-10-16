import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { checkAuth, difficulty, makeProblem, makeRound, scoreAnswer, sha256, validateChild } from '../server/core.mjs';

test('questions stay within the selected range and carry the correct answer', () => {
  for (const limit of [10, 20, 50, 100]) for (const op of ['add', 'subtract', 'multiply', 'divide']) {
    for (let i = 0; i < 100; i++) {
      const q = makeProblem(op, limit);
      const actual = op === 'add' ? q.a + q.b : op === 'subtract' ? q.a - q.b : op === 'multiply' ? q.a * q.b : q.a / q.b;
      assert.equal(q.answer, actual);
      assert.ok(q.a >= 1 && q.a <= limit && q.b >= 1 && q.b <= limit && q.answer >= 1 && q.answer <= limit);
    }
  }
});

test('age and skill choose the range, while parent chooses the operation', () => {
  const child = validateChild({ name: '  Ada  ', age: 7, skill: 'beginner', operation: 'add' });
  assert.equal(child.name, 'Ada');
  assert.equal(difficulty(child), 10);
  assert.equal(difficulty({ age: 7, skill: 'practising' }), 20);
  assert.equal(difficulty({ age: 7, skill: 'confident' }), 50);
  assert.throws(() => validateChild({ name: '<script>', age: 7, skill: 'beginner', operation: 'add' }));
  assert.throws(() => validateChild({ name: 'Ada', age: 3, skill: 'beginner', operation: 'add' }));
  for (const rangeLimit of [10, 20, 50, 100]) {
    const saved = validateChild({ name: 'Ada', age: 7, skill: 'beginner', operation: 'divide', rangeLimit });
    assert.equal(saved.rangeLimit, rangeLimit);
    const round = makeRound({ id: 'ada', ...saved });
    assert.ok(round.questions.every(q => q.a <= rangeLimit && q.b <= rangeLimit && q.answer <= rangeLimit));
  }
  assert.throws(() => validateChild({ name: 'Ada', age: 7, skill: 'beginner', operation: 'add', rangeLimit: 200 }));
});

test('21 questions, one point per correct first answer, no replay after completion', () => {
  const round = makeRound({ id: 'child-1', name: 'Ada', age: 7, skill: 'practising', operation: 'mixed' });
  assert.equal(round.questions.length, 21);
  const good = scoreAnswer(round, round.questions[0].answer);
  assert.equal(good.correct, true); assert.equal(good.points, 1); assert.equal(good.next.number, 2);
  const bad = scoreAnswer(round, 999);
  assert.equal(bad.correct, false); assert.equal(bad.points, 1); assert.equal(bad.next.number, 3);
  for (let i = 2; i < 21; i++) scoreAnswer(round, round.questions[i].answer);
  assert.equal(round.points, 20); assert.equal(round.index, 21);
  assert.throws(() => scoreAnswer(round, 1));
});

test('NIP-98 binds method, URL, body, time and signature', () => {
  const key = generateSecretKey();
  const url = 'https://numbers.teamtoxic.xyz/api/round', body = JSON.stringify({ operation: 'add', limit: 10 });
  const time = Math.floor(Date.now() / 1000);
  const event = finalizeEvent({ kind: 27235, created_at: time, tags: [['u', url], ['method', 'POST'], ['payload', sha256(body)]], content: '' }, key);
  const header = 'Nostr ' + Buffer.from(JSON.stringify(event)).toString('base64');
  assert.equal(checkAuth(header, 'POST', url, body, time).pubkey, event.pubkey);
  assert.throws(() => checkAuth(header, 'GET', url, body, time));
  assert.throws(() => checkAuth(header, 'POST', url, '{}', time));
  assert.throws(() => checkAuth(header, 'POST', url, body, time + 61));
  assert.throws(() => checkAuth(header, 'POST', url + '?x=1', body, time));
});

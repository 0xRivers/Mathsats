import { createHash, randomUUID } from 'node:crypto';
import { verifyEvent } from 'nostr-tools/pure';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const now = () => Math.floor(Date.now() / 1000);
const pick = (n) => 1 + Math.floor(Math.random() * n);

export function makeProblem(operation, limit) {
  if (!['add', 'subtract', 'multiply', 'divide'].includes(operation) || ![10, 20, 50, 100].includes(limit)) throw Error('Invalid settings');
  if (operation === 'add') { const a = pick(limit - 1), b = pick(limit - a); return { a, b, answer: a + b, symbol: '+' }; }
  if (operation === 'subtract') { const a = pick(limit), b = pick(a); return { a, b, answer: a - b, symbol: '−' }; }
  const pairs = [];
  for (let a = 1; a <= 10; a++) for (let b = 1; b <= 10; b++) if (a * b <= limit) pairs.push([a, b]);
  const [a, b] = pairs[Math.floor(Math.random() * pairs.length)];
  return operation === 'multiply' ? { a, b, answer: a * b, symbol: '×' } : { a: a * b, b: a, answer: b, symbol: '÷' };
}

export function validateChild(input) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 40 || /[<>\x00-\x1f]/.test(name)) throw Error('Enter a name of up to 40 characters');
  if (!Number.isInteger(input.age) || input.age < 4 || input.age > 17) throw Error('Choose an age from 4 to 17');
  if (!['beginner', 'practising', 'confident'].includes(input.skill)) throw Error('Choose a skill level');
  if (!['add', 'subtract', 'multiply', 'divide', 'mixed'].includes(input.operation)) throw Error('Choose an operation');
  return { name, age: input.age, skill: input.skill, operation: input.operation };
}

export function difficulty(child) {
  const bands = [10, 20, 50, 100];
  const ageBand = child.age <= 5 ? 0 : child.age <= 7 ? 1 : child.age <= 9 ? 2 : 3;
  const adjustment = child.skill === 'beginner' ? -1 : child.skill === 'confident' ? 1 : 0;
  return bands[Math.max(0, Math.min(3, ageBand + adjustment))];
}

export function makeRound(child) {
  const profile = validateChild(child);
  const operations = profile.operation === 'mixed' ? ['add', 'subtract', 'multiply', 'divide'] : [profile.operation];
  const limit = difficulty(profile);
  const questions = Array.from({ length: 21 }, (_, i) => makeProblem(operations[i % operations.length], limit));
  return { id: randomUUID(), childId: child.id, questions, index: 0, points: 0, createdAt: now(), expiresAt: now() + 60 * 60 };
}

export function checkAuth(header, method, absoluteUrl, body, clock = now()) {
  const match = /^Nostr ([A-Za-z0-9+/=]+)$/.exec(header || '');
  if (!match) throw Error('Sign in with Nostr');
  let event;
  try { event = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')); } catch { throw Error('Invalid signature'); }
  if (!event || event.kind !== 27235 || !verifyEvent(event) || !/^[a-f0-9]{64}$/.test(event.pubkey || '')) throw Error('Invalid signature');
  if (Math.abs(clock - event.created_at) > 60) throw Error('Signature expired');
  if (!Array.isArray(event.tags) || event.tags.filter(t => t[0] === 'u').length !== 1 || event.tags.filter(t => t[0] === 'method').length !== 1) throw Error('Invalid request tags');
  if (event.tags.find(t => t[0] === 'u')?.[1] !== absoluteUrl || event.tags.find(t => t[0] === 'method')?.[1] !== method) throw Error('Signature does not match request');
  if (method !== 'GET' && (event.tags.filter(t => t[0] === 'payload').length !== 1 || event.tags.find(t => t[0] === 'payload')?.[1] !== sha256(body))) throw Error('Signature does not match body');
  return { pubkey: event.pubkey, id: event.id };
}

export function publicQuestion(round) {
  const q = round.questions[round.index];
  return q ? { roundId: round.id, childId: round.childId, number: round.index + 1, total: 21, a: q.a, b: q.b, symbol: q.symbol, points: round.points } : null;
}

export function scoreAnswer(round, answer) {
  if (round.index >= 21 || now() > round.expiresAt) throw Error('Round expired');
  if (!Number.isInteger(answer) || answer < 0 || answer > 1000) throw Error('Enter a whole number');
  const question = round.questions[round.index];
  const correct = answer === question.answer;
  round.index++;
  if (correct) round.points++;
  return { correct, answer: question.answer, complete: round.index === 21, points: round.points, next: publicQuestion(round) };
}

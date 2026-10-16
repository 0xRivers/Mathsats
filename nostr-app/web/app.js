import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { BunkerSigner, parseBunkerInput, createNostrConnectURI } from 'nostr-tools/nip46';
import { SimplePool } from 'nostr-tools/pool';
import { signWithNsec } from './local-signer.js';

const $ = id => document.getElementById(id);
const API = (import.meta.env.VITE_API_ORIGIN || (location.hostname === 'localhost' && location.protocol === 'https:' ? 'https://numbers.teamtoxic.xyz' : location.origin)).replace(/\/$/, '');
const relays = ['wss://relay.damus.io', 'wss://relay.primal.net'];
let bunker = null, pool = null, current = null, activeChild = null, editing = null, children = [];
const setStatus = (id, message, error = false) => { $(id).textContent = message; $(id).className = error ? 'status error' : 'status'; };
const bytes = data => [...new Uint8Array(data)].map(n => n.toString(16).padStart(2, '0')).join('');
const hash = async text => bytes(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
const short = key => key.slice(0, 12) + '…' + key.slice(-7);

async function request(path, method = 'GET', value) {
  const response = await fetch(API + path, { method, headers: method === 'GET' ? {} : { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(value ?? {}), credentials: 'include', cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Request failed');
  return data;
}

async function signIn(signer) {
  setStatus('login-status', 'Checking parent account…');
  const body = '{}', url = API + '/api/session';
  const event = await signer.signEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', url], ['method', 'POST'], ['payload', await hash(body)]], content: '' });
  const response = await fetch(url, { method: 'POST', headers: { authorization: 'Nostr ' + btoa(JSON.stringify(event)), 'content-type': 'application/json' }, body, credentials: 'include', cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Parent sign-in failed');
  await showFamily(data.parent);
}

async function showFamily(parent) {
  $('identity').textContent = 'Parent · ' + short(parent);
  $('login').classList.add('hidden'); $('game').classList.remove('hidden');
  await refreshChildren();
}

async function refreshChildren() {
  children = (await request('/api/children')).children;
  const list = $('profiles'); list.replaceChildren();
  if (!children.length) {
    const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'No players yet. Open the parent section below to add a child.'; list.append(p); $('settings').open = true;
  }
  for (const child of children) {
    const row = document.createElement('div'); row.className = 'profile';
    const info = document.createElement('div'), title = document.createElement('strong'), details = document.createElement('small');
    title.textContent = child.name;
    details.textContent = `Age ${child.age} · ${child.skill} · ${child.operation} · numbers to ${child.limit} · ${child.points} points`;
    info.append(title, details);
    const actions = document.createElement('div'); actions.className = 'row';
    const play = document.createElement('button'); play.className = 'button'; play.textContent = 'Play 21'; play.addEventListener('click', () => startRound(child));
    const edit = document.createElement('button'); edit.className = 'button secondary'; edit.textContent = 'Edit'; edit.addEventListener('click', () => editChild(child));
    const archive = document.createElement('button'); archive.className = 'button secondary'; archive.textContent = 'Remove'; archive.addEventListener('click', () => archiveChild(child));
    actions.append(play, edit, archive); row.append(info, actions); list.append(row);
  }
  if (activeChild) {
    const child = children.find(c => c.id === activeChild.id);
    if (child) { activeChild = child; showScore(child); }
  }
}

function showScore(child) {
  $('score-name').textContent = child.name + '’s score';
  $('total').textContent = child.points;
  $('games').textContent = `${child.games} games finished`;
}

function editChild(child) {
  editing = child.id;
  $('child-name').value = child.name; $('child-age').value = child.age;
  $('child-skill').value = child.skill; $('child-operation').value = child.operation;
  $('child-save').textContent = 'Save changes'; $('child-cancel').classList.remove('hidden');
  $('settings').open = true; $('child-name').focus();
}
function cancelEdit() {
  editing = null; $('child-form').reset(); $('child-save').textContent = 'Add child'; $('child-cancel').classList.add('hidden');
  $('child-status').textContent = '';
}
$('child-cancel').addEventListener('click', cancelEdit);
$('child-form').addEventListener('submit', async event => {
  event.preventDefault(); $('child-save').disabled = true;
  try {
    const value = { name: $('child-name').value, age: Number($('child-age').value), skill: $('child-skill').value, operation: $('child-operation').value };
    if (editing) value.id = editing;
    await request('/api/children', 'POST', value);
    cancelEdit(); await refreshChildren(); setStatus('child-status', 'Saved.');
  } catch (error) { setStatus('child-status', error.message, true); }
  finally { $('child-save').disabled = false; }
});
async function archiveChild(child) {
  if (!confirm(`Remove ${child.name} from the player list? Past scores remain saved.`)) return;
  try { await request('/api/children/archive', 'POST', { id: child.id }); if (activeChild?.id === child.id) activeChild = null; await refreshChildren(); }
  catch (error) { setStatus('child-status', error.message, true); }
}

$('extension').addEventListener('click', async () => {
  try {
    if (!window.nostr?.signEvent) throw Error('No browser signer found. Use Amber or a NIP-07 extension.');
    await signIn(window.nostr);
  } catch (error) { setStatus('login-status', error.message, true); }
});
$('nsec-login').addEventListener('click', async () => {
  const input = $('nsec-key'), button = $('nsec-login');
  let nsec = input.value.trim();
  input.value = '';
  button.disabled = true;
  try {
    if (!nsec) throw Error('Enter your nsec to sign in.');
    await signIn({ signEvent: unsigned => {
      try { return signWithNsec(nsec, unsigned); }
      finally { nsec = ''; }
    } });
  } catch (error) { setStatus('login-status', error.message, true); }
  finally { nsec = ''; input.value = ''; button.disabled = false; }
});
$('bunker-toggle').addEventListener('click', () => $('bunker-box').classList.toggle('hidden'));
$('bunker-connect').addEventListener('click', async () => {
  try {
    setStatus('login-status', 'Waiting for remote signer approval…');
    const pointer = await parseBunkerInput($('bunker-url').value.trim());
    if (!pointer) throw Error('Enter a valid bunker URL');
    pool = new SimplePool(); bunker = BunkerSigner.fromBunker(generateSecretKey(), pointer, { pool });
    await bunker.connect(); await signIn(bunker);
  } catch (error) { setStatus('login-status', error.message, true); }
});
$('amber').addEventListener('click', async () => {
  try {
    if (bunker) return;
    const localSecretKey = generateSecretKey();
    const secret = bytes(crypto.getRandomValues(new Uint8Array(16)));
    const uri = createNostrConnectURI({ clientPubkey: getPublicKey(localSecretKey), relays, secret, name: 'Number Quest', url: location.origin });
    $('connect-uri').textContent = uri; $('connect-link').href = uri; $('connect-box').classList.remove('hidden');
    setStatus('login-status', 'Approve this connection in Amber. Leave this page open.');
    pool = new SimplePool(); const pending = BunkerSigner.fromURI(localSecretKey, uri, { pool });
    if (/Android/i.test(navigator.userAgent)) location.href = uri;
    bunker = await pending; await signIn(bunker);
  } catch (error) { setStatus('login-status', error.message, true); bunker = null; }
});
$('copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('connect-uri').textContent); setStatus('login-status', 'Connection link copied.'); } catch { setStatus('login-status', 'Select the link to copy it.', true); } });
$('logout').addEventListener('click', async () => {
  try { await request('/api/logout', 'POST'); } catch {}
  try { await bunker?.close(); } catch {} pool?.close(relays);
  bunker = pool = current = activeChild = null; children = [];
  $('identity').textContent = 'Parent sign-in'; $('login').classList.remove('hidden'); $('game').classList.add('hidden');
  $('playing').classList.add('hidden'); $('setup').classList.remove('hidden');
});

function showQuestion(question) {
  current = question;
  $('progress').textContent = `Question ${question.number} of ${question.total} · ${question.points} points`;
  $('question').textContent = `${question.a} ${question.symbol} ${question.b} = ?`;
  $('answer').value = ''; $('answer').disabled = false; $('submit').disabled = false;
  $('feedback').textContent = ''; $('answer').focus();
}
async function startRound(child) {
  setStatus('game-status', 'Starting…');
  try {
    const q = await request('/api/round', 'POST', { childId: child.id });
    activeChild = child; showScore(child);
    $('setup').classList.add('hidden'); $('complete').classList.add('hidden'); $('playing').classList.remove('hidden');
    $('heading').textContent = child.name + '’s quest'; showQuestion(q);
  } catch (error) { setStatus('game-status', error.message, true); }
}
$('form').addEventListener('submit', async event => {
  event.preventDefault(); if (!current) return;
  const raw = $('answer').value.trim();
  if (!/^\d{1,4}$/.test(raw)) return setStatus('feedback', 'Enter a whole number.', true);
  $('submit').disabled = true; $('answer').disabled = true;
  try {
    const data = await request('/api/answer', 'POST', { roundId: current.roundId, number: current.number, answer: Number(raw) });
    $('feedback').className = data.correct ? 'status success' : 'status error';
    $('feedback').textContent = data.correct ? 'That’s right! +1 point ★' : `Good try! The answer is ${data.answer}.`;
    current = null;
    if (data.correct) $('total').textContent = Number($('total').textContent) + 1;
    setTimeout(async () => {
      if (data.complete) {
        $('playing').classList.add('hidden'); $('complete').classList.remove('hidden');
        $('summary').textContent = `${activeChild.name} earned ${data.points} of 21 points. The verified score has been saved.`;
        try { await refreshChildren(); } catch {}
      } else showQuestion(data.next);
    }, 1000);
  } catch (error) { setStatus('feedback', error.message, true); $('submit').disabled = false; $('answer').disabled = false; }
});
$('again').addEventListener('click', () => { $('complete').classList.add('hidden'); $('setup').classList.remove('hidden'); $('heading').textContent = 'Choose a player'; });
request('/api/me').then(me => showFamily(me.parent)).catch(() => {});
if ('serviceWorker' in navigator && location.protocol === 'https:' && location.hostname !== 'localhost') navigator.serviceWorker.register('/sw.js').catch(() => {});

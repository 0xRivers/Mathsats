import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { nsecEncode, npubEncode } from 'nostr-tools/nip19';
import { signWithNsec } from '../web/local-signer.js';
import { checkAuth, now, sha256 } from '../server/core.mjs';

test('nsec signs a bound NIP-98 login event without sending the key', () => {
  const key = generateSecretKey(), url = 'https://api.teamtoxic.xyz/api/session', body = '{}';
  const event = signWithNsec(nsecEncode(key), {
    kind: 27235, created_at: now(), tags: [['u', url], ['method', 'POST'], ['payload', sha256(body)]], content: ''
  });
  assert.equal(checkAuth('Nostr ' + Buffer.from(JSON.stringify(event)).toString('base64'), 'POST', url, body).pubkey, getPublicKey(key));
  assert.equal(JSON.stringify(event).includes(nsecEncode(key)), false);
  assert.throws(() => signWithNsec(npubEncode(getPublicKey(key)), event), /valid nsec/);
  assert.throws(() => signWithNsec('nsec1invalid', event), /valid nsec/);
});

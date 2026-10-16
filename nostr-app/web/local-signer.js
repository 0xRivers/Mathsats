import { finalizeEvent } from 'nostr-tools/pure';
import { decode } from 'nostr-tools/nip19';

export function signWithNsec(nsec, unsignedEvent) {
  if (typeof nsec !== 'string' || !nsec.startsWith('nsec1')) throw Error('Enter a valid nsec key.');
  let decoded;
  try { decoded = decode(nsec); } catch { throw Error('Enter a valid nsec key.'); }
  if (decoded.type !== 'nsec' || !(decoded.data instanceof Uint8Array) || decoded.data.length !== 32) throw Error('Enter a valid nsec key.');
  try { return finalizeEvent(unsignedEvent, decoded.data); }
  finally { decoded.data.fill(0); }
}

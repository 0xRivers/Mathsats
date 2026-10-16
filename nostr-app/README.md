# Number Quest: Nostr PWA and Android source

This directory is the new deployment target. The existing Number Quest Site and the GitHub Pages backlog remain separate until this app is verified on `numbers.teamtoxic.xyz`.

## What works

- Installable PWA shell and responsive 21-question maths games. The shell works offline; questions and scores need the API.
- Any adult can sign in through a NIP-07 browser signer, NIP-46 bunker / Amber, or an optional direct nsec entry. The server issues a 12-hour device session tied to that signer; each account sees only its own child profiles and scores. Children select their profiles and do not need signers.
- The parent can add, edit and archive child profiles. Each has an age (4–17), skill level and operation. Age selects a base number range; starting out lowers it one band and confident raises it one band. The parent can update the profile as the child progresses.
- Parent sign-in and child setup are in the menu. Each child keeps a distinct colour on their profile, game and score card, including after edits or restarts. A wrong answer briefly fills the screen in red with the correct number before the next question.
- NIP-98 signed parent sign-in with one-use request events, server-issued questions, one-shot answer checking (one point for each correct first answer) and a per-child SQLite score ledger.
- Optional signed score receipts published by the score authority to configured relays, without child identities. Relay outages do not erase scores because SQLite is authoritative.
- Capacitor config and Zapstore metadata for an Android APK build.

Cashu payouts are **disabled**. Never put Cashu proofs or private learning history in relay events. A parent session on a shared device can access every child profile; sign out when the device is not in the family's control.

Direct nsec sign-in signs only the NIP-98 login event in the browser; the key is not sent to the API, saved in local storage, or included in the signed event. The input is cleared immediately and the decoded key bytes are cleared after signing, but browser memory cannot be guaranteed to erase a JavaScript string. Use this option only on a trusted device and trusted site; an extension or Amber keeps the nsec out of page code.

## Local setup

Requires Node 22.13+, npm, and a Nostr signer. From this directory:

```bash
npm install
npm test
```

No child Nostr keys are needed. For an existing database created by the original single-parent version, set `LEGACY_PARENT_PUBKEY` to the original parent's 64-character **hex** public key before the first start of this version. This assigns existing profiles and results to the original parent. New installations do not need it. Convert Endo's public npub locally after `npm install`:

```bash
node --input-type=module -e 'import { decode } from "nostr-tools/nip19"; console.log(decode(process.argv[1]).data)' 'npub1g5rwqnjtwpuuuplr36v82eu2sxkn8fzkc6tdwz8036dzmrqkhgzqm6qq0t'
```

Keep any signing key out of the repository.

```bash
export APP_ORIGIN=http://localhost:5173
export LEGACY_PARENT_PUBKEY=<hex-for-endo> # existing single-parent database only
export DB_PATH=./numbers.db
npm run server
```

In another terminal, `npm run dev`; open `http://localhost:5173`. For relay receipts, optionally set `SCORE_SIGNING_KEY` to a newly generated 32-byte hex Nostr key and `RELAYS` to comma-separated `wss://` URLs. Do not reuse Endo's personal key or place a signer secret in the browser bundle. When no score key is configured, the verified ledger works but no receipts are published.

## Production at numbers.teamtoxic.xyz

1. Build with `npm install && npm run build`. Serve `dist/` at the HTTPS domain, with history fallback to `index.html`. Commit the generated lockfile after the first install; use `npm ci` for subsequent builds.
2. Run `npm run server` under systemd or a similar process manager with `APP_ORIGIN=https://numbers.teamtoxic.xyz`, `DB_PATH` on durable storage, and optionally `SCORE_SIGNING_KEY` / `RELAYS`. Set `LEGACY_PARENT_PUBKEY` only when migrating old profiles.
3. Reverse proxy `/api/` to `127.0.0.1:8787`. The signed URL must remain `https://numbers.teamtoxic.xyz/api/...`; do not rewrite its path. Restrict the API listener to loopback or firewall it.
4. Back up the SQLite database (including WAL state using SQLite's backup facility), configure TLS, test the PWA on an Android device, and verify the signed score event on a relay.

Example Caddyfile:

```caddyfile
numbers.teamtoxic.xyz {
  handle /api/* {
    reverse_proxy 127.0.0.1:8787
  }
  handle {
    root * /srv/mathsats-nostr/dist
    try_files {path} /index.html
    file_server
  }
}
```

The API is a trusted score authority, while relays hold signed receipts. A relay cannot safely check arbitrary client-calculated answers or custody Cashu proofs. SQLite is local to the API, not shared between relays.

## Publish the frontend as an nsite

NIP-5A nsites contain **static files**. Publish `dist/` with the parent's ngit signer; keep the API and SQLite ledger on a separate HTTPS service. If the public nsite is `https://numbers.teamtoxic.xyz`, a practical arrangement is:

- `https://numbers.teamtoxic.xyz`: NIP-5A gateway serving the nsite PWA.
- `https://api.teamtoxic.xyz`: reverse proxy to the Node API on port 8787, with persistent SQLite storage.

Build the frontend for the API URL, then publish it. ngit 3.0 or later is required; the account needs a configured Blossom server list or explicit `--blossom-server` flags.

```bash
VITE_API_ORIGIN=https://api.teamtoxic.xyz npm run build
ngit nsite publish dist --id numbers --title "Number Quest" --description "21-question family maths game" --json
```

Set `APP_ORIGIN=https://api.teamtoxic.xyz` and `FRONTEND_ORIGIN=https://numbers.teamtoxic.xyz` on the API process. The API URL in `VITE_API_ORIGIN` is public build configuration; the optional score signing key remains server-side. CORS and cookies permit only that declared frontend origin (plus the Android WebView's `https://localhost`). If using a gateway's temporary `.nsite` domain for testing, set `FRONTEND_ORIGIN` to its exact HTTPS origin and rebuild with the same API URL; switch it to the custom domain when DNS is ready.

An nsite gateway can resolve a custom domain via CNAME. Alternatively, reverse proxy the nsite gateway and `/api` on one domain; in that layout omit `VITE_API_ORIGIN` and `FRONTEND_ORIGIN`. Verify the custom-domain PWA's service worker and parent login after publication.

## Deploy the API with Docker Compose

The included `compose.yaml` runs only the score API and Caddy proxy. The nsite is published separately. On a server with Docker Compose, point the `api.teamtoxic.xyz` DNS A/AAAA record at the server, allow inbound TCP 80 and 443, and make sure those ports are not already used by another proxy. Caddy obtains HTTPS automatically.

Commit `nostr-app/package-lock.json` after running `npm install` on your computer; the container uses `npm ci` and needs that lockfile in the deployment checkout. Keep `.env` out of Git.

```bash
cd nostr-app
cp deploy/env.example .env
# Existing single-parent database: set LEGACY_PARENT_PUBKEY to Endo's hex public key.
# Set FRONTEND_ORIGIN to the exact nsite origin that the browser opens.
docker compose up -d --build
curl https://api.teamtoxic.xyz/api/health
```

`{"ok":true}` means the proxy reaches the API. `GET /api/me` returns 401 until the parent signs in. Run a complete 21-question round through the nsite before treating it as live. `scores` is a persistent Docker volume. Back it up with SQLite's backup API or `VACUUM INTO` from a quiesced process; do not copy a live database file alone while WAL is active. The `SCORE_SIGNING_KEY` in `.env` is optional; leave rewards disabled.

Before upgrading a populated single-parent deployment, back up its SQLite volume. On startup, the server assigns old child profiles and results to `LEGACY_PARENT_PUBKEY` and invalidates old sessions (parents sign in again). Without that key, an old database with profiles fails closed instead of showing them to everyone. The key is only needed for migration; it does not limit future sign-ins.

## Android and Zapstore

After web testing, install the Android SDK and JDK supported by your Capacitor version:

```bash
npm run android:add
npm run android:sync
cd android && ./gradlew assembleRelease
```

The resulting unsigned release APK must be signed with a persistent Android keystore, aligned, and verified. Preserve that keystore and increase the version code for updates. Test Amber's `nostrconnect://` handoff in the built APK; external intents can require native Android configuration. The app's bundled WebView calls the HTTPS API at `numbers.teamtoxic.xyz`.

Publish the signed APK as a GitHub release or point `release_source` in `zapstore.yaml` to a local signed APK, then use `zsp publish --wizard` with your NIP-46 signer. Zapstore links the Android certificate to your Nostr publisher identity on first publication. Do not publish an unsigned or untested APK. For the separate API host, build with `VITE_API_ORIGIN=https://api.teamtoxic.xyz` so the bundled WebView calls the right service.

## Remaining gates

- Test sign-in with two different Nostr accounts, confirming each sees only its own profiles and scores; verify 21-answer scoring and persistence.
- Run tests/build in an environment with network access. The earlier version passed locally on the user's machine; this profile/session change has not yet run there.
- Deploy under the domain, generate and safeguard the separate score signing key, test relay publication and Android signer handoff.
- Build and sign an APK, then publish it to Zapstore. Cashu rewards require a separate funded-ledger and withdrawal implementation.

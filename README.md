# Mathsats

A playful educational quiz for children, starting with arithmetic and growing toward parent-funded sat rewards.

## Current game

- Addition, subtraction, multiplication, division and mixed practice.
- Ranges beginning at 1–10, with higher levels up to 100.
- Hugo and Iggy profiles with distinct colours.
- Ten-question rounds, optional visual countdown, sounds and instant feedback.
- A one-second full-screen correct answer after mistakes or timeouts.
- Persistent leaderboard and a protected parent settings page.

The current UI is named Number Quest. Real payments are disabled.

## Agreed Cashu direction

Start with a parent-managed ecash pot and separate child balances. A parent can fund a pool (for example 1,000 sats) and configure a reward rate (for example 1 sat per verified correct answer). Earned sats are reserved in an internal ledger; they are not separate child-held ecash tokens until withdrawal or export.

Next implementation milestones:

1. Server-generated questions and one-shot answer checks replace browser-supplied completion scores. **Implemented in source and deployed to the existing Number Quest site; identity hardening remains.**
2. Add an atomic reward ledger with idempotent awards, available/reserved balances, daily caps and a parent pause control.
3. Integrate a Cashu test mint, including fee accounting, encrypted proof storage, backups and withdrawal recovery.
4. Add parent-approved ecash exports or withdrawals, then pilot with a small funded balance.
5. Apply a minimal hand-drawn interface and extend to languages, science and geography.

Nostr is optional. NWC may later help fund or withdraw from the pool, but is not the ecash transfer mechanism. Mint trust and fees must be considered before enabling real rewards.

## Source and build

- `web/index.html`: child quiz UI
- `web/parent.html`: parent UI
- `worker/index.js`: request handlers and database access
- `drizzle/`: database migrations
- `scripts/build.mjs`: dependency-free Node build
- `docs/index.html`: public roadmap and GRASP backlog (GitHub Pages)
- `.openai/hosting.json`: optional local Sites binding, excluded from Git

Build with a current Node.js runtime:

```sh
node scripts/build.mjs
```

Output is generated in `dist/`. The Worker expects a D1-compatible `DB` binding and server-side `PARENT_EMAIL`, `AUTH_SECRET` and `PARENT_ACCESS_CODE` secrets. Apply all three migrations, in order, before deploying the Worker. The second migration adds server-owned rounds and questions; the third adds child PIN credentials. The old `/api/finish` endpoint now rejects browser-supplied scores. Deploy the schema before the new Worker; existing game sessions will restart when the new client loads.

Each server question has a 10-minute hard expiry and each round has a one-hour hard expiry. The child timer is a play aid and pauses in the menu; its chosen seconds are not a payout-grade server-enforced limit. Round IDs are bound to a PIN-authenticated player session. A shared six-digit PIN does not prove which child is physically present; automated guessing or farming remains possible. Do not enable payouts until abuse limits, the reward ledger and the family access model are reviewed.

Parent settings require the configured ChatGPT parent identity plus a separate high-entropy access code. A parent unlock lasts ten minutes and the game route locks it. The parent sets six-digit PINs for Hugo and Iggy in `/parent`. Child sessions are HTTP-only cookies, expire after twelve hours, and are invalidated immediately when a PIN is changed. Five failed PIN attempts lock that child for ten minutes. Do not commit access codes or the HMAC secret. A different host must replace the Sites-supplied identity headers with verified authentication.

This repository contains source only, not production scores, wallet proofs or secrets. Publishing commits here does not automatically deploy the existing site.

## Backlog and GitHub Pages

The static backlog is in `docs/index.html`. In repository Settings → Pages, choose Deploy from a branch, branch `main`, folder `/docs`, and Save. Expected URL after deployment: https://0xrivers.github.io/Mathsats/

GitHub Pages serves the backlog only. The game needs the Worker, database and trusted authentication described above; it cannot run fully on static Pages hosting.

Preview the backlog locally with `python -m http.server 8000 --directory docs`.

## GitHub and Nostr

Local checkout: `/home/endo/Projects/MathSats`. `origin` is the Nostr remote and `github` is the GitHub mirror. Amber signs through NIP-46 as Endo. Never commit bunker URLs, connection secrets, wallet proofs, environment files or private keys.

After importing this commit from GitHub, publish it to Nostr:

```sh
git pull --ff-only github main
git push origin main
```

For subsequent local commits:

```sh
git push origin main && git push github main
```

## Verification

Use Node.js 22.13+ for the included SQLite-backed regression check:

```sh
npm test
```

The checks cover issued questions, arithmetic, replayed answers, forged browser scores, expiry, score aggregation, parent step-up, child PINs, player-bound rounds and PIN rotation. They do not establish a child’s real-world identity or payout safety.

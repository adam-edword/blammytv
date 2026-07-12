# keybox

BlammyTV's theme-license server. Stripe Checkout sells a lifetime "Themes
Pass" (all paid themes, current and future) or per-theme purchases; a
webhook turns a completed Checkout session into a license key; the app
pastes that key into Settings and gets entitlement + CSS payloads back.

No accounts anywhere — the key IS the credential. The key database holds
**zero buyer identity**; Stripe's own dashboard is the purchase-to-person
record for manual lost-key support. See the SECURITY section below.

## Architecture

```
Stripe Checkout -> webhook (checkout.session.completed)
                 -> keybox generates a key, stores it (no PII)
                 -> success page shows the key
App: paste key -> POST /validate -> entitlement (pass / owned theme ids)
App: GET /payload/:themeId (with key + machine headers) -> theme CSS
```

SQLite (WAL mode) holds `keys` and `activations`. Caddy terminates HTTPS
and reverse-proxies to this process. The app's own fail-open caching is
what keeps a paid theme usable if the box is briefly down — this box only
gates **new** activations, never already-cached ones.

## Deploy runbook (Oracle Cloud box)

### 1. Node 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # v22.x
```

### 2. Install

```bash
cd /opt/blammytv   # or wherever the repo lives on the box
git pull
corepack enable
pnpm install --filter @blammytv/keybox...
```

### 3. Configure

Copy `catalog.json` and fill in real Stripe Price ids (see the Stripe
section below), and set environment variables (systemd unit below, or a
`.env` loaded by your process manager of choice — this app reads plain
`process.env`, no dotenv dependency):

- `PORT` — default `8390`
- `STRIPE_API_KEY` — secret key (`sk_live_...` / `sk_test_...`)
- `STRIPE_WEBHOOK_SECRET` — signing secret from the webhook endpoint (`whsec_...`)
- `DB_PATH` — default `./keybox.db`

### 4. systemd unit

`/etc/systemd/system/keybox.service`:

```ini
[Unit]
Description=BlammyTV keybox (theme license server)
After=network.target

[Service]
Type=simple
User=keybox
WorkingDirectory=/opt/blammytv/services/keybox
Environment=PORT=8390
Environment=DB_PATH=/var/lib/keybox/keybox.db
Environment=STRIPE_API_KEY=sk_live_xxx
Environment=STRIPE_WEBHOOK_SECRET=whsec_xxx
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/keybox

[Install]
WantedBy=multi-user.target
```

Prefer an env file over inline `Environment=` lines for secrets in
production: `EnvironmentFile=/etc/keybox/keybox.env` (mode 600, owned by
the `keybox` user), then reference the same variable names inside it.

```bash
sudo mkdir -p /var/lib/keybox
sudo chown keybox:keybox /var/lib/keybox
sudo systemctl daemon-reload
sudo systemctl enable --now keybox
sudo systemctl status keybox
```

### 5. Caddyfile snippet

```caddyfile
themes.blammy.example {
  reverse_proxy 127.0.0.1:8390
}
```

Caddy handles HTTPS (Let's Encrypt) automatically — no cert config needed
here.

### 6. Stripe setup

1. **Products/Prices** — in the Stripe Dashboard, create:
   - One Product "BlammyTV Themes Pass" with one Price (one-time payment).
     Copy its Price id into `catalog.json`'s `passPriceIds` array,
     replacing `price_PASS_PLACEHOLDER`.
   - One Product per paid theme (e.g. "Nebula") with one Price each. Copy
     each Price id into that theme's `priceIds` array in `catalog.json`,
     replacing `price_NEBULA_PLACEHOLDER`.
   - Ship new themes by adding a new entry to `catalog.json`'s `themes`
     array (id, name, blurb, supportsLight, preview swatch, priceIds) and
     dropping the matching `payloads/<id>.css` file next to `nebula.css` —
     a Themes Pass automatically covers it, no code change needed.

2. **Checkout / Payment Links** — either a Payment Link per Price, or your
   own Checkout Session creation, but either way the success URL must be:

   ```
   https://themes.blammy.example/success?session_id={CHECKOUT_SESSION_ID}
   ```

   (For Payment Links: Payment Link settings -> "After payment" -> Redirect
   customers to a website -> paste the URL above; Stripe substitutes
   `{CHECKOUT_SESSION_ID}` automatically.)

3. **Webhook endpoint** — Dashboard -> Developers -> Webhooks -> Add
   endpoint:
   - URL: `https://themes.blammy.example/webhook`
   - Events: `checkout.session.completed`
   - Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

### 7. Test-mode walkthrough

```bash
# Terminal 1 — run keybox locally against test-mode keys
STRIPE_API_KEY=sk_test_xxx STRIPE_WEBHOOK_SECRET=whsec_xxx PORT=8390 node src/server.js

# Terminal 2 — forward Stripe test-mode events to it
stripe listen --forward-to localhost:8390/webhook
# stripe listen prints its own whsec_... — use THAT as STRIPE_WEBHOOK_SECRET
# for this local run, not the live endpoint's secret.

# Terminal 3 — trigger a fake completed checkout
stripe trigger checkout.session.completed
```

Then hit `http://localhost:8390/success?session_id=<the session id from the
event>` to see the generated key, and:

```bash
curl -s -X POST localhost:8390/validate \
  -H 'content-type: application/json' \
  -d '{"key":"BTV-XXXX-XXXX-XXXX-XXXX","machine":"test-machine"}'
```

### 8. Backups

`scripts/backup.sh` takes a consistent `sqlite3 .backup` snapshot (safe
against a live WAL-mode db), prunes local copies older than 30 days, and
has a commented-out `rclone`/`scp` line for the off-box copy — **uncomment
and configure one of those**, since local-only backups don't survive a
dead disk. Cron:

```
17 3 * * * /opt/blammytv/services/keybox/scripts/backup.sh /var/lib/keybox/keybox.db /var/lib/keybox/backups >> /var/log/keybox-backup.log 2>&1
```

## API surface

- `POST /webhook` — Stripe webhook target. Verifies signature, issues a
  key on `checkout.session.completed` (idempotent per session).
- `GET /success?session_id=...` — Checkout `success_url` target. Shows the
  generated key, or a "still processing" page if the webhook hasn't landed
  yet.
- `POST /validate` — `{key, machine}` -> `{ok, pass, themes}` or
  `{ok:false, reason}`. This is the only entitlement check the app makes.
- `GET /payload/:themeId` — headers `x-license-key`, `x-machine`. Returns
  the theme's CSS if entitled and that machine is already activated.

## SECURITY

- **PII-free key DB.** `keys` and `activations` carry no name, email, or
  address — just the key, its entitlement, and a Stripe *session* id
  (which exists only for webhook idempotency and the success-page lookup,
  not as a buyer record). If you need to help someone recover a lost key,
  look up their payment in the Stripe Dashboard, not this database.
- **Key-in, yes/no-out.** `/validate` and `/payload` never expose a key
  list, a count of keys, or any other key's existence. A miss just says
  "unknown" — same as a hit that's out of activations.
- **Rate-limited.** A hand-rolled per-IP token bucket (30 req/min, no
  dependency) guards `/validate` and `/payload`.
- **Activation cap.** 3 machines per key, tracked by an opaque
  app-generated machine id (never a hardware serial or anything
  personally identifying). Re-validating an already-registered machine is
  free; a 4th *new* machine is rejected until one is freed (manually, for
  now — there's no self-serve deactivation yet).
- **What's deliberately NOT protected: CSS copyability.** The payload is
  plain CSS served over HTTPS to anyone who proves entitlement once. There
  is no obfuscation, no DRM, no attempt to stop someone from sharing the
  file after they've legitimately downloaded it. That's the accepted
  trade-off for a price-low, no-friction purchase flow — see HANDOFF.md.
  The gate is "don't ship locked bits to begin with," not "prevent copying
  bits you already shipped."

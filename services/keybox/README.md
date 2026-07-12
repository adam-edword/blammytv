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

SQLite (WAL mode) holds `keys` and `activations`, on a `/data` volume so it
survives container restarts and redeploys. Deployed as a container behind
Coolify's own reverse proxy, which terminates HTTPS for
`https://themes.eddtv.org` — see the Coolify section below, which is the
box's actual deploy path. The app's own fail-open caching is what keeps a
paid theme usable if the box is briefly down — this box only gates **new**
activations, never already-cached ones.

## Deploy: Docker

Build and run directly, without Coolify, for local testing or a one-off box:

```bash
docker build -t keybox services/keybox
docker run -d \
  --name keybox \
  -p 8390:8390 \
  -e STRIPE_API_KEY=sk_live_xxx \
  -e STRIPE_WEBHOOK_SECRET=whsec_xxx \
  -v keybox-data:/data \
  keybox
```

Three env vars matter:

- `STRIPE_API_KEY` — secret key (`sk_live_...` / `sk_test_...`)
- `STRIPE_WEBHOOK_SECRET` — signing secret from the webhook endpoint (`whsec_...`)
- `DB_PATH` — baked into the image as `/data/keybox.db`; only override it if
  you're doing something unusual (it must stay under the `/data` volume
  mount or the db won't persist).

`-v keybox-data:/data` is not optional — see **Persistent Storage** below
for why.

## Deploy: Coolify (the box's real setup)

This is how keybox actually runs on the Oracle VPS at
`https://themes.eddtv.org`. Coolify supplies its own reverse proxy and
handles TLS (Let's Encrypt) automatically — you do not need Caddy, nginx,
or any cert config on top of it.

1. **Create Resource** -> **Public/Private Repository** -> point it at this
   repo.
2. **Build Pack**: `Dockerfile`.
3. **Base Directory**: `services/keybox` (this is a monorepo — Coolify
   needs to know the Dockerfile and build context live here, not at the
   repo root).
4. **Port**: `8390` (matches the image's `EXPOSE`).
5. **Domain**: attach `https://themes.eddtv.org`. Coolify's proxy issues
   and renews the certificate; nothing else to configure.
6. **Environment Variables**: set `STRIPE_API_KEY` and
   `STRIPE_WEBHOOK_SECRET`. `DB_PATH` is already baked into the image
   (`/data/keybox.db`) — don't set it unless you're deviating from the
   volume layout below. Optionally set `RESEND_API_KEY`, `EMAIL_FROM`, and
   `EMAIL_REPLY_TO` for key-delivery email — see **Email delivery
   (optional)** below; leave all three unset and the box runs exactly as
   before.
7. **Persistent Storage — THE CRITICAL STEP**: add a volume mounted at
   `/data`. **Without this, the key database dies with the container on
   every redeploy** — every key ever issued, gone, with no way to recover
   who owns what. This is not a "nice to have"; it's the entire reason the
   image declares `VOLUME /data` instead of writing next to the code.
   Either mount type works — **Volume Mount** (named) or **Directory
   Mount** (host path). The container starts as root, fixes `/data`
   ownership on boot, then drops to the unprivileged `node` user before
   serving anything, so there's no host-side `chown` step whichever you
   pick. Just make sure the destination path is exactly `/data`.
8. **Health check path**: `/healthz`. This matches the Dockerfile's own
   `HEALTHCHECK` and is unauthenticated, unrate-limited, and CORS-free by
   design — it's meant to be hit constantly.
9. **Scheduled Task**: add a Coolify scheduled command running
   `node scripts/backup.mjs` daily. It writes a timestamped snapshot into
   `/data/backups` on the same volume and prunes anything older than 30
   days. **Local-only backups don't survive a dead disk** — periodically
   copy `/data/backups` off the box (Coolify's file browser, `docker cp`
   from the host, rclone, whatever's convenient) the same way
   `scripts/backup.sh`'s bare-metal cron job expected an off-box copy. See
   the Backups section below.

### Bare-metal alternative

<details>
<summary>Running keybox directly on a box with systemd, no container — expand if you're not using Coolify/Docker</summary>

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

### 5. Caddy

Caddy is unnecessary under Coolify (its proxy already does TLS) — this is
only relevant for the bare-metal path above.

```caddyfile
themes.eddtv.org {
  reverse_proxy 127.0.0.1:8390
}
```

Caddy handles HTTPS (Let's Encrypt) automatically — no cert config needed
here.

### Backups (bare-metal)

`scripts/backup.sh` takes a consistent `sqlite3 .backup` snapshot (safe
against a live WAL-mode db), prunes local copies older than 30 days, and
has a commented-out `rclone`/`scp` line for the off-box copy — **uncomment
and configure one of those**, since local-only backups don't survive a
dead disk. Cron:

```
17 3 * * * /opt/blammytv/services/keybox/scripts/backup.sh /var/lib/keybox/keybox.db /var/lib/keybox/backups >> /var/log/keybox-backup.log 2>&1
```

</details>

## Stripe setup

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
   https://themes.eddtv.org/success?session_id={CHECKOUT_SESSION_ID}
   ```

   (For Payment Links: Payment Link settings -> "After payment" -> Redirect
   customers to a website -> paste the URL above; Stripe substitutes
   `{CHECKOUT_SESSION_ID}` automatically.)

3. **Webhook endpoint** — Dashboard -> Developers -> Webhooks -> Add
   endpoint:
   - URL: `https://themes.eddtv.org/webhook`
   - Events: `checkout.session.completed`
   - Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

## Email delivery (optional)

The `/success` page is the actual delivery guarantee for a license key — it
always works with zero configuration. Email is a **best-effort backup on
top of that**, not a replacement: it exists so a buyer who closes the tab
before it loads, or whose redirect silently fails, doesn't lose their key.
If it's unconfigured, misconfigured, or a send fails outright, key issuance
and the webhook's 200 response are completely unaffected — the only
symptom is a log line and no email.

No new dependency: delivery is a single `fetch` to Resend's HTTP API
(`src/mailer.js`), same "no dotenv, no SDK" philosophy as the rest of this
service.

1. **Create a Resend account** — [resend.com](https://resend.com). The free
   tier (3,000 emails/month, 100/day) is enough for this box's volume.
2. **Verify your sending domain** (e.g. `eddtv.org`) — Resend gives you
   DKIM/SPF/DMARC DNS records to add once; verification usually completes
   within minutes.
3. **Set environment variables** (Docker `-e`, Coolify's Environment
   Variables panel, or the systemd unit's `Environment=` lines — same
   place as `STRIPE_API_KEY`):
   - `RESEND_API_KEY` — Resend's API key (`re_...`).
   - `EMAIL_FROM` — e.g. `BlammyTV <keys@eddtv.org>`. The address must be on
     the domain you verified in step 2, or Resend will reject the send.
   - `EMAIL_REPLY_TO` — optional. If set, it's both the `Reply-To` header
     and what the email body invites the buyer to use for support; if
     unset, the email doesn't mention a support address at all.

Leave `RESEND_API_KEY` or `EMAIL_FROM` unset (either one is enough) and
`createMailer` returns a no-op that logs once and skips sending — no crash,
no missing-env exit. This mirrors how the rest of the service treats
optional config, and it's what lets `node --test` and any local dev boot
run with zero email setup.

No buyer email is ever written to the database — see the PII section
below. The address is read once from the Checkout session
(`customer_details.email`) at webhook time and only ever passed to the
`fetch` call.

## Test-mode walkthrough

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

## Backups

Two ways to run keybox, two backup scripts:

- **Container (Coolify/Docker)**: `scripts/backup.mjs`. The runtime image
  (`node:22-bookworm-slim`) has no `sqlite3` CLI, so this reuses the
  already-installed `better-sqlite3` dependency's own `.backup()` API
  instead — same online-backup semantics, safe against a live WAL-mode db.
  Writes `${BACKUP_DIR:-/data/backups}/keybox-<ISO-date>.db` and prunes
  anything older than 30 days. Wire it up as a Coolify Scheduled Task (see
  the Coolify section above) — daily is enough.
- **Bare-metal**: `scripts/backup.sh`, driven by cron. See the bare-metal
  section above.

Either way: **local-only backups don't survive a dead disk.** Periodically
copy the backup directory (`/data/backups` in the container, whatever
`BACKUP_DIR` resolves to on bare metal) off the box.

## API surface

- `GET /healthz` — liveness/readiness check for Coolify and the container's
  own `HEALTHCHECK`. `{"ok":true}`, unauthenticated, no rate limit.
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
  look up their payment in the Stripe Dashboard, not this database. This
  holds even with email delivery configured (see **Email delivery
  (optional)** above): the buyer's address is read transiently off the
  Checkout session at webhook time, passed straight to Resend, and never
  written anywhere — `keys.emailed_at` records only a timestamp, never the
  address it was sent to.
- **Key-in, yes/no-out.** `/validate` and `/payload` never expose a key
  list, a count of keys, or any other key's existence. A miss just says
  "unknown" — same as a hit that's out of activations.
- **CORS is intentionally permissive on the app-facing routes only.**
  `/validate` and `/payload/:themeId` answer with
  `Access-Control-Allow-Origin: *` because the desktop app calls this
  server cross-origin from a Tauri/Vite WebView. `*` is correct here, not
  a shortcut: neither route reads cookies or any other ambient browser
  credential — entitlement rides values the caller must already hold (the
  license key, an activated machine id) — so there's nothing a third-party
  page can trick a browser into leaking. `/webhook` (Stripe,
  server-to-server) and `/success` (top-level navigation) get no CORS
  headers at all, since neither is ever fetched cross-origin.
- **Rate-limited.** A hand-rolled per-IP token bucket (30 req/min, no
  dependency) guards `/validate` and `/payload`. CORS preflights
  (`OPTIONS`) are answered before they ever reach the limiter, so a
  browser's own preflighting can't burn a caller's budget.
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

import express from "express";
import Stripe from "stripe";
import { readFileSync, mkdirSync, chownSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { openDb, createKey, findBySession, getKey, touchActivation, isActivated, markEmailed, ACTIVATION_LIMIT } from "./db.js";
import { loadCatalog } from "./catalog.js";
import { createMailer } from "./mailer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAYLOADS_DIR = path.join(__dirname, "..", "payloads");

/* ------------------------------------------------------------------ */
/* Rate limiting: hand-rolled per-IP token bucket, no dependency.     */
/* 30 requests/min, refilled continuously (not reset in a fixed       */
/* window) so a burst right at a window boundary can't double up.     */
/* ------------------------------------------------------------------ */
const RATE_LIMIT_CAPACITY = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const BUCKET_PRUNE_THRESHOLD = 5000;

function makeRateLimiter() {
  const buckets = new Map();

  return function rateLimit(req, res, next) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
    const now = Date.now();
    let bucket = buckets.get(ip);
    if (!bucket) {
      bucket = { tokens: RATE_LIMIT_CAPACITY, updatedAt: now };
      buckets.set(ip, bucket);
    }
    const elapsedMs = now - bucket.updatedAt;
    const refill = (elapsedMs / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_CAPACITY;
    bucket.tokens = Math.min(RATE_LIMIT_CAPACITY, bucket.tokens + refill);
    bucket.updatedAt = now;

    if (bucket.tokens < 1) {
      return res.status(429).json({ ok: false, reason: "rate_limited" });
    }
    bucket.tokens -= 1;

    if (buckets.size > BUCKET_PRUNE_THRESHOLD) {
      for (const [key, b] of buckets) {
        if (now - b.updatedAt > RATE_LIMIT_WINDOW_MS * 2) buckets.delete(key);
      }
    }
    next();
  };
}

/* ------------------------------------------------------------------ */
/* CORS: only for the two app-facing endpoints, /validate and         */
/* /payload/:themeId. The desktop app calls this server cross-origin  */
/* from a Tauri/Vite WebView (http://tauri.localhost in prod,         */
/* http://localhost:4173 in dev), so without explicit CORS headers    */
/* every fetch the app makes fails in the browser before it ever      */
/* reaches this process.                                              */
/*                                                                     */
/* Access-Control-Allow-Origin: * is deliberate, not a shortcut. These */
/* routes never read cookies or any other ambient browser credential — */
/* entitlement rides explicit values the caller must already possess   */
/* (the license key in the POST body, x-license-key/x-machine          */
/* headers), so there is nothing a page on another origin can trick a   */
/* victim's browser into sending on its behalf. `*` can't leak a        */
/* session the requester doesn't already hold.                          */
/*                                                                     */
/* /webhook (Stripe calling server-to-server, never a browser) and     */
/* /success (a top-level navigation target, never fetched) don't get   */
/* this middleware — they were never broken by CORS and giving them    */
/* permissive headers would just be needless surface area.             */
/* ------------------------------------------------------------------ */
const APP_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type,x-license-key,x-machine",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function appCors(req, res, next) {
  for (const [header, value] of Object.entries(APP_CORS_HEADERS)) {
    res.setHeader(header, value);
  }
  next();
}

/* Preflight responder: a bare 204 carrying the CORS headers above and
 * nothing else. Registered as its own OPTIONS route (not folded into the
 * POST/GET handlers below), which means an OPTIONS request never reaches
 * `rateLimit` at all — it's a different HTTP method, so Express routes it
 * to this handler instead of the rate-limited one. A browser can send
 * unlimited preflights without ever burning a token or seeing a 429. */
function preflight(req, res) {
  res.status(204).end();
}

/* ------------------------------------------------------------------ */
/* HTML pages for /success. Inline CSS, no assets, dark to match the  */
/* app. The key is server-generated (Crockford32 + dashes) so it      */
/* can't carry HTML-breaking characters, but it's escaped anyway.     */
/* ------------------------------------------------------------------ */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pageShell(bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BlammyTV</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0a0a0c;
    color: #f2f2f5;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 24px;
  }
  .card {
    width: 100%;
    max-width: 480px;
    background: #141416;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 16px;
    padding: 32px;
    text-align: center;
  }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { color: #a2a2a2; font-size: 14px; line-height: 1.5; margin: 0 0 20px; }
  .key {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 20px;
    letter-spacing: 0.05em;
    background: #0f0f0f;
    border: 1px solid rgba(255,255,255,0.14);
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 16px;
    user-select: all;
    word-break: break-all;
  }
  button {
    appearance: none;
    border: none;
    border-radius: 10px;
    background: #c22727;
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    padding: 12px 20px;
    cursor: pointer;
    width: 100%;
  }
  button:active { opacity: 0.85; }
  .hint { margin-top: 16px; font-size: 13px; color: #6b6b6f; }
</style>
</head>
<body>
<div class="card">
${bodyHtml}
</div>
</body>
</html>`;
}

function successPage(key) {
  const safeKey = escapeHtml(key);
  return pageShell(`
  <h1>Your theme key</h1>
  <p>This key unlocks your purchase in BlammyTV. Save it somewhere safe &mdash; it's the only credential you'll get.</p>
  <div class="key" id="key">${safeKey}</div>
  <button type="button" onclick="navigator.clipboard.writeText(document.getElementById('key').textContent.trim()).then(() => { this.textContent = 'Copied'; setTimeout(() => { this.textContent = 'Copy key'; }, 1500); })">Copy key</button>
  <p class="hint">Paste this into BlammyTV &rarr; Settings &rarr; Customize &rarr; Theme.</p>
`);
}

function pendingPage() {
  return pageShell(`
  <h1>Still processing&hellip;</h1>
  <p>Your purchase is being confirmed. This usually takes a few seconds &mdash; refresh in a moment.</p>
`);
}

/* ------------------------------------------------------------------ */
/* App factory. Exported for tests: pass an in-memory db and a        */
/* stubbed stripe object.                                             */
/* ------------------------------------------------------------------ */
// Default mailer for callers (including existing tests) that don't care
// about email delivery: same shape as a real mailer's return value, so
// handleCheckoutCompleted's success path is identical either way.
const NOOP_MAILER = {
  async sendKeyEmail() {
    return { sent: false, reason: "not_configured" };
  },
};

export function makeApp({ db, stripe, catalog, webhookSecret, mailer = NOOP_MAILER }) {
  const app = express();
  app.set("trust proxy", true);

  const rateLimit = makeRateLimiter();

  /* GET /healthz — Coolify's health check and the Dockerfile HEALTHCHECK
   * hit this. No rate limit (health checks poll frequently and must never
   * compete with real traffic for budget) and no CORS needed (never
   * fetched from a browser), though the headers are harmless if it ever is. */
  app.get("/healthz", (req, res) => {
    res.status(200).json({ ok: true });
  });

  /* CORS preflights for the two app-facing routes. See the appCors /
   * preflight comments above for why these exist, why `*` is correct, and
   * why registering them as their own OPTIONS routes keeps them off the
   * rate limiter. */
  app.options("/validate", appCors, preflight);
  app.options("/payload/:themeId", appCors, preflight);

  /* POST /webhook — raw body required for Stripe signature verification.
   * Registered before the global express.json() below so it never sees
   * a pre-parsed body. */
  app.post(
    "/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      let event;
      try {
        const sig = req.headers["stripe-signature"];
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch (err) {
        return res.status(400).send("webhook signature verification failed");
      }

      if (event.type === "checkout.session.completed") {
        try {
          await handleCheckoutCompleted({ db, stripe, catalog, mailer, session: event.data.object });
        } catch (err) {
          console.error("keybox: failed to process checkout.session.completed", err);
          // Non-2xx makes Stripe retry; createKey is idempotent on session id
          // so a retry is safe and we'd rather retry than silently drop a sale.
          return res.status(500).json({ received: false });
        }
      }

      return res.status(200).json({ received: true });
    },
  );

  app.use(express.json());

  app.get("/success", (req, res) => {
    const sessionId = req.query.session_id;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      return res.status(200).send(pendingPage());
    }

    let record = null;
    try {
      record = findBySession(db, sessionId);
    } catch (err) {
      console.error("keybox: /success lookup failed", err);
    }

    if (!record) {
      return res.status(200).send(pendingPage());
    }
    return res.status(200).send(successPage(record.key));
  });

  app.post("/validate", appCors, rateLimit, (req, res) => {
    const { key, machine } = req.body ?? {};
    if (
      typeof key !== "string" ||
      typeof machine !== "string" ||
      key.length === 0 ||
      key.length > 64 ||
      machine.length === 0 ||
      machine.length > 64
    ) {
      return res.status(400).json({ ok: false, reason: "malformed_request" });
    }

    try {
      const record = getKey(db, key);
      if (!record) {
        return res.status(200).json({ ok: false, reason: "unknown_key" });
      }

      // Admin/comp keys (unlimited) bypass the per-key machine cap.
      const activation = touchActivation(
        db,
        key,
        machine,
        record.unlimited ? Infinity : ACTIVATION_LIMIT,
      );
      if (activation.limit) {
        return res.status(200).json({ ok: false, reason: "activation_limit" });
      }

      const pass = record.kind === "pass";
      const themeIds = pass ? catalog.allThemeIds : record.themes;
      const themes = themeIds.map((id) => catalog.getTheme(id)).filter(Boolean);
      return res.status(200).json({ ok: true, pass, themes });
    } catch (err) {
      console.error("keybox: /validate failed", err);
      return res.status(500).json({ ok: false, reason: "internal_error" });
    }
  });

  app.get("/payload/:themeId", appCors, rateLimit, (req, res) => {
    // themeId is only ever used to look itself up in the catalog allowlist;
    // the actual filesystem path is built from catalog.getTheme(...).id,
    // never from req.params directly, so a traversal string just misses
    // the catalog lookup and 404s before touching the filesystem.
    const theme = catalog.getTheme(req.params.themeId);
    if (!theme) {
      return res.status(404).json({ ok: false, reason: "unknown_theme" });
    }

    const key = req.header("x-license-key");
    const machine = req.header("x-machine");
    if (!key || !machine) {
      return res.status(403).json({ ok: false, reason: "not_entitled" });
    }

    try {
      const record = getKey(db, key);
      if (!record) {
        return res.status(403).json({ ok: false, reason: "not_entitled" });
      }

      const entitled = record.kind === "pass" || record.themes.includes(theme.id);
      if (!entitled || !isActivated(db, key, machine)) {
        return res.status(403).json({ ok: false, reason: "not_entitled" });
      }

      const css = readFileSync(path.join(PAYLOADS_DIR, `${theme.id}.css`), "utf8");
      res.setHeader("Content-Type", "text/css; charset=utf-8");
      return res.status(200).send(css);
    } catch (err) {
      console.error(`keybox: failed to serve payload for theme ${theme.id}`, err);
      return res.status(404).json({ ok: false, reason: "unknown_theme" });
    }
  });

  // Normalizes malformed JSON bodies (express.json() throws a SyntaxError)
  // and any other unexpected error into a safe, internals-free response.
  app.use((err, req, res, next) => {
    if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
      return res.status(400).json({ ok: false, reason: "malformed_request" });
    }
    console.error("keybox: unhandled error", err);
    return res.status(500).json({ ok: false, reason: "internal_error" });
  });

  return app;
}

async function handleCheckoutCompleted({ db, stripe, catalog, mailer, session }) {
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id);

  let isPass = false;
  const themeIds = new Set();
  for (const item of lineItems.data) {
    const priceId = item.price?.id;
    if (!priceId) continue;
    if (catalog.isPassPriceId(priceId)) {
      isPass = true;
      continue;
    }
    const themeId = catalog.themeIdForPriceId(priceId);
    if (themeId) {
      themeIds.add(themeId);
    } else {
      console.warn(`keybox: unknown price id ${priceId} in session ${session.id}, ignoring`);
    }
  }

  if (!isPass && themeIds.size === 0) {
    console.warn(`keybox: session ${session.id} had no recognized line items; not issuing a key`);
    return;
  }

  const record = createKey(db, {
    kind: isPass ? "pass" : "themes",
    themes: isPass ? [] : Array.from(themeIds),
    session: session.id,
  });

  // emailedAt gates this on top of createKey's own session-id idempotency:
  // a webhook replay for an already-emailed session hits this same code
  // path again (createKey just returns the existing row) and must not
  // re-send. The buyer email is read straight off the Checkout session and
  // never persisted — see the PII-free comment on db.js's SCHEMA.
  const to = session.customer_details?.email ?? session.customer_email;
  if (record.emailedAt == null && to) {
    const themeNames = isPass
      ? catalog.themes.map((t) => t.name)
      : Array.from(themeIds)
          .map((id) => catalog.getTheme(id)?.name)
          .filter(Boolean);

    try {
      const result = await mailer.sendKeyEmail({ to, key: record.key, kind: record.kind, themeNames });
      // Only the no-op mailer resolves (rather than throws) without sending
      // — {sent:false, reason:"not_configured"}. Marking emailed_at there
      // would be a lie (no email went out) and would permanently block a
      // real send if Resend gets configured later and this session's
      // webhook is ever replayed from the Stripe dashboard.
      if (result?.sent) {
        markEmailed(db, record.key);
      }
    } catch (err) {
      // Best-effort only: the /success page is the real delivery guarantee,
      // so a send failure must never fail the webhook or block key issuance.
      // emailed_at stays NULL, so a future replay of this same session (if
      // Stripe ever retries) gets another shot at sending it.
      console.error(
        `keybox: key email FAILED for session ${session.id} (key still retrievable via /success)`,
        err,
      );
    }
  }
}

/* The `node` user's fixed ids in the node:*-bookworm images. */
const NODE_UID = 1000;
const NODE_GID = 1000;

/**
 * Make the DB directory writable, then drop root — the standard container
 * "start privileged, fix the mount, step down" pattern, done in-process so
 * the slim image needs no gosu/su-exec.
 *
 * The image starts as root (no USER in the Dockerfile) BECAUSE a freshly
 * provisioned /data volume can arrive root-owned (Coolify does this), and
 * only root can chown it. We create + chown the dir to the `node` user,
 * then setgid/setuid down to it before a single request is served or a
 * byte is written. If chown/setuid ever fails unexpectedly we exit non-zero
 * rather than silently keep root. When NOT root (local dev, `node --test`)
 * this is a no-op and behavior is unchanged.
 */
function ensureDataDirAndDropPrivs(dbPath) {
  if (process.getuid?.() !== 0) return;
  const dir = path.dirname(dbPath);
  try {
    if (dir && dir !== ".") {
      mkdirSync(dir, { recursive: true });
      chownSync(dir, NODE_UID, NODE_GID);
    }
    // gid before uid: once uid drops, the process can't change its gid.
    process.setgid(NODE_GID);
    process.setuid(NODE_UID);
    console.log(`keybox: ${dir} prepared, dropped to uid ${NODE_UID}`);
  } catch (err) {
    console.error("keybox: failed to prepare /data and drop privileges", err);
    process.exit(1);
  }
}

/* ------------------------------------------------------------------ */
/* Main entry: `node src/server.js`.                                  */
/* ------------------------------------------------------------------ */
function main() {
  const PORT = process.env.PORT ? Number(process.env.PORT) : 8390;
  const STRIPE_API_KEY = process.env.STRIPE_API_KEY;
  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const DB_PATH = process.env.DB_PATH || "./keybox.db";

  // Settle the data dir + privileges before anything touches disk.
  ensureDataDirAndDropPrivs(DB_PATH);

  if (!STRIPE_API_KEY) {
    console.error("keybox: STRIPE_API_KEY env var is required");
    process.exit(1);
  }
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error("keybox: STRIPE_WEBHOOK_SECRET env var is required");
    process.exit(1);
  }

  const db = openDb(DB_PATH);
  const stripe = new Stripe(STRIPE_API_KEY);
  const catalog = loadCatalog();
  // Unset RESEND_API_KEY/EMAIL_FROM -> createMailer's no-op path. Email
  // delivery is optional by design; see README's "Email delivery" section.
  const mailer = createMailer({
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
    replyTo: process.env.EMAIL_REPLY_TO,
  });

  const app = makeApp({ db, stripe, catalog, webhookSecret: STRIPE_WEBHOOK_SECRET, mailer });
  app.listen(PORT, () => {
    console.log(`keybox listening on :${PORT} (db: ${DB_PATH})`);
  });
}

const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main();
}

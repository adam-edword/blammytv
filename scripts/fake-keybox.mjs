// A tiny fake keybox license server for end-to-end wiring tests. Mimics the
// real services/keybox API (POST /validate, GET /payload/:id) with CORS
// open — the app calls it cross-origin from localhost:4173.
//
//   node scripts/fake-keybox.mjs        → keybox on :8085
//
// Known test keys (see scripts/verify-license.mjs for the full E2E):
//   BTV-TEST-PASS-0000-0000 → ok, pass:true,  entitled to nebula + ember
//   BTV-TEST-SOLO-0000-0000 → ok, pass:false, entitled to nebula only
//   BTV-TEST-FULL-0000-0000 → ok:false, reason:"activation_limit"
//   anything else            → ok:false, reason:"unknown_key"
//
// Theme metas match the app's ThemePackMeta shape (id, name, blurb,
// supportsLight, preview:{bg,surface,accent}) — see
// apps/app/src/features/settings/themePacks.ts. nebula and ember are both
// invented, dark-only packs (supportsLight:false).
//
// GET /payload/nebula and /payload/ember require headers x-license-key (one
// of the ok keys above, entitled to that theme) + x-machine (any non-empty
// value accepted — this fixture doesn't model per-machine activation
// counts, only the flat entitlement table below) and answer with the
// pack's raw CSS (text/css). A wrong/unentitled/missing key answers 403
// JSON {reason:"not_entitled"}.
//
// GET /__count → {validate:N, payload:N} request counters, for tests that
// need to prove a network call did (or, for a client-side shape-rejected
// key, did NOT) happen.
import http from "node:http";

const PORT = 8085;

const THEMES = {
  nebula: {
    id: "nebula",
    name: "Nebula",
    blurb:
      "Deep violet-noir — crushed indigo surfaces under a faint stellar haze.",
    supportsLight: false,
    preview: { bg: "#0a0713", surface: "#14101d", accent: "#9b6bff" },
  },
  ember: {
    id: "ember",
    name: "Ember",
    blurb:
      "Warm coal and banked embers — amber highlights over a low, glowing dark.",
    supportsLight: false,
    preview: { bg: "#120b08", surface: "#1d130d", accent: "#ff8a3d" },
  },
};

// Raw CSS payloads. Values are fixture-only (do not match the real
// services/keybox/payloads/*.css numbers) — verify-license.mjs asserts
// against these exact hexes.
const PAYLOADS = {
  nebula: ':root[data-theme-pack="nebula"]{--surface:#14101d;--bg:#0a0713;}',
  ember: ':root[data-theme-pack="ember"]{--surface:#1d130d;--bg:#120b08;}',
};

// key -> { ok:true, pass, themeIds } | { ok:false, reason }
const KEYS = {
  "BTV-TEST-PASS-0000-0000": { ok: true, pass: true, themeIds: ["nebula", "ember"] },
  "BTV-TEST-SOLO-0000-0000": { ok: true, pass: false, themeIds: ["nebula"] },
  "BTV-TEST-FULL-0000-0000": { ok: false, reason: "activation_limit" },
};

const counts = { validate: 0, payload: 0 };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type,x-license-key,x-machine",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

http
  .createServer(async (req, res) => {
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);

    // Approve any CORS preflight wholesale.
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);
    const json = (payload, status = 200) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(payload));
    };

    if (req.method === "POST" && url.pathname === "/validate") {
      counts.validate++;
      let body;
      try {
        body = JSON.parse((await readBody(req)) || "{}");
      } catch {
        return json({ ok: false, reason: "unknown_key" }, 400);
      }
      const entry = KEYS[body.key];
      if (!entry) return json({ ok: false, reason: "unknown_key" });
      if (!entry.ok) return json({ ok: false, reason: entry.reason });
      return json({
        ok: true,
        pass: entry.pass,
        themes: entry.themeIds.map((id) => THEMES[id]),
      });
    }

    if (req.method === "GET" && url.pathname.startsWith("/payload/")) {
      counts.payload++;
      const id = url.pathname.slice("/payload/".length);
      const key = req.headers["x-license-key"];
      const entry = key ? KEYS[key] : null;
      const entitled = entry?.ok && entry.themeIds.includes(id);
      if (!entitled || !PAYLOADS[id]) return json({ reason: "not_entitled" }, 403);
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/css");
      return res.end(PAYLOADS[id]);
    }

    if (req.method === "GET" && url.pathname === "/__count") {
      return json(counts);
    }

    res.statusCode = 404;
    return res.end("not found");
  })
  .listen(PORT, () => console.log(`fake keybox on :${PORT}`));

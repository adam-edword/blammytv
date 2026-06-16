import { serve } from "@hono/node-server";
import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";
import { ConfigBlobSchema, isCompleteShareCode, mockConfig } from "@blammytv/shared";
import {
  addXtreamSource,
  listSources,
  removeSource,
  setSourceEnabled,
  summarize,
} from "./store.js";
import { buildLive } from "./xtream/index.js";

/**
 * BlammyTV backend.
 *
 * The backend is the single source of truth; the apps render the ConfigBlob it
 * serves. It also makes the IPTV calls the browser can't (Xtream panels don't
 * send CORS headers) and holds the credentials, which never reach the device.
 *
 * Auth: every request carries the device's share code as a bearer token. For
 * now any well-formed code is accepted (one shared profile) — real per-user
 * accounts come with the web milestones.
 */

type Env = { Variables: { code: string } };

const PORT = Number(process.env.PORT ?? 8787);

const app = new Hono<Env>();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
  }),
);

// Gate everything but /health behind a share code.
app.use("/config", requireCode);
app.use("/admin/*", requireCode);

app.get("/health", (c) => c.json({ ok: true }));

app.get("/config", async (c) => {
  const code = c.get("code");
  const seed = mockConfig(`Living Room (${code})`);

  const enabled = listSources().filter((s) => s.enabled);
  if (enabled.length === 0) {
    // Nothing configured yet → serve the demo seed.
    return c.json(ConfigBlobSchema.parse(seed));
  }

  const live = await buildLive(enabled);
  if (live.channels.length === 0) {
    return c.json({ error: "no channels — check your playlist(s)" }, 502);
  }

  // Live comes from the playlists; VOD/stream stays seeded until aiostreams.
  return c.json(ConfigBlobSchema.parse({ ...seed, live }));
});

// ---- Playlists admin (used by the in-app settings) ----

app.get("/admin/sources", (c) => c.json(listSources().map(summarize)));

app.post("/admin/sources", async (c) => {
  const body = await c.req.json().catch(() => null);
  const baseUrl = str(body?.baseUrl);
  const username = str(body?.username);
  const password = str(body?.password);
  if (!baseUrl || !username || !password || !isHttpUrl(baseUrl)) {
    return c.json({ error: "baseUrl, username and password are required" }, 400);
  }
  const source = addXtreamSource({
    name: str(body?.name),
    baseUrl,
    username,
    password,
    liveExt: str(body?.liveExt),
  });
  return c.json(summarize(source), 201);
});

app.patch("/admin/sources/:id", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (typeof body?.enabled !== "boolean") {
    return c.json({ error: "expected { enabled: boolean }" }, 400);
  }
  return setSourceEnabled(c.req.param("id"), body.enabled)
    ? c.json({ ok: true })
    : c.json({ error: "not found" }, 404);
});

app.delete("/admin/sources/:id", (c) =>
  removeSource(c.req.param("id"))
    ? c.json({ ok: true })
    : c.json({ error: "not found" }, 404),
);

// ---- helpers ----

async function requireCode(c: Context<Env>, next: Next) {
  const header = c.req.header("Authorization");
  const code = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : "";
  if (!code || !isCompleteShareCode(code)) {
    return c.json({ error: "invalid or missing share code" }, 401);
  }
  c.set("code", code);
  await next();
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`blammytv server listening on http://localhost:${info.port}`);
});

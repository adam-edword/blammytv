import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ConfigBlobSchema, isCompleteShareCode, mockConfig } from "@blammytv/shared";

/**
 * BlammyTV backend — Milestone 1.
 *
 * The architecture rule: the backend is the single source of truth and the apps
 * are dumb terminals. This server's whole job is to hand a paired device a
 * validated ConfigBlob. For now that blob is seeded; later milestones swap the
 * seed for real data (live → Xtream, stream → a self-hosted aiostreams addon)
 * resolved from per-user config. Secrets (Xtream creds, the aiostreams manifest
 * URL) live here and never reach the device.
 */

const PORT = Number(process.env.PORT ?? 8787);

const app = new Hono();

// The device (static site / sideloaded app) lives on a different origin, so
// allow cross-origin reads of the config.
app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true }));

app.get("/config", (c) => {
  const code = bearer(c.req.header("Authorization"));
  if (!code || !isCompleteShareCode(code)) {
    return c.json({ error: "invalid or missing share code" }, 401);
  }

  // The shared zod schema is the contract — validate before sending so the
  // device only ever receives well-formed config.
  const blob = ConfigBlobSchema.parse(mockConfig(`Living Room (${code})`));
  return c.json(blob);
});

/** Pull the share code out of an `Authorization: Bearer <code>` header. */
function bearer(header?: string): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`blammytv server listening on http://localhost:${info.port}`);
});

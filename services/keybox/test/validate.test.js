import test from "node:test";
import assert from "node:assert/strict";
import { openDb, createKey } from "../src/db.js";
import { buildCatalog } from "../src/catalog.js";
import { makeApp } from "../src/server.js";

function testCatalog() {
  return buildCatalog({
    passPriceIds: ["price_pass_test"],
    themes: [
      {
        id: "nebula",
        name: "Nebula",
        blurb: "deep violet-noir",
        supportsLight: false,
        preview: { bg: "#0a0612", surface: "#120c1f", accent: "#c22727" },
        priceIds: ["price_nebula_test"],
      },
      {
        id: "solstice",
        name: "Solstice",
        blurb: "test-only second theme",
        supportsLight: false,
        preview: { bg: "#000000", surface: "#111111", accent: "#c22727" },
        priceIds: ["price_solstice_test"],
      },
    ],
  });
}

async function startApp() {
  const db = openDb(":memory:");
  const catalog = testCatalog();
  // /validate never calls out to Stripe, so an empty stub is enough here.
  const stripe = { webhooks: {}, checkout: { sessions: {} } };
  const app = makeApp({ db, stripe, catalog, webhookSecret: "whsec_unused" });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return { db, catalog, server, base: `http://127.0.0.1:${port}` };
}

async function validate(base, body) {
  const res = await fetch(`${base}/validate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test("validate: unknown key returns ok:false/unknown_key", async (t) => {
  const { server, base } = await startApp();
  t.after(() => server.close());

  const { status, body } = await validate(base, { key: "BTV-0000-0000-0000-0000", machine: "m1" });
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: false, reason: "unknown_key" });
});

test("validate: malformed request returns 400", async (t) => {
  const { server, base } = await startApp();
  t.after(() => server.close());

  const { status, body } = await validate(base, { key: "", machine: "m1" });
  assert.equal(status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "malformed_request");

  const missingMachine = await validate(base, { key: "BTV-0000-0000-0000-0000" });
  assert.equal(missingMachine.status, 400);
});

test("validate: pass key returns pass:true and every catalog theme", async (t) => {
  const { db, server, base } = await startApp();
  t.after(() => server.close());

  const { key } = createKey(db, { kind: "pass", themes: [], session: "cs_pass" });
  const { status, body } = await validate(base, { key, machine: "m1" });

  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.pass, true);
  assert.deepEqual(
    body.themes.map((t) => t.id).sort(),
    ["nebula", "solstice"],
  );
});

test("validate: theme key returns pass:false and only the owned themes", async (t) => {
  const { db, server, base } = await startApp();
  t.after(() => server.close());

  const { key } = createKey(db, { kind: "themes", themes: ["nebula"], session: "cs_theme" });
  const { status, body } = await validate(base, { key, machine: "m1" });

  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.pass, false);
  assert.deepEqual(body.themes.map((t) => t.id), ["nebula"]);
});

test("validate: activation cap allows 3 machines, rejects a 4th, and existing machines keep working", async (t) => {
  const { db, server, base } = await startApp();
  t.after(() => server.close());

  const { key } = createKey(db, { kind: "pass", themes: [], session: "cs_cap" });

  for (const machine of ["m1", "m2", "m3"]) {
    const { status, body } = await validate(base, { key, machine });
    assert.equal(status, 200);
    assert.equal(body.ok, true, `machine ${machine} should activate`);
  }

  const fourth = await validate(base, { key, machine: "m4" });
  assert.equal(fourth.status, 200);
  assert.deepEqual(fourth.body, { ok: false, reason: "activation_limit" });

  // An already-registered machine re-validating must keep working — it's
  // not a NEW activation, so it never counts against the cap.
  const again = await validate(base, { key, machine: "m1" });
  assert.equal(again.status, 200);
  assert.equal(again.body.ok, true);
});

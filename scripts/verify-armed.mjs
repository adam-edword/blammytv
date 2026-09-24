// E2E: armed and destructive states, and the words inside them (v0.9.90).
//
// v0.9.56's prune parked every `--armed` / `--danger` rule with the button
// paint, and several of these buttons are `size="icon-sm"`, a 32px square.
// So after it:
//   - Library's "Clear history" and a list's "Delete" were plain outline
//     buttons in every state, armed included, no danger colour anywhere;
//   - a playlist's delete, armed, said "Sure?" out of a 32px square;
//   - a list item's "Remove" sat on every poster, spilling out of one.
//
// Each check reads the rendered state rather than a class, because the
// classes were all still there the whole time; only the paint was gone.
// Not covered: the tournament draw's selected chip and the league tile's
// armed cover, which need an ESPN tournament and followed leagues on a
// board no harness here builds yet.
//
//   node scripts/fake-panel.mjs   # :8081
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-armed.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? ` — ${d}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

async function open(seed) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**://v3-cinemeta.strem.io/**", (r) => r.abort());
  await page.route("**://image.tmdb.org/**", (r) => r.abort());
  await page.addInitScript((s) => {
    localStorage.setItem("btv:onboarded", "1");
    sessionStorage.setItem("btv:welcome-played", "1");
    for (const [k, v] of Object.entries(s))
      localStorage.setItem(`blammytv.${k}`, JSON.stringify({ v: 1, data: v }));
  }, seed);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".navcap", { timeout: 20_000 });
  return { ctx, page };
}

/**
 * Red, and actually painted: shadcn's destructive in either theme. Chromium
 * reports these as oklab(L a b / alpha), where a positive `a` is the red
 * side; an alpha under 0.3 is a tint, not a destructive button.
 */
const isRed = (c) => {
  const n = c.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  const alpha = c.includes("/") ? n[3] : c.startsWith("rgba") ? n[3] : 1;
  if (c.startsWith("oklab")) return n[1] > 0.08 && alpha >= 0.3;
  if (c.startsWith("oklch")) return n[1] > 0.1 && (n[2] < 60 || n[2] > 340) && alpha >= 0.3;
  return n[0] > n[1] + 60 && n[0] > n[2] + 60 && alpha >= 0.3;
};
/** After the Button's 150ms transition, or a state reads half-painted. */
const bg = async (loc) => {
  await loc.page().waitForTimeout(350);
  return loc.evaluate((el) => getComputedStyle(el).backgroundColor);
};
/** The label fits inside its own button. */
const fits = (loc) =>
  loc.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1);

// ---- Library: Clear history, a list's Delete, and Remove on a poster ----
{
  const now = Date.now();
  const { ctx, page } = await open({
    listsMigrated: true,
    watching: [
      { id: "tt1", title: "A Watched Film", label: "Movie", kind: "movie", posSec: 600, durSec: 5400, at: now },
    ],
    lists: [
      {
        id: "l1",
        name: "Weekend",
        at: now,
        entries: [{ id: "tt2", title: "A Listed Film", kind: "movie", at: now }],
      },
    ],
  });
  await page.getByRole("button", { name: /^library$/i }).first().click({ timeout: 8000 });
  // History is the list card titled "Library" (LibraryScreen's HISTORY).
  await page.locator('.library__card[title="Library"]').click({ timeout: 10_000 });

  const clear = page.getByRole("button", { name: "Clear history" });
  await clear.waitFor({ timeout: 15_000 });
  check("Clear history is not destructive before it is armed", !isRed(await bg(clear)), await bg(clear));
  await clear.click();
  const armedClear = page.getByRole("button", { name: "Click again to confirm" });
  check(
    "armed, Clear history turns destructive",
    (await armedClear.count()) === 1 && isRed(await bg(armedClear)),
    (await armedClear.count()) ? await bg(armedClear) : "no armed button",
  );

  // Back to the grid, then into the user's list.
  await page.getByRole("button", { name: /back/i }).first().click();
  await page.locator('.library__card[title="Weekend"]').click({ timeout: 10_000 });
  const del = page.getByRole("button", { name: "Delete", exact: true });
  await del.waitFor({ timeout: 10_000 });
  await del.click();
  const armedDel = page.getByRole("button", { name: "Click again to confirm" });
  check(
    "armed, a list's Delete turns destructive",
    (await armedDel.count()) === 1 && isRed(await bg(armedDel)),
    (await armedDel.count()) ? await bg(armedDel) : "no armed button",
  );

  const item = page.locator(".library__item").first();
  const remove = item.locator(".library__remove");
  await remove.waitFor({ state: "attached", timeout: 10_000 });
  await page.mouse.move(2, 2);
  await page.waitForTimeout(350);
  check(
    "a poster's Remove is hidden until its card is hovered",
    Number(await remove.evaluate((el) => getComputedStyle(el).opacity)) === 0,
  );
  await item.hover();
  await page.waitForTimeout(350);
  check(
    "and then shows, with the word inside the button",
    Number(await remove.evaluate((el) => getComputedStyle(el).opacity)) === 1 && (await fits(remove)),
  );
  await ctx.close();
}

// ---- Settings: a playlist's delete, armed ------------------------------
{
  const { ctx, page } = await open({
    playlists: [
      {
        kind: "xtream",
        id: "t",
        name: "Test",
        enabled: true,
        server: "http://localhost:8081",
        username: "u",
        password: "p",
      },
    ],
  });
  await page.locator("button[aria-label='Settings']").click();
  const del = page.getByRole("button", { name: "Delete Test" });
  await del.waitFor({ timeout: 10_000 });
  await del.click();
  const armed = page.getByRole("button", { name: "Click again to remove Test" });
  await armed.waitFor({ timeout: 5_000 });
  check("armed, the playlist delete says Sure?", (await armed.textContent())?.trim() === "Sure?");
  check("and the word fits inside the button", await fits(armed));
  check("and it is destructive", isRed(await bg(armed)), await bg(armed));
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);

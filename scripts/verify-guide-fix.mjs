// E2E: a channel whose guide didn't match can be matched by hand (v0.11.25).
//
// The guide matches a channel by the id its provider gave it. A provider
// that gives a wrong one leaves the channel on "No Information" with the
// right listings sitting in the download, and the parse threw away every
// guide channel nobody matched, names included. Now the parse keeps the
// guide's own channel list on the source, the Guide's right-click menu has
// Fix guide…, and its dialog searches that list and saves the pick. A fix
// reaches the screen through the forced refresh, which downloads each guide
// again and parses it with the fix in the index.
//
// Against the fake panel's "fix" line: one channel with a guide id the guide
// does not have ("US: Mismatched News FHD"), whose listings are under
// "mm.guide", beside a control channel that matches properly. A Stalker
// portal is the second source, because its channels must NOT offer the item.
//
// What this holds:
// - the lane says "No Information" before, and the menu item is on the
//   Xtream channels and not on the Stalker one;
// - the dialog says "No guide matched", has the search focused, and lists the
//   guide channel at the top for a plausible name; a search narrows it;
// - Use this guide is off until a row is picked, then saves, closes, says it
//   takes a moment, downloads the guide ONCE more, and the lane fills;
// - the fix survives a reload (and the reload downloads nothing: the guide
//   is reused);
// - the dialog then says "Fixed by you", and Remove fix puts the lane back
//   to "No Information" after one more download;
// - Escape closes the dialog and only the dialog.
//
//   node scripts/fake-panel.mjs                    # :8081
//   LAX=1 node scripts/fake-stalker.mjs            # :8083
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-guide-fix.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
import { goTo } from "./nav-settle.mjs";

const URL = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

const PLAYLISTS = {
  v: 1,
  data: [
    {
      kind: "xtream",
      id: "fx",
      name: "Fix Line",
      enabled: true,
      server: "http://localhost:8081",
      username: "fix",
      password: "p",
    },
    {
      kind: "stalker",
      id: "st",
      name: "Test Portal",
      enabled: true,
      portal: "http://localhost:8083",
      mac: "00:1A:79:AA:BB:CC",
    },
  ],
};
const BAD = "fx:7001"; // US: Mismatched News FHD, the one the guide did not match
const GOOD = "fx:7000"; // Fix Matched Sports HD, the control
const STALKER = "st:101"; // Fake News One

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// Offline, like every harness: only the fakes on localhost.
await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const seen = [];
page.on("request", (r) => seen.push(r.url()));
await page.addInitScript((pl) => {
  // Once: a reload below must see what the app and the harness left.
  if (sessionStorage.getItem("seeded")) return;
  sessionStorage.setItem("seeded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.playlists", JSON.stringify(pl));
}, PLAYLISTS);

const guideLoads = () => seen.filter((u) => /localhost:8081\/xmltv\.php/.test(u)).length;
const waitFor = async (fn, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await page.waitForTimeout(100);
  }
  return false;
};
const row = (id) => page.locator(`.guide__row[data-channel="${id}"]`);
const titles = (id) =>
  row(id).locator(".guide__cell:not(.guide__cell--blank)").evaluateAll((els) => els.map((e) => e.dataset.hint ?? ""));
const blank = (id) => row(id).locator(".guide__cell--blank .guide__cell-body").textContent().catch(() => null);
const dialog = page.getByRole("dialog");
const fixes = () =>
  page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("blammytv.guideFixes") ?? "null")?.data ?? {};
    } catch {
      return null;
    }
  });
/** The disk record's per-group guide channel lists, as the app wrote them. */
const readRecord = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open("blammytv", 1);
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("liveCache")) return resolve(null), db.close();
          const rq = db.transaction("liveCache").objectStore("liveCache").get("live");
          rq.onsuccess = () => {
            const v = rq.result;
            db.close();
            resolve(v ? Object.fromEntries(v.data.groups.map((g) => [g.id, g.guideChannels?.length ?? null])) : null);
          };
          rq.onerror = () => (db.close(), resolve(null));
        };
      }),
  );
/** Right-click a channel's card; resolves once the menu is up. */
async function menuOn(id) {
  await row(id).locator(".guide__card").click({ button: "right" });
  await page.getByRole("menu").waitFor({ timeout: 5000 });
}
const itemNamed = (name) => page.getByRole("menuitem", { name });
async function closeMenu() {
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "detached", timeout: 5000 });
}
async function openDialog(id) {
  await menuOn(id);
  await itemNamed("Fix guide…").click();
  await dialog.waitFor({ timeout: 5000 });
}
const options = () => dialog.getByRole("option");
const optionNames = () => options().evaluateAll((els) => els.map((e) => e.querySelector(".mvpick__nametext")?.textContent ?? ""));

// ---- Cold load
await page.goto(URL, { waitUntil: "domcontentloaded" });
await goTo(page, "guide");
await row(GOOD).waitFor({ timeout: 30_000 });
const landed = await waitFor(async () => (await titles(GOOD)).some((t) => t.startsWith("Matched Hour")), 20_000);
check("the control channel's guide lands", landed);
check("the Stalker portal's channels are there too", (await row(STALKER).count()) === 1);
check("the channel whose guide id matches nothing says No Information", (await blank(BAD))?.trim() === "No Information", String(await blank(BAD)));
check("the cold load downloaded the guide once", guideLoads() === 1, String(guideLoads()));

// Settle the disk write: the record carries the list.
const wrote = await waitFor(async () => (await readRecord())?.fx > 0, 10_000);
const rec = await readRecord();
check("the disk record keeps the guide's channel list for the Xtream source and none for Stalker", wrote && rec.fx === 6 && rec.st === null, JSON.stringify(rec));

// ---- The menu
await menuOn(BAD);
check("Fix guide… is in the menu for a channel of an Xtream source", (await itemNamed("Fix guide…").count()) === 1);
check("  beside the item that was there", (await itemNamed("Add to multi-view").count()) === 1);
await closeMenu();
await menuOn(STALKER);
check("  and not for a Stalker channel", (await itemNamed("Fix guide…").count()) === 0 && (await itemNamed("Add to multi-view").count()) === 1);
await closeMenu();

// ---- The dialog
await openDialog(BAD);
const title = await dialog.getByRole("heading").first().textContent();
check("the dialog is titled with the channel's name", title === "US: Mismatched News FHD", String(title));
check("  and says no guide matched", (await dialog.textContent()).includes("No guide matched"));
const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
check("  with the search focused", focused === "Search the guide's channels", String(focused));
let names = await optionNames();
const at = names.indexOf("Mismatched News");
check("  and the guide's channel for a plausible name near the top of the list", at >= 0 && at <= 1, JSON.stringify(names));
check("  then the next-closest name (one word in common), before the ones with none", names[0] === "Mismatched News" && names[1] === "News Wire", JSON.stringify(names));
check("  every guide channel is there, under the cap", names.length === 6, String(names.length));
const useBtn = dialog.getByRole("button", { name: "Use this guide" });
check("  Use this guide waits for a pick", await useBtn.isDisabled());
check("  and there is no Remove fix to offer yet", (await dialog.getByRole("button", { name: "Remove fix" }).count()) === 0);

await dialog.getByRole("combobox").fill("wea");
names = await optionNames();
check("a search narrows the list", names.length === 1 && names[0] === "Weather Now", JSON.stringify(names));
await dialog.getByRole("combobox").fill("movies.guide");
names = await optionNames();
check("  by the guide's own id too", names.length === 1 && names[0] === "Retro Movies", JSON.stringify(names));
await dialog.getByRole("combobox").fill("zzzz");
check("  and says so when nothing matches", (await options().count()) === 0 && (await dialog.textContent()).includes("Nothing matches that"));
await dialog.getByRole("combobox").fill("");
names = await optionNames();
check("  clearing it brings the closest names back", names.length === 6 && names[0] === "Mismatched News", JSON.stringify(names));

// Escape closes the dialog and only the dialog: Radix marks the key as taken,
// which is what the app's own Escape handlers (leave full screen, leave the
// theater) look for.
await page.evaluate(() => {
  window.__esc = [];
  window.addEventListener("keydown", (e) => e.key === "Escape" && window.__esc.push(e.defaultPrevented));
});
await page.keyboard.press("Escape");
await dialog.waitFor({ state: "detached", timeout: 5000 });
const esc = await page.evaluate(() => window.__esc);
check("Escape closes the dialog and marks the key taken", esc.length === 1 && esc[0] === true, JSON.stringify(esc));
check("  and nothing was saved", Object.keys(await fixes()).length === 0, JSON.stringify(await fixes()));
check("  the Guide is where it was, and clickable", await row(BAD).isVisible() && (await page.evaluate(() => getComputedStyle(document.body).pointerEvents)) !== "none");

// ---- Use this guide
await openDialog(BAD);
await options().filter({ hasText: "Mismatched News" }).click();
check("picking a row marks it", (await options().filter({ hasText: "Mismatched News" }).getAttribute("aria-selected")) === "true");
check("  and turns Use this guide on", await useBtn.isEnabled());
const before = guideLoads();
await useBtn.click();
await dialog.waitFor({ state: "detached", timeout: 5000 });
const toast = await page.locator(".live-toast__msg").textContent({ timeout: 3000 }).catch(() => null);
check("it closes, and says the guide takes a moment", /takes a moment/.test(toast ?? ""), String(toast));
check("  with nothing to undo in the toast", (await page.locator(".live-toast__undo").count()) === 0);
check("the fix is saved against the playlist and the channel", JSON.stringify(await fixes()) === JSON.stringify({ fx: { [BAD]: "mm.guide" } }), JSON.stringify(await fixes()));
const filled = await waitFor(async () => (await titles(BAD)).some((t) => t.startsWith("Mapped Hour")), 20_000);
check("the lane fills with the mapped guide's programmes", filled, JSON.stringify((await titles(BAD)).slice(0, 3)));
await page.waitForTimeout(1500);
check("  after exactly one more guide download", guideLoads() === before + 1, `${before} -> ${guideLoads()}`);
check("  and the control channel kept its own", (await titles(GOOD)).some((t) => t.startsWith("Matched Hour")));
const back = await page.evaluate(() => document.activeElement?.className ?? "");
check("  focus went back to the channel's card", /guide__card/.test(back), back);

// ---- It survives a reload
await waitFor(async () => (await readRecord())?.fx > 0, 10_000);
await page.waitForTimeout(2500); // scheduleDiskPut's 1.5s: the record has the fixed guide
const loadsBeforeReload = guideLoads();
await page.reload({ waitUntil: "domcontentloaded" });
await goTo(page, "guide");
await row(BAD).waitFor({ timeout: 30_000 });
const kept = await waitFor(async () => (await titles(BAD)).some((t) => t.startsWith("Mapped Hour")), 20_000);
check("the fix survives a reload: the lane is still filled", kept, JSON.stringify((await titles(BAD)).slice(0, 3)));
await page.waitForTimeout(1500);
check("  and the reload downloaded no guide (it is reused, fix and all)", guideLoads() === loadsBeforeReload, `${loadsBeforeReload} -> ${guideLoads()}`);
check("  the store still has it", JSON.stringify(await fixes()) === JSON.stringify({ fx: { [BAD]: "mm.guide" } }));

// ---- Remove fix
await openDialog(BAD);
check("the dialog now says it is fixed by you", (await dialog.textContent()).includes("Fixed by you: Mismatched News"));
check("  marks the current row", (await options().filter({ hasText: "Mismatched News" }).textContent()).includes("Current"));
const remove = dialog.getByRole("button", { name: "Remove fix" });
check("  and offers Remove fix", (await remove.count()) === 1);
const before2 = guideLoads();
await remove.click();
await dialog.waitFor({ state: "detached", timeout: 5000 });
const gone = await waitFor(async () => (await blank(BAD))?.trim() === "No Information", 20_000);
check("Remove fix puts the lane back to No Information", gone, String(await blank(BAD)));
await page.waitForTimeout(1500);
check("  after exactly one more guide download", guideLoads() === before2 + 1, `${before2} -> ${guideLoads()}`);
check("  and the store is empty", Object.keys(await fixes()).length === 0, JSON.stringify(await fixes()));
await openDialog(BAD);
check("  the dialog says no guide matched again", (await dialog.textContent()).includes("No guide matched"));
await page.keyboard.press("Escape");
await dialog.waitFor({ state: "detached", timeout: 5000 });

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);

// E2E: Settings → Appearance → Appearance, light mode's way back (plan 022).
//
// Dark, Light, or Match Windows (prefers-color-scheme, which WebView2 takes
// from Windows). From v0.9.58 to v0.10.64 main.tsx forced dark whatever was
// stored; the parts of this that can break do so quietly:
//   - the boot line. Drop it and a pick works until the next launch.
//   - Match Windows following Windows while the app is open, not only at
//     launch.
//   - the grey page: light's page is a grey with white cards on it, not
//     shadcn's white on white.
//   - Reset going back to Dark.
//   - the windowed player's rounded corners being the page's colour in light,
//     not the picture's dark (audit N4).
//
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-appearance.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${n}${d ? `: ${d}` : ""}`);
};

const URL = process.env.APP_URL ?? "http://localhost:4173/";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
await ctx.route((u) => u.hostname !== "localhost", (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => {
  localStorage.setItem("btv:onboarded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
});
const boot = async () => {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".navcap", { timeout: 20_000 });
};
const state = () =>
  page.evaluate(() => {
    const root = document.documentElement;
    const css = getComputedStyle(root);
    return {
      theme: root.dataset.theme ?? "dark",
      page: getComputedStyle(document.body).backgroundColor,
      card: css.getPropertyValue("--surface").trim(),
      track: css.getPropertyValue("--surface-track").trim(),
    };
  });
const group = () => page.getByRole("group", { name: "Appearance" });
const openAppearance = async () => {
  await page.locator("button[aria-label='Settings']").click();
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  await group().waitFor({ timeout: 10_000 });
};
const pick = async (label) => {
  await group().getByRole("button", { name: label, exact: true }).click();
  await page.waitForTimeout(100);
};
const pressed = async () =>
  group().locator("button[aria-pressed='true']").getAttribute("aria-label");

await boot();
const fresh = await state();
check("a fresh profile opens dark", fresh.theme === "dark" && fresh.page === "oklch(0.145 0 0)", JSON.stringify(fresh));

await openAppearance();
check("Dark is the chosen option on a fresh profile", (await pressed()) === "Dark");
await pick("Light");
const light = await state();
check(
  "Light turns the app light, on a grey page with white cards",
  light.theme === "light" && light.page === "oklch(0.965 0 0)" && light.card === "oklch(1 0 0)" && light.track === "oklch(0.93 0 0)",
  JSON.stringify(light),
);

// On a picture (the player's chrome, multi-view's tiles, the hero), the
// theme's own accent gives way to dark's: light's is near-black, and the
// seek bar and sound ring would be dark on video. A picked colour stays.
const accents = () =>
  page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "on-picture";
    document.body.append(probe);
    const read = (el) => getComputedStyle(el).getPropertyValue("--accent").trim();
    const out = { page: read(document.documentElement), picture: read(probe) };
    probe.remove();
    return out;
  });
const defaultAccent = await accents();
const blue = page.getByRole("group", { name: "Accent color" }).getByRole("button", { name: "Blue", exact: true });
await blue.click();
const pickedAccent = await accents();
check(
  "in light, a picture takes dark's accent unless a colour was picked",
  defaultAccent.page === "oklch(0.205 0 0)" && defaultAccent.picture === "oklch(0.922 0 0)" &&
    pickedAccent.page === pickedAccent.picture && pickedAccent.picture.startsWith("#"),
  JSON.stringify({ defaultAccent, pickedAccent }),
);
await page.getByRole("group", { name: "Accent color" }).getByRole("button", { name: /Default/ }).click();

await boot();
check("and it is still light after a restart", (await state()).theme === "light");

// Match Windows: follows the OS at launch and while open.
await openAppearance();
check("the restarted Settings shows Light chosen", (await pressed()) === "Light");
await pick("Match Windows");
const withDarkOs = (await state()).theme;
await page.emulateMedia({ colorScheme: "light" });
await page.waitForTimeout(150);
const osTurnedLight = (await state()).theme;
await page.emulateMedia({ colorScheme: "dark" });
await page.waitForTimeout(150);
const osTurnedDark = (await state()).theme;
check(
  "Match Windows follows Windows while the app is open",
  withDarkOs === "dark" && osTurnedLight === "light" && osTurnedDark === "dark",
  `${withDarkOs} → ${osTurnedLight} → ${osTurnedDark}`,
);
await page.emulateMedia({ colorScheme: "light" });
await boot();
check("and at launch", (await state()).theme === "light");

// Picking a theme stops following Windows. Windows is flipped for real: the
// page is already light here, and emulating light on a light page fires no
// change event, so this passed with the listener still attached. Windows goes
// dark first (Match Windows follows it), Dark is picked, and only then does
// Windows go light.
await openAppearance();
await page.emulateMedia({ colorScheme: "dark" });
await page.waitForTimeout(150);
const followedDark = (await state()).theme;
await pick("Dark");
await page.emulateMedia({ colorScheme: "light" });
await page.waitForTimeout(150);
const windowsNow = await page.evaluate(() => (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
check(
  "Dark stays dark whatever Windows says",
  followedDark === "dark" && windowsNow === "light" && (await state()).theme === "dark",
  `Windows went dark (app ${followedDark}), Dark picked, Windows went ${windowsNow} (app ${(await state()).theme})`,
);

// Reset Appearance goes back to Dark.
await pick("Light");
// Two presses since the pages (v0.11.26): Reset arms, then confirms.
await page.getByRole("button", { name: "Reset", exact: true }).click();
await page.getByRole("button", { name: "Click again to confirm" }).click();
await page.waitForTimeout(150);
check(
  "Reset Appearance goes back to Dark",
  (await state()).theme === "dark" && (await pressed()) === "Dark",
);
// The windowed player draws four corner wedges over the video in the page's
// colour, so the inset picture reads as rounded. The chrome wears
// .on-picture, which makes --bg the picture's dark, and the wedges said --bg:
// near-black notches on light's grey page (audit N4). ?overlay=1 is the chrome
// on a page of its own. It takes the windowed state from the window's size,
// so the screen is made bigger than the window (at the screen's width it is
// the fullscreen chrome, which has no wedges).
{
  const ovCtx = await browser.newContext({ viewport: { width: 1100, height: 650 }, screen: { width: 1920, height: 1080 } });
  await ovCtx.route((u) => u.hostname !== "localhost", (r) => r.abort());
  const ov = await ovCtx.newPage();
  ov.on("pageerror", (e) => errors.push(String(e)));
  await ov.addInitScript(() => {
    const off = () => () => {};
    window.overlayApi = {
      close() {}, setPause() {}, setMute() {}, setVolume() {}, seek() {}, seekAbs() {}, seekTo() {}, setSpeed() {},
      expand() {}, collapse() {}, fullscreen() {}, exitFullscreen() {}, popout() {}, panel() {},
      toggleFavorite() {}, goLive() {}, setMouseIgnore() {}, selectAudio() {}, selectSub() {},
      getMeta: async () => ({ channelName: "Fake Movie", title: "Fake Movie", live: false }),
      onMeta: off, onLoading: off, onKey: off, onTime: off, onTracks: off, onChapters: off,
      getLoading: () => false, getTime: () => null, getTracks: () => null, getChapters: () => [],
    };
    localStorage.setItem("btv:onboarded", "1");
    sessionStorage.setItem("btv:welcome-played", "1");
  });
  await ov.goto(`${URL}?overlay=1`, { waitUntil: "domcontentloaded" });
  await ov.locator(".theater-overlay").first().waitFor({ timeout: 15_000 });
  const windowed = await ov.evaluate(() => !document.querySelector(".theater-overlay").classList.contains("theater-overlay--fs"));
  const corners = {};
  for (const theme of ["dark", "light"]) {
    await ov.evaluate((theme) => {
      if (theme === "light") document.documentElement.dataset.theme = "light";
      else delete document.documentElement.dataset.theme;
    }, theme);
    await ov.waitForTimeout(200);
    const png = await ov.screenshot();
    corners[theme] = await ov.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const at = (x, y) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)];
      // What the page paints around the player: --bg on the root, resolved.
      g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
      g.fillRect(0, 0, 1, 1);
      const surround = [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)];
      g.drawImage(img, 0, 0);
      const [w, h] = [img.width, img.height];
      return { surround, corners: [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)] };
    }, png.toString("base64"));
  }
  await ovCtx.close();
  // One level of slack: a gradient is rasterised through a float path.
  const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 1);
  check(
    "the windowed player's four corners are the page's colour, in dark and in light",
    windowed && ["dark", "light"].every((t) => corners[t].corners.every((c) => same(c, corners[t].surround))),
    JSON.stringify({ windowed, ...corners }),
  );
}
check("no page errors", errors.length === 0, errors[0]?.slice(0, 160));

await browser.close();
process.exit(fail ? 1 : 0);

// E2E: Classic's Settings, the Display Properties dialog (plan 035, "Classic
// across the app"): one fixed frame on all six tabs, a page that scrolls,
// group boxes for the headings, Windows 2000 type and controls, and Default
// untouched.
//
// What can go wrong here is quiet:
//   - the dialog changing size per tab (Accounts short, Playback tall), or the
//     title bar squeezed to a different height by its flex parent: both read as
//     the window jumping when you click a tab.
//   - a long page clipped with no way to reach its last row.
//   - the Default eyebrow headings, grey notes and flat controls leaking back.
//   - Default or another pack wearing any of it.
//
// Headless Chromium hides scrollbars (--hide-scrollbars), so this launches
// without that flag: the scrollbar's 16px is how "there is one" is measured.
// Everything external is aborted.
//
//   node scripts/fake-panel.mjs; node scripts/fake-aio.mjs   # :8081, :8084
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-classic-settings.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${n}${d ? `: ${d}` : ""}`);
};

const APP = process.env.APP_URL ?? "http://localhost:4173/";
const PLAYLISTS = {
  v: 1,
  data: [
    { kind: "xtream", id: "t", name: "Test", enabled: true, server: "http://localhost:8081", username: "u", password: "p" },
    { kind: "m3u", id: "m", name: "M3U", enabled: true, url: "http://localhost:8082/playlist.m3u" },
  ],
};
const AIO = { v: 1, data: "http://localhost:8084/manifest.json" };
const TABS = ["Home", "Sources", "Playback", "Appearance", "Accounts", "App"];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", ignoreDefaultArgs: ["--hide-scrollbars"] });

async function open(pack) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, colorScheme: "dark" });
  await ctx.route((u) => u.hostname !== "localhost", (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ pack, PLAYLISTS, AIO }) => {
      localStorage.setItem("btv:onboarded", "1");
      localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
      sessionStorage.setItem("btv:welcome-played", "1");
      if (!sessionStorage.getItem("btv:cs-seeded")) {
        sessionStorage.setItem("btv:cs-seeded", "1");
        localStorage.setItem("blammytv.playlists", JSON.stringify(PLAYLISTS));
        localStorage.setItem("blammytv.aiostreams", JSON.stringify(AIO));
        if (pack) localStorage.setItem("blammytv.themePack", JSON.stringify({ v: 1, data: pack }));
      }
    },
    { pack, PLAYLISTS, AIO },
  );
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".navcap, .cl-header", { timeout: 20_000 });
  return { ctx, page, errors };
}

const rgbOf = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
const lum = ([r, g, b]) => {
  const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [x, y] = [lum(rgbOf(a)), lum(rgbOf(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

// ------------------------------------------------------------------ Classic
{
  const { ctx, page, errors } = await open("classic");
  await page.locator('[data-cl="settings"]').click();
  const dlg = page.locator(".settings--classic");
  await dlg.waitFor();
  const rows = {};
  for (const tab of TABS) {
    await dlg.locator(`.cl-tabs [data-rail="${tab.toLowerCase()}"]`).click();
    await page.waitForTimeout(500);
    rows[tab] = await page.evaluate(() => {
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 100) / 100);
      };
      const d = document.querySelector(".settings--classic");
      const body = d.querySelector(".settings__body");
      const face = getComputedStyle(body).backgroundColor;
      const notes = [...body.querySelectorAll(".settings__section-note, .xtrow__kind, .xtedit__hint, .update-notes__body")].filter((e) => e.getClientRects().length);
      const titles = [...body.querySelectorAll(".customize-row__title, .settings-field__label")].filter((e) => e.getClientRects().length);
      const groups = [...body.querySelectorAll("fieldset.cl-group")];
      const g0 = groups[0] && getComputedStyle(groups[0]);
      return {
        dialog: box(d),
        title: box(d.querySelector(".cl-title")),
        tabs: box(d.querySelector(".cl-tabs")),
        foot: box(d.querySelector(".cl-foot")),
        body: box(body),
        overflow: body.scrollHeight > body.clientHeight + 1,
        gutter: body.offsetWidth - body.clientWidth,
        face,
        noteColors: notes.map((e) => getComputedStyle(e).color),
        noteSizes: [...new Set(notes.map((e) => getComputedStyle(e).fontSize))],
        titleSizes: [...new Set(titles.map((e) => getComputedStyle(e).fontSize))],
        titleWeights: [...new Set(titles.map((e) => getComputedStyle(e).fontWeight))],
        groups: groups.length,
        legends: groups.map((g) => g.querySelector(":scope > legend")?.textContent ?? ""),
        eyebrows: body.querySelectorAll("h3.settings__group").length,
        groupBorder: g0 ? `${g0.borderTopStyle} ${g0.borderTopWidth}` : "",
        groupRadius: g0?.borderRadius ?? "",
      };
    });
  }
  const same = (key) => new Set(TABS.map((t) => JSON.stringify(rows[t][key]))).size === 1;
  check("one frame: the dialog's rect is identical on all six tabs", same("dialog"), JSON.stringify(TABS.map((t) => rows[t].dialog)));
  check("one frame: the title bar's rect is identical on all six tabs", same("title"), JSON.stringify(TABS.map((t) => rows[t].title)));
  check("the title bar is 18px, as Windows 2000's", rows.Home.title[3] === 18, String(rows.Home.title[3]));
  check("one frame: the tab strip's rect is identical on all six tabs", same("tabs"), JSON.stringify(TABS.map((t) => rows[t].tabs)));
  check("one frame: the page and the Close row are identical on all six tabs", same("body") && same("foot"));

  for (const tab of TABS) {
    const r = rows[tab];
    check(`${tab}: group boxes (fieldset and legend), no Default eyebrow headings`, r.groups >= 1 && r.eyebrows === 0 && r.legends.every((l) => l.length > 0) && r.groupBorder === "solid 1px" && r.groupRadius === "0px", JSON.stringify([r.groups, r.eyebrows, r.legends, r.groupBorder]));
    check(`${tab}: row titles are 12px and regular`, r.titleSizes.every((s) => s === "12px") && r.titleWeights.every((w) => w === "400"), JSON.stringify([r.titleSizes, r.titleWeights]));
    if (r.noteColors.length) {
      const worst = Math.min(...r.noteColors.map((c) => contrast(c, r.face)));
      check(`${tab}: descriptions are the dialog's ink, contrast at least 4.5 on the face`, worst >= 4.5 && r.noteSizes.every((s) => s === "11px"), `${worst.toFixed(1)} ${JSON.stringify(r.noteSizes)}`);
    }
  }
  check("Playback and Appearance have a page taller than the dialog", rows.Playback.overflow && rows.Appearance.overflow);

  // The page scrolls: a Classic scrollbar, and the last control is reachable.
  for (const tab of TABS) {
    if (!rows[tab].overflow) continue;
    await dlg.locator(`.cl-tabs [data-rail="${tab.toLowerCase()}"]`).click();
    await page.waitForTimeout(400);
    const end = await page.evaluate(async () => {
      const body = document.querySelector(".settings__body");
      body.scrollTop = body.scrollHeight;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const br = body.getBoundingClientRect();
      const live = [...body.querySelectorAll("button, input, select, textarea, [role=switch], a[href]")].filter((e) => e.getClientRects().length);
      const last = live[live.length - 1];
      const lr = last.getBoundingClientRect();
      return {
        gutter: body.offsetWidth - body.clientWidth,
        atEnd: Math.abs(body.scrollTop + body.clientHeight - body.scrollHeight) <= 1,
        inView: lr.top >= br.top - 1 && lr.bottom <= br.bottom + 1,
        last: (last.getAttribute("aria-label") || last.textContent || last.tagName).trim().slice(0, 30),
      };
    });
    check(`${tab}: a 16px scrollbar, and the last control (${end.last}) is reachable at the bottom`, end.gutter === 16 && end.atEnd && end.inView, JSON.stringify(end));
  }
  check("the scrollbar thumb is Classic's grey, raised", await page.evaluate(() => getComputedStyle(document.querySelector(".settings__body"), "::-webkit-scrollbar-thumb").backgroundColor === "rgb(212, 208, 200)"));

  // Controls: each in its Windows 2000 form.
  const probe = (tab, fn, arg) => dlg.locator(`.cl-tabs [data-rail="${tab.toLowerCase()}"]`).click().then(() => page.waitForTimeout(400)).then(() => page.evaluate(fn, arg));
  const home = await probe("Home", () => {
    const cs = (s) => {
      const e = document.querySelector(s);
      return e ? getComputedStyle(e) : null;
    };
    const imp = [...document.querySelectorAll(".xtedit__minehead button")].map((b) => getComputedStyle(b).boxShadow);
    const x = cs(".homerows__x");
    const r = document.querySelector(".homerows__x")?.getBoundingClientRect();
    return { imp, xShadow: x?.boxShadow, xBg: x?.backgroundColor, xSize: r ? [r.width, r.height] : null, radius: x?.borderRadius };
  });
  check("Home: Import Layout and Add Row are bevelled push buttons", home.imp.length === 2 && home.imp.every((s) => s.includes("inset") && s.includes("rgb(64, 64, 64)")), JSON.stringify(home.imp));
  check("Home: a row's x is a small bevelled button on the face", home.xShadow?.includes("inset") && home.xBg === "rgb(212, 208, 200)" && home.xSize?.join() === "18,16" && home.radius === "0px", JSON.stringify(home));

  const src = await probe("Sources", () => {
    const row = document.querySelector(".playlist-row");
    const adv = document.querySelector(".playlist-advanced__trigger button");
    const arrow = document.querySelector(".playlist-row__expand");
    const a = getComputedStyle(adv);
    const ar = getComputedStyle(arrow);
    const rr = getComputedStyle(row);
    return {
      rowBg: rr.backgroundColor,
      rowShadow: rr.boxShadow,
      rowRadius: rr.borderRadius,
      advBg: a.backgroundColor,
      advShadow: a.boxShadow,
      arrowShadow: ar.boxShadow,
      arrowImg: ar.backgroundImage.slice(0, 20),
      arrowW: arrow.getBoundingClientRect().width,
      adjacent: Math.abs(adv.getBoundingClientRect().right - arrow.getBoundingClientRect().left) <= 2,
    };
  });
  check("Sources: a playlist is a line in a sunken white list box", src.rowBg === "rgb(255, 255, 255)" && src.rowShadow.includes("inset") && src.rowRadius === "0px", JSON.stringify(src));
  check("Sources: Advanced is a combo: a sunken white field with a raised arrow button beside it", src.advBg === "rgb(255, 255, 255)" && src.advShadow.includes("inset") && src.arrowShadow.includes("rgb(64, 64, 64)") && src.arrowImg.startsWith("url(") && src.arrowW === 17 && src.adjacent, JSON.stringify(src));

  const app = await probe("Appearance", () => {
    const slider = document.querySelector(".rowcap__slider");
    const chips = document.querySelector('[data-slot="combobox-chips"]');
    const cc = chips && getComputedStyle(chips);
    const inner = chips?.querySelector("input");
    return {
      hasSlider: !!slider,
      appearance: slider && getComputedStyle(slider).appearance,
      sliderH: slider?.getBoundingClientRect().height,
      chipsBg: cc?.backgroundColor,
      chipsShadow: cc?.boxShadow,
      innerShadow: inner && getComputedStyle(inner).boxShadow,
    };
  });
  // The thumb and groove are pseudo-elements, which getComputedStyle cannot
  // read: look at the pixels. A Windows 2000 trackbar draws its raised thumb's
  // dark edge (#404040) and its groove's (#808080); the platform's draws neither.
  await page.locator(".rowcap__slider").scrollIntoViewIfNeeded();
  const sliderBox = await page.locator(".rowcap__slider").boundingBox();
  const shot = (await page.screenshot({ clip: sliderBox })).toString("base64");
  const px = await page.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    let dk = 0;
    let lo = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === 64 && d[i + 1] === 64 && d[i + 2] === 64) dk++;
      if (d[i] === 128 && d[i + 1] === 128 && d[i + 2] === 128) lo++;
    }
    return { dk, lo };
  }, shot);
  check("Appearance: Titles per Row is a trackbar: no platform slider, a sunken groove and a raised thumb drawn in the bevel greys", app.hasSlider && app.appearance === "none" && app.sliderH === 24 && px.dk >= 30 && px.lo >= 30, JSON.stringify({ ...app, ...px }));
  check("Appearance: the catalogs field is one sunken white box, not a field inside a field", app.chipsBg === "rgb(255, 255, 255)" && app.chipsShadow.includes("inset") && app.innerShadow === "none", JSON.stringify(app));

  const appTab = await probe("App", () => {
    const b = [...document.querySelectorAll("button")].find((e) => e.textContent.includes("Licenses and Source Code"));
    const cs = b && getComputedStyle(b);
    return { color: cs?.color, deco: cs?.textDecorationLine, shadow: cs?.boxShadow };
  });
  check("App: Licenses is a Classic link: blue, underlined, not a bare focus rectangle", appTab.color === "rgb(0, 0, 238)" && appTab.deco === "underline" && appTab.shadow === "none", JSON.stringify(appTab));

  // The balloon floats over the dialog and does not resize it.
  const rectNow = () => page.evaluate(() => JSON.stringify(document.querySelector(".settings--classic").getBoundingClientRect()));
  const rectBefore = await rectNow();
  await dlg.getByRole("button", { name: "Help" }).click();
  await page.locator(".cl-balloon").waitFor();
  check("the ? balloon does not resize the dialog", (await rectNow()) === rectBefore);

  check("Classic: no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ------------------------------------------------------------------ Default
{
  const { ctx, page, errors } = await open(null);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.locator("section.settings").waitFor();
  const seen = {};
  for (const tab of TABS) {
    await page.locator(`.settings__rail [data-rail="${tab.toLowerCase()}"]`).click();
    await page.waitForTimeout(400);
    seen[tab] = await page.evaluate(() => ({
      eyebrows: document.querySelectorAll("h3.settings__group").length,
      groups: document.querySelectorAll("fieldset.cl-group").length,
      first: (() => {
        const h = document.querySelector("h3.settings__group");
        return h ? getComputedStyle(h).textTransform : "";
      })(),
      title: (() => {
        const t = document.querySelector(".customize-row__title");
        return t ? getComputedStyle(t).fontSize : "";
      })(),
    }));
  }
  check("Default: every tab keeps its eyebrow headings and draws no group box", TABS.every((t) => seen[t].eyebrows >= 1 && seen[t].groups === 0 && seen[t].first === "uppercase"), JSON.stringify(seen));
  check("Default: row titles keep their size", ["Playback", "Appearance", "App"].every((t) => seen[t].title === "15px"), JSON.stringify(seen));
  check("Default: the card is not the Classic dialog", (await page.locator(".settings--classic, .cl-title").count()) === 0);
  check("Default: no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

await browser.close();
process.exit(fail ? 1 : 0);

import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const results = [];
const check = (n, ok, x = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); };

const openTab = async (manifest) => {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.addInitScript((m) => {
    localStorage.setItem("btv:onboarded", "1");
    if (m) localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: m }));
    sessionStorage.setItem("btv:welcome-played", "1");
    localStorage.setItem("btv:onboarded", "1"); // keep first-run onboarding out of probe tests
  }, manifest);
  await page.goto("http://localhost:4173/");
  await page.locator("button[aria-label='Settings']").click();
  await page.getByRole("button", { name: "AIOStreams", exact: true }).click();
  await page.waitForTimeout(400);
  return page;
};

const readProbe = async (page) => {
  await page.waitForSelector(".aio-probe", { timeout: 30_000 });
  await page.waitForTimeout(600);
  const rows = await page.$$eval(".aio-probe__row", (els) =>
    els.map((e) => ({ bad: e.className.includes("--bad"), text: e.textContent })));
  const verdict = await page.$eval(".aio-probe__verdict", (e) => e.textContent).catch(() => null);
  return { rows, verdict };
};

const run = async (manifest, shot) => {
  const page = await openTab(manifest);
  await page.getByRole("button", { name: /Run Connection Test/ }).click();
  const out = await readProbe(page);
  await page.screenshot({ path: shot });
  await page.close();
  return out;
};

const ok = await run("http://localhost:8084/manifest.json", "probe-ok.png");
check("healthy instance: 3 green rows, no verdict",
  ok.rows.length === 3 && ok.rows.every((r) => !r.bad) && ok.verdict === null,
  JSON.stringify(ok.rows.map(r => r.text)));

const bad = await run("http://localhost:9/manifest.json", "probe-fail.png");
check("dead instance: manifest row red, no URL leaked, no verdict",
  bad.rows.length >= 1 && bad.rows[0].bad && bad.verdict === null
    && !bad.rows.some((r) => r.text.includes("localhost:9/manifest")),
  JSON.stringify(bad.rows.map(r => r.text)));

// Cloudflare-challenge shape (the Bobby 403): forensic must NAME the
// gatekeeper and the verdict must say it in plain language.
const cf = await run("http://localhost:8084/cf/manifest.json", "probe-cf.png");
check("challenged instance: forensic names cloudflare",
  cf.rows.length >= 1 && cf.rows[0].bad
    && /answered HTTP 403/.test(cf.rows[0].text)
    && /server: cloudflare/.test(cf.rows[0].text)
    && /cf-mitigated: challenge/.test(cf.rows[0].text)
    && !cf.rows.some((r) => r.text.includes("/cf/manifest")),
  JSON.stringify(cf.rows.map(r => r.text)));
check("challenged instance: plain-language verdict",
  !!cf.verdict && /bot protection/.test(cf.verdict) && /can't be fixed/.test(cf.verdict),
  String(cf.verdict));

// Submitting a manifest URL auto-runs the test — a bad instance is
// caught at setup, without touching the Run button.
const page = await openTab(null);
await page.getByPlaceholder(/manifest\.json/).fill("http://localhost:8084/cf/manifest.json");
await page.getByRole("button", { name: "Submit", exact: true }).click();
const auto = await readProbe(page);
await page.screenshot({ path: "probe-autorun.png" });
await page.close();
check("submit auto-runs the test and shows the verdict",
  auto.rows.length >= 1 && auto.rows[0].bad && !!auto.verdict && /bot protection/.test(auto.verdict),
  JSON.stringify({ rows: auto.rows.map(r => r.text), verdict: auto.verdict }));

await browser.close();
const pass = results.filter(Boolean).length;
console.log(`${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);

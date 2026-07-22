// Headless verify: adult-hide-by-default end-to-end against the fake Xtream
// panel (which carries a panel-flagged category, a name-caught category, a
// stream-level flag inside an innocent category, and the Adult Swim false
// positive that must survive).
//
// Run:
//   pnpm --filter @blammytv/app build
//   node scripts/fake-panel.mjs                    # :8081
//   pnpm --filter @blammytv/app preview            # :4173
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-adult-filter.mjs

import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = "http://localhost:4173/";
const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const PLAYLIST = {
  v: 1,
  data: [
    {
      kind: "xtream",
      id: "t",
      name: "Test",
      enabled: true,
      server: "http://localhost:8081",
      username: "u",
      password: "p",
      hiddenCategories: ["3"],
    },
  ],
};

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});

async function loadApp(showAdult) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  await page.addInitScript(
    ({ pl, show }) => {
      localStorage.setItem("btv:onboarded", "1");
      localStorage.setItem("blammytv.playlists", JSON.stringify(pl));
      if (show !== null)
        localStorage.setItem(
          "blammytv.showAdult",
          JSON.stringify({ v: 1, data: show }),
        );
    },
    { pl: PLAYLIST, show: showAdult },
  );
  await page.goto(URL);
  // Toonami is the last innocent channel; when it's on screen the load is in.
  await page.waitForFunction(
    () => document.body.innerText.includes("Toonami Reruns"),
    null,
    { timeout: 30_000 },
  );
  const text = await page.evaluate(() => document.body.innerText);
  return { ctx, text };
}

// ---- Default (filter on, key absent — the fresh-install state) ----
{
  const { ctx, text } = await loadApp(null);
  check(
    "panel-flagged category dropped (folder + channel)",
    !text.includes("VIP Extra") && !text.includes("Panel Flagged Channel"),
  );
  check(
    "name-caught category dropped (folder + channel)",
    !text.includes("XXX Movies") && !text.includes("Name Caught Channel"),
  );
  check(
    "stream-level flag dropped from an innocent category",
    !text.includes("Sneaky Flagged Stream"),
  );
  check(
    "Adult Swim survives the name filter",
    text.includes("Adult Swim") && text.includes("Toonami Reruns"),
  );
  check(
    "user-hidden category still drops (existing pipeline intact)",
    !text.includes("Should Be Hidden"),
  );
  check(
    "innocent content untouched",
    text.includes("Fake ESPN 4K") && text.includes("Fake News Channel"),
  );
  await ctx.close();
}

// ---- Filter off (Show adult content = on) ----
{
  const { ctx, text } = await loadApp(true);
  check(
    "showAdult=true restores adult folders + channels",
    text.includes("VIP Extra") &&
      text.includes("XXX Movies") &&
      text.includes("Panel Flagged Channel") &&
      text.includes("Name Caught Channel") &&
      text.includes("Sneaky Flagged Stream"),
  );
  check(
    "user-hidden category stays hidden regardless",
    !text.includes("Should Be Hidden"),
  );
  await ctx.close();
}

await browser.close();
const fails = results.filter(([, ok]) => !ok);
console.log(
  `\n${results.length - fails.length}/${results.length} checks passed`,
);
process.exit(fails.length ? 1 : 0);

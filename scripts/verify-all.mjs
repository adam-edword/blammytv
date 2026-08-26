/**
 * Run EVERY headless harness, and stand up what they need to run.
 *
 * WHY THIS EXISTS. The harnesses were rotting quietly. Each one wants a
 * different set of fake servers on different ports, one of them wants an
 * env var, and none of that lived anywhere except a comment at the top of
 * each file. So nobody ran the full set, and by the time anyone looked,
 * verify-discover had been dying a third of the way through for months and
 * every check past the crash had simply stopped existing. Five other
 * harnesses were in the same state, including two whose ENTIRE subject
 * (the connection pill, the credits signal) had not been exercised in a
 * long time.
 *
 * A crash is the dangerous shape, not a failure. A failing check is loud.
 * A harness that throws at check 12 of 40 still prints eleven green ticks
 * above the stack trace, and the twenty-eight it never reached leave no
 * trace at all. That is why STATUS below distinguishes CRASH from FAILED,
 * and why the pass count is printed even for a run that died.
 *
 *   node scripts/verify-all.mjs              # everything
 *   node scripts/verify-all.mjs discover nav # only matching names
 *   KEEP=1 node scripts/verify-all.mjs       # leave the servers running
 *
 * Needs playwright-core reachable. Either install it, or point PW_FROM at a
 * module path that can require it (the same variable the harnesses take):
 *
 *   PW_FROM=/tmp/pw/x.js node scripts/verify-all.mjs
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(ROOT, "apps", "app");
const PORT = 4173;

/** The fakes, and the ports the harnesses hard-code for them. LAX matters:
 * without it fake-stalker enforces a handshake verify-stalker does not
 * perform, and the portal serves nothing — which reads as "no channels
 * rendered", not as "the server refused you". */
const SERVERS = [
  { name: "fake-m3u", port: 8082, probe: "/playlist.m3u" },
  { name: "fake-panel", port: 8081, probe: "/player_api.php?username=u&password=p" },
  { name: "fake-stalker", port: 8083, probe: "/", env: { LAX: "1" } },
  { name: "fake-aio", port: 8084, probe: "/manifest.json" },
  { name: "fake-keybox", port: 8085, probe: "/" },
];

/** Harnesses that are not browser runs and take arguments of their own. */
const NOT_BROWSER = new Set(["verify-release"]);

const kids = [];
const spawnKid = (cmd, args, opts = {}) => {
  const k = spawn(cmd, args, { cwd: ROOT, stdio: "ignore", ...opts });
  kids.push(k);
  return k;
};
const shutdown = () => {
  if (process.env.KEEP) return;
  for (const k of kids) k.kill("SIGTERM");
};

/** Poll until the port answers at all. A 404 is a fine answer: these fakes
 * serve specific paths and several have no index. */
async function waitForPort(port, probe, ms = 20_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      await fetch(`http://localhost:${port}${probe}`);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return false;
}

const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const k = spawn(cmd, args, {
      cwd: ROOT,
      env: { ...process.env, ...(opts.env ?? {}) },
    });
    let out = "";
    k.stdout.on("data", (d) => (out += d));
    k.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => k.kill("SIGKILL"), opts.timeout ?? 300_000);
    k.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, out });
    });
  });

// ---------------------------------------------------------------- servers
console.log("starting fakes…");
for (const s of SERVERS) {
  spawnKid(process.execPath, [path.join("scripts", `${s.name}.mjs`)], {
    env: { ...process.env, ...(s.env ?? {}) },
  });
}
console.log("starting vite…");
spawnKid("pnpm", ["exec", "vite", "--port", String(PORT), "--strictPort"], {
  cwd: APP,
});

const up = await Promise.all([
  ...SERVERS.map((s) => waitForPort(s.port, s.probe)),
  waitForPort(PORT, "/"),
]);
const names = [...SERVERS.map((s) => `${s.name}:${s.port}`), `vite:${PORT}`];
const dead = names.filter((_, i) => !up[i]);
if (dead.length) {
  console.error(`could not start: ${dead.join(", ")}`);
  shutdown();
  process.exit(2);
}

// ---------------------------------------------------------------- harnesses
const filters = process.argv.slice(2);
const all = readdirSync(path.join(ROOT, "scripts"))
  .filter((f) => f.startsWith("verify-") && f.endsWith(".mjs"))
  .filter((f) => f !== "verify-all.mjs")
  .map((f) => f.slice(0, -4))
  .filter((n) => !NOT_BROWSER.has(n))
  .filter((n) => !filters.length || filters.some((q) => n.includes(q)))
  .sort();

const SHOT_DIR = path.join(ROOT, ".verify-shots");
const rows = [];
console.log(`\nrunning ${all.length} harnesses…\n`);
for (const n of all) {
  const r = await run(process.execPath, [path.join("scripts", `${n}.mjs`)], {
    env: { SHOT_DIR },
  });
  // Three tick styles are in use across these files, and verify-version
  // indents its own — hence the leading \s*, without which it reported a
  // clean run of zero checks.
  const pass = (r.out.match(/^\s*(PASS|✓)/gm) ?? []).length;
  const fail = (r.out.match(/^\s*(FAIL|✗)/gm) ?? []).length;
  const status =
    r.signal === "SIGKILL"
      ? "TIMEOUT"
      : r.code !== 0
        ? "CRASH"
        : fail
          ? "FAILED"
          : "ok";
  let note = "";
  if (status === "CRASH" || status === "TIMEOUT") {
    note =
      (r.out.match(/waiting for [^\n"]{0,60}/) ?? [])[0] ??
      (r.out.match(/^\s*(\w*Error:.{0,60})/m) ?? [])[1] ??
      "";
  }
  rows.push({ n, status, pass, fail, note });
  const mark = status === "ok" ? "ok " : status;
  console.log(
    `${n.padEnd(24)} ${mark.padEnd(8)} ${String(pass).padStart(4)}✓ ${String(fail).padStart(3)}✗  ${note}`,
  );
}

shutdown();
const bad = rows.filter((r) => r.status !== "ok");
const checks = rows.reduce((a, r) => a + r.pass, 0);
console.log(
  `\n${rows.length - bad.length}/${rows.length} harnesses clean, ${checks} checks passed`,
);
if (bad.length) {
  console.log(`not clean: ${bad.map((r) => `${r.n} (${r.status})`).join(", ")}`);
  process.exit(1);
}

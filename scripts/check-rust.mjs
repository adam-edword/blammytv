/**
 * Type-check the Tauri crate — including the Windows-ONLY code — from Linux.
 *
 *   node scripts/check-rust.mjs
 *
 * Why this exists: `cargo check` on Linux fails in gdk-sys before it ever
 * reaches our crate, so for a long stretch the answer to "does this Rust
 * compile" was "find out on Adam's machine". v0.8.164 shipped a new Tauri
 * command that nobody had compiled. Worse, `inv.rs` is `#![cfg(windows)]`, so
 * even a working Linux check would compile it to NOTHING — the player's
 * window layer was unreachable by any check at all.
 *
 * Targeting windows-gnu skips the GTK dependency tree entirely and compiles
 * the Windows cfg branches for real. `cargo check` never links, so no MSVC is
 * needed; only a C cross-compiler for one build script, and a placeholder for
 * the gitignored bundled DLL that build.rs insists exists.
 *
 * Verified to catch real errors, not just pass vacuously: injecting
 * `let _: u32 = "x";` into inv.rs::close() produces
 * `src/inv.rs:140: error[E0308]: mismatched types`.
 *
 * This is a TYPE check, not a build. It will not catch a linker problem, a
 * runtime panic, or anything about libmpv's actual behaviour.
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const crate = join(root, "apps/app/src-tauri");
const TARGET = "x86_64-pc-windows-gnu";

const have = (cmd) => {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

if (!have("cargo")) {
  console.error("cargo not found — install a Rust toolchain first.");
  process.exit(2);
}

// The one-time prerequisites, each with the exact command to fix it.
const installed = execSync("rustup target list --installed", { encoding: "utf8" });
if (!installed.includes(TARGET)) {
  console.error(`missing rust target ${TARGET}\n  rustup target add ${TARGET}`);
  process.exit(2);
}
if (!have("x86_64-w64-mingw32-gcc")) {
  console.error(
    "missing the C cross-compiler one build script needs\n" +
      "  apt-get install -y gcc-mingw-w64-x86-64",
  );
  process.exit(2);
}

// build.rs refuses to run without the bundled resource, which is gitignored
// and per-machine. Its CONTENTS are irrelevant to a type check.
const dll = join(crate, "libmpv-2.dll");
if (!existsSync(dll)) {
  writeFileSync(dll, "");
  console.log("created an empty libmpv-2.dll placeholder (gitignored)");
}

console.log(`checking the crate for ${TARGET} …\n`);
try {
  execFileSync("cargo", ["check", "--all-targets", "--target", TARGET, "--message-format", "short"], {
    cwd: crate,
    stdio: "inherit",
  });
} catch {
  console.error("\nRust type check FAILED\n");
  process.exit(1);
}
console.log("\nRust type check passed\n");

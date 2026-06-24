import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./tauri";

/**
 * Self-update, driven by the Rust side (tauri-plugin-updater) via two commands.
 * We keep the whole flow in Rust so the app needs no extra JS plugin packages —
 * the frontend just asks "is there an update?" and "install it".
 */

/** Check GitHub Releases for a newer build. Returns the new version, or null. */
export async function checkForUpdate(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("check_update");
}

/** Download + install the pending update and relaunch. Resolves never on
 * success (the app restarts); rejects if the install fails. */
export async function installUpdate(): Promise<void> {
  if (!isTauri()) return;
  await invoke("install_update");
}

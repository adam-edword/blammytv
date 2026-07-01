/** True when running inside the Tauri shell (vs. a plain browser tab). */
export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

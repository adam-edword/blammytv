/** Launch gate for the welcome/boot animation (see WelcomeAnimation.tsx). */

const PLAYED_KEY = "btv:welcome-played";

/** Play on a fresh window launch only: reloads (HMR, dev-flag
 * flip) keep sessionStorage, so they skip it. `?welcome=1` forces a replay
 * and reduced-motion users never see it. Pure — the flag is stamped by
 * `markWelcomePlayed` on mount, not here (StrictMode calls useState
 * initializers twice). */
export function shouldPlayWelcome(): boolean {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get("welcome") === "1") return true;
  try {
    return sessionStorage.getItem(PLAYED_KEY) === null;
  } catch {
    return true;
  }
}

export function markWelcomePlayed(): void {
  try {
    sessionStorage.setItem(PLAYED_KEY, "1");
  } catch {
    /* storage unavailable — worst case it replays on reload */
  }
}

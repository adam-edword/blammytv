/** Launch gate for first-run onboarding (see Onboarding.tsx). */

const KEY = "btv:onboarded";
const REPLAY_EVENT = "blammytv:replay-onboarding";

/**
 * EVERYONE without the completed flag sees onboarding once — including
 * users who set the app up before it existed (Adam, v0.4.25: "make
 * everyone do onboarding... just want them to experience it"). Nothing
 * is wiped: the steps pre-fill from saved settings, sources only get
 * ADDED on verify, and finishing stamps the flag so it never replays.
 * `?onboarding=1` forces a replay for testing/demos, same pattern as
 * `?welcome=1`. Pure — the flag is stamped by `markOnboarded` when the
 * user finishes, not here (StrictMode calls useState initializers
 * twice).
 */
export function shouldShowOnboarding(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get("onboarding") === "1") return true;
  try {
    return localStorage.getItem(KEY) === null;
  } catch {
    return false;
  }
}

export function markOnboarded(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* storage unavailable — worst case it replays next launch */
  }
}

/** Settings → Customize → "Replay Onboarding". Deliberately does NOT
 * clear the completed flag: quitting mid-replay must not re-trap the
 * user at next launch — finishing simply re-stamps. */
export function requestOnboardingReplay(): void {
  window.dispatchEvent(new CustomEvent(REPLAY_EVENT));
}

export function onOnboardingReplay(cb: () => void): () => void {
  window.addEventListener(REPLAY_EVENT, cb);
  return () => window.removeEventListener(REPLAY_EVENT, cb);
}

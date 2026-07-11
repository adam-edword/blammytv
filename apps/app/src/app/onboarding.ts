import { loadAioUrl } from "../features/settings/aiostreams";
import { loadPlaylists } from "../features/settings/playlists";

/** Launch gate for first-run onboarding (see Onboarding.tsx). */

const KEY = "btv:onboarded";

/**
 * First run = never completed onboarding AND no sources configured.
 * The sources check covers everyone who set the app up before this
 * feature existed — anyone with a manifest or playlist never sees it.
 * (A pre-existing user with NO sources at all gets one skippable
 * pass — acceptable: the flow is also a fine "get set up" screen for
 * them.) `?onboarding=1` forces a replay
 * for testing/demos, same pattern as `?welcome=1`. Pure — the flag is
 * stamped by `markOnboarded` when the user finishes, not here
 * (StrictMode calls useState initializers twice).
 */
export function shouldShowOnboarding(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get("onboarding") === "1") return true;
  try {
    if (localStorage.getItem(KEY) !== null) return false;
  } catch {
    return false;
  }
  return loadAioUrl() === "" && loadPlaylists().length === 0;
}

export function markOnboarded(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* storage unavailable — worst case it replays next launch */
  }
}

import { loadAioConn } from "../aiojf/conn";
import { loadJfConn } from "../jellyfin/store";
import { hasXtLibrary, xtLibraryPending } from "../xtvod/store";
import { loadPlaylists } from "./playlists";
import { loadStartupTab, shownStartup, startupChoices, type StartupTab } from "./startupTab";

/** Whether a live source is set up: an enabled playlist. */
export const hasLivePlaylist = () => loadPlaylists().some((p) => p.enabled);

/** Whether Stream has something to show: AIOStreams, a Jellyfin, or an Xtream library. */
export const hasStreamSource = () => !!loadAioConn() || !!loadJfConn() || hasXtLibrary();

/** The Startup Tab choices for what is set up right now. Settings and onboarding both read it.
 * A playlist never read yet may hold films (`xtLibraryPending`, Stream's own
 * rule for its loading state), so it counts: at launch and on onboarding's
 * last steps no library has been read, and a Stream picked on an Xtream
 * playlist opened on Live TV instead (1.0.28, verify-xtvod on CI). */
export const currentStartupChoices = () =>
  startupChoices({ live: hasLivePlaylist(), stream: hasStreamSource() || xtLibraryPending() });

/** Where a launch opens: the stored tab, as the picker shows it for what is
 * set up now (shownStartup). */
export const effectiveStartupTab = (): StartupTab => shownStartup(loadStartupTab(), currentStartupChoices());

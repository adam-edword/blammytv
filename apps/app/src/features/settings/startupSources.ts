import { loadAioConn } from "../aiojf/conn";
import { loadJfConn } from "../jellyfin/store";
import { hasXtLibrary } from "../xtvod/store";
import { loadPlaylists } from "./playlists";
import { loadStartupTab, shownStartup, startupChoices, type StartupTab } from "./startupTab";

/** Whether a live source is set up: an enabled playlist. */
export const hasLivePlaylist = () => loadPlaylists().some((p) => p.enabled);

/** Whether Stream has something to show: AIOStreams, a Jellyfin, or an Xtream library. */
export const hasStreamSource = () => !!loadAioConn() || !!loadJfConn() || hasXtLibrary();

/** The Startup Tab choices for what is set up right now. Settings and onboarding both read it. */
export const currentStartupChoices = () =>
  startupChoices({ live: hasLivePlaylist(), stream: hasStreamSource() });

/** Where a launch opens: the stored tab, as the picker shows it for what is
 * set up now (shownStartup). */
export const effectiveStartupTab = (): StartupTab => shownStartup(loadStartupTab(), currentStartupChoices());

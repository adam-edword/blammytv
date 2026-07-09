import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri, tauriInvStop } from "../lib/tauri";
import { AppHeader, type TabKey } from "./AppHeader";
import { WelcomeAnimation } from "./WelcomeAnimation";
import { shouldPlayWelcome } from "./welcome";
import { LiveScreen } from "../features/live/LiveScreen";
import { StreamScreen } from "../features/stream/StreamScreen";
import { DiscoverScreen } from "../features/discover/DiscoverScreen";
import { SettingsModal } from "../features/settings/SettingsModal";
import { loadStartupTab } from "../features/settings/startupTab";

export function App() {
  const [tab, setTab] = useState<TabKey>(loadStartupTab);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Boot animation: plays over the shell while it loads, once per launch.
  const [welcome, setWelcome] = useState(shouldPlayWelcome);

  // Leaving Live unmounts LiveScreen, whose CompositionPlayer tears the native
  // mpv layer down — but that teardown (run_on_main_thread) queues behind the
  // incoming tab's render/paint, so the video child can hang on for a beat.
  // AWAIT the teardown before switching: the main thread is idle at click
  // time, so mpv is destroyed first, then the new tab renders. inv_stop is a
  // cheap no-op when nothing's playing.
  const changeTab = useCallback(
    async (next: TabKey) => {
      if (tab === "live" && next !== "live" && isTauri()) {
        await tauriInvStop().catch(() => {});
      }
      setTab(next);
    },
    [tab],
  );

  // While a modal is open, flag the root: the video keeps playing behind it
  // (it's below the webview), and the player chrome fades out via CSS so it
  // doesn't read through the glass (see player.css [data-native-hidden]).
  useEffect(() => {
    const root = document.documentElement;
    if (settingsOpen) root.dataset.nativeHidden = "1";
    else delete root.dataset.nativeHidden;
    return () => {
      delete root.dataset.nativeHidden;
    };
  }, [settingsOpen]);

  // F11 toggles fullscreen; Escape always exits it. The window-state
  // plugin restores fullscreen across launches, so without this there's
  // no way out from inside the app.
  useEffect(() => {
    if (!isTauri()) return;
    const onKey = async (e: KeyboardEvent) => {
      if (e.key !== "F11" && e.key !== "Escape") return;
      const win = getCurrentWindow();
      const full = await win.isFullscreen();
      if (e.key === "F11") {
        e.preventDefault();
        void win.setFullscreen(!full);
      } else if (full) {
        void win.setFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app-shell">
      <AppHeader
        active={tab}
        onChange={changeTab}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="app-main">
        {tab === "live" ? (
          <LiveScreen modalOpen={settingsOpen} />
        ) : tab === "stream" ? (
          <StreamScreen />
        ) : (
          <DiscoverScreen />
        )}
      </main>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {welcome && <WelcomeAnimation onDone={() => setWelcome(false)} />}
    </div>
  );
}

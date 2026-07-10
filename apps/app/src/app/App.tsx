import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../lib/tauri";
import { AppHeader, type TabKey } from "./AppHeader";
import { WelcomeAnimation } from "./WelcomeAnimation";
import { shouldPlayWelcome } from "./welcome";
import { LiveScreen } from "../features/live/LiveScreen";
import { StreamScreen } from "../features/stream/StreamScreen";
import { DiscoverScreen } from "../features/discover/DiscoverScreen";
import { SettingsModal } from "../features/settings/SettingsModal";
import { loadStartupTab } from "../features/settings/startupTab";
import {
  onOpenRequest,
  onReturnRequest,
} from "../features/stream/openRequest";

export function App() {
  const [tab, setTab] = useState<TabKey>(loadStartupTab);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Boot animation: plays over the shell while it loads, once per launch.
  const [welcome, setWelcome] = useState(shouldPlayWelcome);

  // Tab switches are instant: leaving Live unmounts LiveScreen, whose
  // InvertedPlayer cleanup heals the shell's clip hole SYNCHRONOUSLY (before
  // the next paint) and fires inv_stop without waiting. The video child sits
  // BELOW the webview, so once the hole is gone it has nothing to show
  // through — the old await-the-teardown dance existed only because the comp
  // layer floated above the UI.
  const changeTab = setTab;

  // Discover hands a picked title to the Stream tab (detail + playback
  // live there) — the mailbox holds the item; we just flip the tab.
  // Backing all the way out of that hand-off flips back to Discover.
  useEffect(() => onOpenRequest(() => setTab("stream")), []);
  useEffect(() => onReturnRequest(() => setTab("discover")), []);

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
      // The VOD player owns Escape (theater↔fullscreen toggle through its
      // own state machine) — exiting OS fullscreen from here would desync
      // playing.mode and fight the overlay's toggle.
      if (e.key === "Escape" && document.getElementById("inv-chrome")) return;
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

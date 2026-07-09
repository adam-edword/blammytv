import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  invertedPlayer,
  isTauri,
  setInvertedPlayer,
  tauriCompStop,
  tauriSpikeWindow,
} from "../lib/tauri";
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
  // incoming tab's render/paint, so the layer (a top-most child window, not
  // DOM) hangs on screen for a beat. AWAIT the teardown before switching: the
  // main thread is idle at click time, so mpv is destroyed first, then the new
  // tab renders. comp_stop is a cheap no-op when nothing's playing.
  const changeTab = useCallback(
    async (next: TabKey) => {
      if (tab === "live" && next !== "live" && isTauri()) {
        await tauriCompStop().catch(() => {});
      }
      setTab(next);
    },
    [tab],
  );

  // The native player (mpv child HWND + composition overlay) sits ABOVE the
  // main webview — no CSS z-index can put the settings modal over it. While
  // the modal is open, flag the root; CompositionPlayer reads it per-frame
  // and parks the native layers in a tiny offscreen rect (audio keeps
  // playing, picture returns the instant the modal closes).
  useEffect(() => {
    const root = document.documentElement;
    if (settingsOpen) root.dataset.nativeHidden = "1";
    else delete root.dataset.nativeHidden;
    return () => {
      delete root.dataset.nativeHidden;
    };
  }, [settingsOpen]);

  // DEV: Ctrl+Shift+U flips the inverted-player flag and reloads (Ctrl+
  // Shift+I is taken — WebView2 devtools). Old player ↔ new player, live.
  useEffect(() => {
    if (!isTauri() || !import.meta.env.DEV) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "u")) return;
      e.preventDefault();
      setInvertedPlayer(!invertedPlayer());
      window.location.reload();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // DEV: Ctrl+Shift+L opens the layer-inversion spike window (spike.rs),
  // handing over the most recently played stream URL if there is one.
  useEffect(() => {
    if (!isTauri() || !import.meta.env.DEV) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "l")) return;
      e.preventDefault();
      const stream = (window as { __lastCompUrl?: string }).__lastCompUrl;
      const page = new URL(window.location.origin);
      page.searchParams.set("spike", "1");
      if (stream) page.searchParams.set("u", stream);
      void tauriSpikeWindow(page.toString()).catch((err) =>
        console.error("[spike]", err),
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
          <LiveScreen />
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

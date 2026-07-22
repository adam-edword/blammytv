import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../lib/tauri";
import { AppHeader, type Section, type StreamTab } from "./AppHeader";
import { WelcomeAnimation } from "./WelcomeAnimation";
import { shouldPlayWelcome } from "./welcome";
import { Onboarding } from "./Onboarding";
import { onOnboardingReplay, shouldShowOnboarding } from "./onboardingGate";
import { LiveScreen } from "../features/live/LiveScreen";
import { StreamScreen } from "../features/stream/StreamScreen";
import { MyListScreen } from "../features/stream/MyListScreen";
import { DiscoverScreen } from "../features/discover/DiscoverScreen";
import { SettingsModal } from "../features/settings/SettingsModal";
import { ThemesModal } from "../features/settings/ThemesModal";
import { loadStartupTab } from "../features/settings/startupTab";
import {
  onGenreRequest,
  onOpenRequest,
  onReturnRequest,
} from "../features/stream/openRequest";

export function App() {
  // Nav is two facts, not one: which SIDE of the app (Live TV vs Stream)
  // and which Stream PAGE (the pill rail). streamTab survives a trip to
  // Live TV — coming back lands where you were; the startup setting only
  // decides the launch position. (The stored value stays the flat
  // three-way enum: it's a launch preference, mapped here at boot.)
  const [section, setSection] = useState<Section>(() =>
    loadStartupTab() === "live" ? "live" : "stream",
  );
  const [streamTab, setStreamTab] = useState<StreamTab>(() =>
    loadStartupTab() === "discover" ? "discover" : "home",
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The Themes panel pops OUT of Settings: opening it closes Settings, and
  // closing it returns to the app (Adam's call). Mutually exclusive with
  // Settings, so only one .settings card is ever mounted (the live-video
  // frost region measures ".settings" — see LiveScreen).
  const [themesOpen, setThemesOpen] = useState(false);
  // First-run onboarding sits over everything and ENDS with its own
  // boot phase (the boot's actors live inside the overlay, v0.4.36) —
  // it owns that launch's boot, so welcome never follows it.
  const [onboarding, setOnboarding] = useState(shouldShowOnboarding);
  // Boot animation: plays over the shell while it loads, once per launch.
  const [welcome, setWelcome] = useState(
    () => !shouldShowOnboarding() && shouldPlayWelcome(),
  );

  // Settings → Customize → "Replay Onboarding": mount the flow over the
  // app on demand (the completed flag stays — see onboardingGate).
  useEffect(
    () =>
      onOnboardingReplay(() => {
        setSettingsOpen(false);
        setOnboarding(true);
      }),
    [],
  );

  // Section switches are instant: leaving Live unmounts LiveScreen, whose
  // InvertedPlayer cleanup heals the shell's clip hole SYNCHRONOUSLY (before
  // the next paint) and fires inv_stop without waiting. The video child sits
  // BELOW the webview, so once the hole is gone it has nothing to show
  // through — the old await-the-teardown dance existed only because the comp
  // layer floated above the UI.

  // Discover hands a picked title to Stream Home (detail + playback live
  // there) — the mailbox holds the item; we just flip the nav. Backing
  // all the way out of that hand-off flips back to Discover.
  useEffect(
    () =>
      onOpenRequest(() => {
        setSection("stream");
        setStreamTab("home");
      }),
    [],
  );
  useEffect(
    () =>
      onReturnRequest((from) => {
        setSection("stream");
        setStreamTab(from);
      }),
    [],
  );
  // A genre pill on the detail screens → Discover, that genre selected
  // (DiscoverScreen drains the mailbox itself).
  useEffect(
    () =>
      onGenreRequest(() => {
        setSection("stream");
        setStreamTab("discover");
      }),
    [],
  );

  // While a modal is open, flag the root: the video keeps playing behind it
  // (it's below the webview), and the player chrome fades out via CSS so it
  // doesn't read through the glass (see player.css [data-native-hidden]).
  useEffect(() => {
    const root = document.documentElement;
    if (settingsOpen || themesOpen) root.dataset.nativeHidden = "1";
    else delete root.dataset.nativeHidden;
    return () => {
      delete root.dataset.nativeHidden;
    };
  }, [settingsOpen, themesOpen]);

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
      // Keyed on the VOD STAGE, not #inv-chrome: Live mounts its chrome
      // host on mount whether or not anything plays, and the host check
      // ate Live's Escape-exits-fullscreen everywhere.
      if (e.key === "Escape" && document.querySelector(".vod-stage")) return;
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
        section={section}
        streamTab={streamTab}
        onSection={setSection}
        onStreamTab={setStreamTab}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="app-main">
        {section === "live" ? (
          <LiveScreen modalOpen={settingsOpen || themesOpen} />
        ) : streamTab === "discover" ? (
          <DiscoverScreen />
        ) : streamTab === "mylist" ? (
          <MyListScreen />
        ) : (
          <StreamScreen />
        )}
      </main>
      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onOpenThemes={() => {
            setSettingsOpen(false);
            setThemesOpen(true);
          }}
        />
      )}
      {themesOpen && <ThemesModal onClose={() => setThemesOpen(false)} />}
      {welcome && <WelcomeAnimation onDone={() => setWelcome(false)} />}
      {onboarding && <Onboarding onDone={() => setOnboarding(false)} />}
    </div>
  );
}

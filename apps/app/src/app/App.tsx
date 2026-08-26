import { startTransition, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isTauri,
  tauriFrontendCheck,
  tauriFrontendReady,
} from "../lib/tauri";
import {
  AppHeader,
  type LiveTab,
  type Section,
  type StreamTab,
} from "./AppHeader";
import { WelcomeAnimation } from "./WelcomeAnimation";
import { shouldPlayWelcome } from "./welcome";
import { Onboarding } from "./Onboarding";
import { onOnboardingReplay, shouldShowOnboarding } from "./onboardingGate";
import { LiveScreen } from "../features/live/LiveScreen";
import { SportsScreen } from "../features/sports/SportsScreen";
import {
  loadPlaylists,
  onPlaylistsChange,
} from "../features/settings/playlists";
import { StreamScreen } from "../features/stream/StreamScreen";
import { LibraryScreen } from "../features/stream/LibraryScreen";
import { DiscoverScreen } from "../features/discover/DiscoverScreen";
import { setModalOpen } from "../lib/modalOpen";
import { SettingsModal } from "../features/settings/SettingsModal";
import { ThemesModal } from "../features/settings/ThemesModal";
import { loadStartupTab } from "../features/settings/startupTab";
import {
  onGenreRequest,
  onOpenRequest,
  onResumeRequest,
  onReturnRequest,
} from "../features/stream/openRequest";

/**
 * How long the nav capsule needs to itself before a screen may mount over
 * it. Derived from --nav-dur (380ms) and --nav-spring in tokens.css, not
 * picked by feel: past 188ms that curve has under a pixel of travel left,
 * so a stall from there on cannot be seen. Change it if the curve changes.
 */
const NAV_SETTLE_MS = 190;

/** The incoming screen's entrance. Kept just under the capsule's own
 * settle time so the two read as one movement rather than a queue. */
const SWAP_MS = 180;

export function App() {
  // Nav is two facts, not one: which SIDE of the app (Live TV vs Stream)
  // and which Stream PAGE (the pill rail). streamTab survives a trip to
  // Live TV — coming back lands where you were; the startup setting only
  // decides the launch position. (The stored value stays the flat
  // three-way enum: it's a launch preference, mapped here at boot.)
  // The Live tab exists only while a live source (any playlist kind) is
  // configured — without one it showed the mock catalog to real users.
  // Adding a playlist in Settings reveals the tab live; removing the last
  // one hides it and bounces the section to Stream.
  const hasEnabledPlaylist = () => loadPlaylists().some((p) => p.enabled);
  const [hasLiveSource, setHasLiveSource] = useState(hasEnabledPlaylist);
  useEffect(
    () => onPlaylistsChange(() => setHasLiveSource(hasEnabledPlaylist())),
    [],
  );
  const [section, setSection] = useState<Section>(() =>
    loadStartupTab() === "live" && hasEnabledPlaylist() ? "live" : "stream",
  );
  useEffect(() => {
    if (!hasLiveSource) setSection((s) => (s === "live" ? "stream" : s));
  }, [hasLiveSource]);
  // Report a live frontend to the native side exactly once (plan 008). If
  // this app is running from a STAGED bundle, the absence of this call at
  // the next startup is what marks that bundle bad and rolls it back, so it
  // deliberately sits at the top of the tree with no dependency on routing,
  // data, or anything else that could legitimately fail.
  useEffect(() => {
    if (isTauri()) void tauriFrontendReady().catch(() => {});
  }, []);
  // Stage a newer frontend in the background, always and silently (plan
  // 008 phase 3). Nothing about the running app changes: staging only
  // decides what the NEXT launch serves, so there is no reload to schedule
  // and nothing to interrupt. Ordered after frontend_ready on purpose —
  // this boot proves itself before it is allowed to queue a successor.
  //
  // Deliberately fire-and-forget: the hot channel failing is a
  // non-event (the native updater is still there), and a launch must never
  // wait on a network call to paint.
  useEffect(() => {
    if (!isTauri()) return;
    const t = window.setTimeout(
      () => void tauriFrontendCheck().catch(() => {}),
      4000,
    );
    return () => window.clearTimeout(t);
  }, []);
  const [streamTab, setStreamTab] = useState<StreamTab>(() =>
    loadStartupTab() === "discover" ? "discover" : "home",
  );
  // Which Live page is showing. Ephemeral like the Stream rail's memory:
  // it survives a trip to Stream, and Live always opens on the Guide at
  // launch rather than dropping someone into Sports.
  const [liveTab, setLiveTab] = useState<LiveTab>("guide");
  /**
   * Bumped when the Sports chip is pressed, including when it is ALREADY
   * the tab.
   *
   * That press is the only thing on screen that looks like the way out of
   * the theater, and it did nothing: setLiveTab with the value it already
   * has, so React bails out and the mode below never hears about it. A
   * counter is what carries "pressed again" when the state itself does not
   * change.
   */
  const [sportsHome, setSportsHome] = useState(0);
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
  // The SAME hand-off, for a resume asked from the Library tab.
  //
  // It was missing, and the mailbox pattern hides that well: Library
  // dispatches, nothing flips the tab, so StreamScreen is never mounted to
  // hear it. The click did nothing at all, and then the next time the user
  // went to Stream Home for their own reasons, its mount-time drain found
  // the stale request and threw them into playback of something they had
  // clicked minutes earlier.
  useEffect(
    () =>
      onResumeRequest(() => {
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

  // The screen underneath a modal stays mounted and keeps its own window
  // listeners, so it has to be told to sit still. See lib/modalOpen.
  useEffect(() => {
    setModalOpen(settingsOpen || themesOpen);
    return () => setModalOpen(false);
  }, [settingsOpen, themesOpen]);

  /*
   * THE MOUSE'S BACK BUTTON CLOSES THE MODAL.
   *
   * modalOpen tells every screen underneath to sit still, which is right —
   * one back press must not close Settings AND drop you out of a playing
   * stream. But nothing then acted on the press at all, so back was simply
   * dead over Settings and Themes while it worked on every other screen.
   * Escape and the close button were the only ways out.
   *
   * Here rather than in the modals because App owns which one is up, and
   * because the ORDER matters: Themes is opened FROM Settings, so it has to
   * be the one that closes first.
   *
   * A window listener, matching lib/mouseNav.ts, and preventDefault on both
   * phases for the same reason it gives: WebView2 acts on mousedown, so
   * swallowing only mouseup lets the webview walk its own history and
   * navigate the document out from under the app.
   */
  useEffect(() => {
    if (!settingsOpen && !themesOpen) return;
    const onButton = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      if (e.type !== "mouseup" || e.button !== 3) return;
      if (themesOpen) setThemesOpen(false);
      else setSettingsOpen(false);
    };
    window.addEventListener("mousedown", onButton);
    window.addEventListener("mouseup", onButton);
    return () => {
      window.removeEventListener("mousedown", onButton);
      window.removeEventListener("mouseup", onButton);
    };
  }, [settingsOpen, themesOpen]);

  // Escape always exits fullscreen. The window-state plugin restores
  // fullscreen across launches, so without this there's no way out from
  // inside the app.
  //
  // F11 USED TO TOGGLE IT, and does not any more. The players own
  // fullscreen through their own state machines — the screen's layout, the
  // mpv rect and the clip hole all move with it — and a key that flipped
  // the WINDOW behind their backs left them describing a shape the window
  // no longer had. The sports theater is where that showed: fullscreen by
  // F11 left the panel drawn beside a picture that had gone fullscreen
  // without it. Entering fullscreen is the player's button; this is only
  // the way out.
  useEffect(() => {
    if (!isTauri()) return;
    const onKey = async (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // The VOD player owns Escape (theater↔fullscreen toggle through its
      // own state machine) — exiting OS fullscreen from here would desync
      // playing.mode and fight the overlay's toggle.
      // Keyed on the VOD STAGE, not #inv-chrome: Live mounts its chrome
      // host on mount whether or not anything plays, and the host check
      // ate Live's Escape-exits-fullscreen everywhere.
      if (document.querySelector(".vod-stage")) return;
      const win = getCurrentWindow();
      if (await win.isFullscreen()) void win.setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * WHAT <main> IS SHOWING — held back until the nav has finished moving.
   *
   * The header keeps the state above, urgent, so the capsule moves on the
   * frame you click it. The screen swap waits, because it cannot be made
   * cheap enough not to matter: React can slice a RENDER, but not the DOM
   * insert that follows it, nor the style, layout and paint the browser
   * then owes on a screenful of new nodes. useDeferredValue alone took
   * sports from 65ms of blocked main thread to 0 and the switch still
   * stuttered, because what was left still landed in the wrong 200ms.
   *
   * The wrong 200ms is nearly all of it. --nav-spring is
   * cubic-bezier(0.34, 1.2, 0.42, 1), which front-loads hard: 76% of the
   * travel is done by 100ms and 97% by 167ms, and past 188ms the whole
   * remaining move is under a pixel. So the entire VISIBLE animation lives
   * in the first ~190ms of its 380, and a stall anywhere in there is the
   * stutter Adam recorded — the capsule jumping to a partway position,
   * sitting there for 200ms, then snapping to the end. A stall after that
   * window is invisible.
   *
   * So: let the capsule have those 190ms to itself, then swap. Still a
   * transition, so the render itself stays interruptible on top of that.
   * Under prefers-reduced-motion there is no animation to protect (the
   * durations drop to 1ms in base.css), so the wait goes away with it.
   *
   * ONE string, not four values. Every destination key is unique across
   * both sides already, so the key alone names the screen; sportsHome
   * rides along because pressing Sports while ON Sports changes nothing
   * else, and four separate values could momentarily disagree.
   *
   * The old screen stays mounted for that window, LiveScreen included.
   * That is safe: nothing is torn down early or late relative to anything
   * else, the whole unmount just happens together, a fraction later — the
   * same as having clicked a fraction later.
   */
  const key = `${section === "live" ? liveTab : streamTab}:${sportsHome}`;
  const [view, setView] = useState(key);
  useEffect(() => {
    if (view === key) return;
    const wait = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : NAV_SETTLE_MS;
    const t = window.setTimeout(
      () => startTransition(() => setView(key)),
      wait,
    );
    return () => window.clearTimeout(t);
  }, [key, view]);
  const [dest, destHome] = view.split(":");

  /**
   * THE SWAP ITSELF, as motion rather than a cut.
   *
   * This does not make the switch cheaper and is not trying to. What it
   * replaces is a hard cut — old screen to new screen in one frame — which
   * lands on the frame the main thread is busiest and so points straight at
   * the hitch. Continuous motion gives the eye something to follow, and the
   * same hitch reads as the transition instead of a fault.
   *
   * The incoming screen fades up and rises 8px. That is ALL it does, and
   * the other half is a deliberate deletion: this also dimmed the outgoing
   * screen across the 190ms window above, which cost nothing in theory and
   * 10ms a frame in practice. Starting an opacity animation promotes
   * .app-main to its own compositor layer, and promoting a screenful of
   * guide grid is a texture upload — measured, three runs, it took the
   * worst frame gap INSIDE the protected window from 17ms to 26-29ms on
   * guide -> Stream. Buying polish with the exact frames three versions
   * went into protecting is a bad trade. The entrance has the same cost
   * but pays it AFTER the commit, outside the window, where it is free.
   *
   * opacity and transform ONLY, so the compositor owns them and a busy
   * main thread cannot stall them — the whole reason this is worth doing
   * here. No cross-fade: that needs both screens mounted at once, double
   * the work at exactly the wrong moment.
   *
   * WAAPI rather than a CSS class on a wrapper. .app-main's children are
   * its flex items and every screen sizes itself against that, so wrapping
   * them to hang a class on would re-lay-out all five.
   */
  const mainRef = useRef<HTMLElement>(null);
  const swap = useRef<Animation | null>(null);
  const firstView = useRef(true);
  /* Never animate over a cut clip hole. The inverted player carves one
   * through .app-shell and parks the native video behind it; putting an
   * opacity layer over that region is the exact shape of this project's
   * worst rendering scars, and it is the one thing here that cannot be
   * checked from a Linux box. Live playback simply cuts instead. */
  const canAnimate = () =>
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
    !document.querySelector<HTMLElement>(".app-shell")?.style.clipPath;

  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    const el = mainRef.current;
    // Cancel first and unconditionally: a switch made while the last
    // entrance is still running would otherwise leave two opacity effects
    // stacked on one element.
    swap.current?.cancel();
    swap.current = null;
    if (!el || !canAnimate()) return;
    swap.current = el.animate(
      [
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: SWAP_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [view]);

  return (
    <div className="app-shell">
      <AppHeader
        section={section}
        showLive={hasLiveSource}
        streamTab={streamTab}
        liveTab={liveTab}
        onSection={setSection}
        onStreamTab={setStreamTab}
        onLiveTab={(t) => {
          if (t === "sports") setSportsHome((n) => n + 1);
          setLiveTab(t);
        }}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="app-main" ref={mainRef}>
        {dest === "sports" ? (
          <SportsScreen home={Number(destHome)} />
        ) : dest === "guide" ? (
          <LiveScreen modalOpen={settingsOpen || themesOpen} />
        ) : dest === "discover" ? (
          <DiscoverScreen />
        ) : dest === "mylist" ? (
          <LibraryScreen />
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

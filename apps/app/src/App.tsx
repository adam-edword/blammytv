import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConfigBlob,
  ShareCode,
  VodItem,
  Episode,
  StreamSource,
} from "@blammytv/shared";
import { AppHeader } from "./components/AppHeader";
import { UpdateBanner } from "./components/UpdateBanner";
import { type TabKey } from "./components/TopTabs";
import { PairingScreen } from "./screens/PairingScreen";
import { OnboardingScreen } from "./screens/OnboardingScreen";
import { LiveScreen } from "./screens/LiveScreen";
import { StreamScreen } from "./screens/StreamScreen";
import { PlaceholderScreen } from "./screens/PlaceholderScreen";
import { SourceSelector } from "./components/SourceSelector";
import { EpisodeBrowser } from "./components/EpisodeBrowser";
import { SettingsPanel } from "./components/SettingsPanel";
import { SetupHandoff } from "./components/SetupHandoff";
import { ProfileModal } from "./components/ProfileModal";
import { loadProfile, saveProfile } from "./lib/profile";
import { LoadingScreen } from "./components/LoadingScreen";
import { CompositionPreview } from "./components/CompositionPreview";
import { SourcePanel } from "./components/SourcePanel";
import type { TheaterMeta } from "./components/Player";
import { ChevronIcon } from "./components/icons";
import { fetchConfig, type ConfigErrors } from "./lib/config";
import { fetchVodDetail, fetchVodSources, vodBackendConfigured } from "./lib/vod";
import {
  listContinueWatching,
  upsertContinueWatching,
} from "./lib/continueWatching";
import { getAioUrl } from "./lib/settings";
import {
  getCurrentFocusKey,
  setFocus,
} from "@noriginmedia/norigin-spatial-navigation";
import { isTauri, onCompClosed, onCompExitFullscreen, onCompFullscreen, onCompPanel, onCompPopout, onNativeClose, onNativeProgress, onPopoutClosed, tauriCompKey, tauriCompPopout, tauriPopoutPos, tauriPopoutStop, tauriSetFullscreen } from "./lib/tauri";
import { loadShareCode, saveShareCode, clearShareCode } from "./lib/pairing";

/** YouTube-style keys the VOD player forwards to the overlay. No "t" (there's no
 * theater mode for VOD — it's already a full player); Esc/Backspace stop. */
const VOD_SHORTCUTS = new Set([
  " ",
  "k",
  "m",
  "f",
  "j",
  "l",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Escape",
]);

type Load =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; config: ConfigBlob; errors: ConfigErrors }
  | { status: "error"; message: string };

/** A navigable page. The base of the stack is always a tab; opening a title or
 * episode pushes deeper. */
type Screen =
  | { kind: "tab"; tab: TabKey }
  | { kind: "title"; item: VodItem }
  | { kind: "source"; item: VodItem; episode: Episode; seasonNumber: number };

export function App() {
  // The desktop app is self-contained — no pairing. Use a stub code (the local
  // data layer ignores it) so the share-code screen is skipped. The browser/dev
  // build still pairs.
  const [shareCode, setShareCode] = useState<ShareCode | null>(() =>
    isTauri() ? ("BLAMMY" as ShareCode) : loadShareCode(),
  );
  // First run on desktop needs an AIOStreams URL (the onboarding screen).
  const [aioReady, setAioReady] = useState(
    () => !isTauri() || Boolean(getAioUrl()),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Phone-handoff setup overlay, re-openable from Settings (no remote typing).
  const [setupOpen, setSetupOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState(loadProfile);
  useEffect(() => saveProfile(profile), [profile]);
  const [load, setLoad] = useState<Load>({ status: "idle" });
  // A chosen VOD source playing fullscreen over everything (null = not playing).
  const [playing, setPlaying] = useState<{
    url: string;
    meta: TheaterMeta;
    item: VodItem;
    episodeId?: string;
    /** Seconds to resume from (Continue Watching); 0 = from the top. */
    start?: number;
  } | null>(null);
  const playSource = useCallback(
    (
      url: string,
      meta: TheaterMeta,
      ctx: { item: VodItem; episodeId?: string; start?: number },
    ) => {
      // Record it in Continue Watching. Position/duration are filled in once the
      // player reports progress; until then this is just "recently started".
      upsertContinueWatching({
        id: ctx.item.id,
        kind: ctx.item.kind,
        episodeId: ctx.episodeId,
        title: ctx.item.title,
        backdrop: ctx.item.backdrop ?? ctx.item.poster,
        positionSec: ctx.start ?? 0,
        durationSec: 0,
      });
      setPlaying({
        url,
        meta,
        item: ctx.item,
        episodeId: ctx.episodeId,
        start: ctx.start ?? 0,
      });
    },
    [],
  );

  // Navigation lives in the browser history, so Back/Forward — keyboard,
  // browser buttons, and the mouse thumb buttons — all step through pages.
  const [nav, setNav] = useState<{ stack: Screen[]; index: number }>({
    stack: [{ kind: "tab", tab: "live" }],
    index: 0,
  });

  // The spatial-focus key to restore once the screen we navigated (back) to has
  // re-rendered and its focusables have re-registered.
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    history.replaceState({ idx: 0 }, "");
    const onPop = (e: PopStateEvent) => {
      const idx = typeof e.state?.idx === "number" ? e.state.idx : 0;
      pendingFocus.current =
        typeof e.state?.focus === "string" ? e.state.focus : null;
      setNav((n) => ({
        stack: n.stack,
        index: Math.max(0, Math.min(idx, n.stack.length - 1)),
      }));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // After navigating back, return focus to whatever was focused when we left
  // this screen (saved in its history entry on push). rAF so the destination
  // screen's focusables have registered first.
  useEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    pendingFocus.current = null;
    const id = requestAnimationFrame(() => setFocus(key));
    return () => cancelAnimationFrame(id);
  }, [nav.index]);

  const push = useCallback((screen: Screen) => {
    // Stamp the screen we're leaving with its current focus, so Back restores it.
    const focus = getCurrentFocusKey();
    history.replaceState({ ...history.state, focus }, "");
    setNav((n) => {
      // Truncate any forward entries, like a browser does on a new navigation.
      const stack = n.stack.slice(0, n.index + 1).concat(screen);
      history.pushState({ idx: stack.length - 1 }, "");
      return { stack, index: stack.length - 1 };
    });
  }, []);

  const back = useCallback(() => history.back(), []);

  // Resume a Continue Watching title: re-resolve its top source (the saved
  // stream URL has likely expired) and play from the saved position. With no
  // sources, fall back to the title screen.
  const resumeWatching = useCallback(
    async (item: VodItem) => {
      if (!shareCode) return;
      const entry = listContinueWatching().find((e) => e.id === item.id);
      const episodeId = entry?.episodeId;
      const sourceId = episodeId ?? item.id;
      let sources: StreamSource[] = [];
      try {
        sources = await fetchVodSources(shareCode, item.kind, sourceId);
      } catch {
        /* fall through to the no-source fallback */
      }
      const top = sources[0];
      if (!top) {
        push({ kind: "title", item });
        return;
      }
      const meta: TheaterMeta = {
        logo: item.logo,
        backdrop: item.backdrop ?? item.poster,
        channelName: [
          item.year,
          item.kind === "series" ? "Series" : "Movie",
          `${top.quality}${top.cached ? " ⚡" : ""}`,
        ]
          .filter(Boolean)
          .join(" · "),
        title: item.title,
        description: item.synopsis,
        progressPct: 0,
        live: false,
        kind: "vod",
      };
      playSource(top.streamUrl, meta, {
        item,
        episodeId,
        start: entry?.positionSec ?? 0,
      });
    },
    [shareCode, push, playSource],
  );

  // Bumped per pull so a slow background EPG (or load) from a superseded pull
  // can't patch/overwrite the current one.
  const pullSeq = useRef(0);
  const pull = useCallback((code: ShareCode) => {
    const id = ++pullSeq.current;
    setLoad({ status: "loading" });
    fetchConfig(code, (programs) => {
      // The deferred EPG arrived — patch it into the live guide.
      if (id !== pullSeq.current) return;
      setLoad((prev) =>
        prev.status === "ready"
          ? {
              ...prev,
              config: { ...prev.config, live: { ...prev.config.live, programs } },
            }
          : prev,
      );
    })
      .then(({ config, errors }) => {
        if (id === pullSeq.current) setLoad({ status: "ready", config, errors });
      })
      .catch((err) => {
        if (id === pullSeq.current)
          setLoad({
            status: "error",
            message: err instanceof Error ? err.message : "Couldn't load",
          });
      });
  }, []);

  // The dumb-terminal lifecycle: as soon as we have a share code, phone home
  // for the config blob and render whatever comes back.
  useEffect(() => {
    if (shareCode) pull(shareCode);
  }, [shareCode, pull]);

  if (!shareCode) {
    return (
      <PairingScreen
        onPaired={(code) => {
          saveShareCode(code);
          setShareCode(code);
        }}
      />
    );
  }

  // First-run onboarding (desktop): collect the AIOStreams URL, then load.
  if (isTauri() && !aioReady) {
    return (
      <OnboardingScreen
        onDone={() => {
          setAioReady(true);
          pull(shareCode);
        }}
      />
    );
  }

  const screen = nav.stack[nav.index];
  const activeTab: TabKey = screen.kind === "tab" ? screen.tab : "stream";

  const onTab = (tab: TabKey) => {
    if (screen.kind === "tab" && screen.tab === tab) return;
    push({ kind: "tab", tab });
  };

  return (
    <div className="app-shell">
      <UpdateBanner />
      <AppHeader
        active={activeTab}
        onChange={onTab}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenProfile={() => setProfileOpen(true)}
        avatar={profile.avatar}
      />
      <main className="app-main">
        {load.status === "loading" || load.status === "idle" ? (
          <LoadingScreen />
        ) : load.status === "error" ? (
          <ErrorState
            message={load.message}
            onRetry={() => pull(shareCode)}
            onUnpair={() => {
              clearShareCode();
              setShareCode(null);
            }}
          />
        ) : (
          <CurrentScreen
            screen={screen}
            config={load.config}
            errors={load.errors}
            onRetry={() => pull(shareCode)}
            shareCode={shareCode}
            push={push}
            back={back}
            onPlay={playSource}
            onResume={resumeWatching}
          />
        )}
      </main>
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onConfigChanged={() => pull(shareCode)}
        onReRunSetup={() => {
          setSettingsOpen(false);
          setSetupOpen(true);
        }}
      />
      {setupOpen && (
        <SetupHandoff
          onDone={() => {
            setSetupOpen(false);
            pull(shareCode);
          }}
          onCancel={() => setSetupOpen(false)}
        />
      )}
      <ProfileModal
        open={profileOpen}
        profile={profile}
        onChange={setProfile}
        onClose={() => setProfileOpen(false)}
      />
      {playing && (
        <VodPlayer
          url={playing.url}
          meta={playing.meta}
          item={playing.item}
          episodeId={playing.episodeId}
          start={playing.start}
          shareCode={shareCode}
          onClose={() => setPlaying(null)}
          onSwitch={playSource}
        />
      )}
    </div>
  );
}

/** Plays a chosen VOD source. On Tauri it drives the native mpv composition
 * layer (same machinery as live). It opens "windowed-fill" — covering the app
 * window (taskbar still visible, letterboxed) — and the overlay's fullscreen
 * button toggles true OS fullscreen via the comp events. Tears down on close.
 * In the browser there's no native player, so it shows a short note. */
function VodPlayer({
  url,
  meta,
  item,
  episodeId,
  start = 0,
  shareCode,
  onClose,
  onSwitch,
}: {
  url: string;
  meta: TheaterMeta;
  item: VodItem;
  episodeId?: string;
  /** Seconds to resume from on the initial open (Continue Watching). */
  start?: number;
  shareCode: ShareCode;
  onClose: () => void;
  onSwitch: (
    url: string,
    meta: TheaterMeta,
    ctx: { item: VodItem; episodeId?: string },
  ) => void;
}) {
  // When popped out, the in-app player is replaced by a placeholder (the native
  // layer moved to mpv's floating window). `resumeAt` reopens it where it was;
  // it starts at `start` so a Continue Watching resume opens at the saved spot.
  const [poppedOut, setPoppedOut] = useState(false);
  const [resumeAt, setResumeAt] = useState(start);
  const posRef = useRef(0);
  // Episodes/sources side panel — the video shrinks to make room for it.
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef(false);
  panelRef.current = panelOpen;

  const bringBack = useCallback((pos: number) => {
    setResumeAt(pos > 0 ? pos : posRef.current);
    setPoppedOut(false);
  }, []);

  // Keep Continue Watching current from the native player's position ticks. The
  // store drops the entry automatically once it's past 90% watched.
  useEffect(() => {
    return onNativeProgress((position, duration) => {
      upsertContinueWatching({
        id: item.id,
        kind: item.kind,
        episodeId,
        title: item.title,
        backdrop: item.backdrop ?? item.poster,
        positionSec: position,
        durationSec: duration,
      });
    });
  }, [item, episodeId]);

  useEffect(() => {
    if (!isTauri()) return;
    const offClose = onCompClosed(onClose);
    const offFull = onCompFullscreen(() => tauriSetFullscreen(true));
    const offExit = onCompExitFullscreen(() => tauriSetFullscreen(false));
    // Pop out into mpv's own floating window (resumes at the current position,
    // captured server-side); keep the in-app player mounted as a placeholder.
    const offPop = onCompPopout(() => {
      void tauriCompPopout(url);
      tauriSetFullscreen(false);
      setPoppedOut(true);
    });
    // The user closed the floating window → bring the in-app player back where
    // it left off (last polled position).
    const offReclaim = onPopoutClosed(() => bringBack(posRef.current));
    // Toggle the episodes/sources side panel (the video shrinks for it).
    const offPanel = onCompPanel(() => setPanelOpen((o) => !o));
    // Android: the native PlayerView's Back button closes the player — drop the
    // React player route so we return to browsing.
    const offNative = onNativeClose(onClose);
    return () => {
      offClose();
      offFull();
      offExit();
      offPop();
      offReclaim();
      offPanel();
      offNative();
      tauriSetFullscreen(false);
    };
  }, [url, onClose, bringBack]);

  // While popped out, poll the floating window's position so a reclaim resumes
  // at the right spot.
  useEffect(() => {
    if (!poppedOut || !isTauri()) return;
    const id = window.setInterval(() => {
      void tauriPopoutPos()
        .then((p) => {
          if (p > 0) posRef.current = p;
        })
        .catch(() => {});
    }, 1000);
    return () => window.clearInterval(id);
  }, [poppedOut]);

  // The main webview holds keyboard focus, so capture the YouTube-style
  // shortcuts here and forward them to the overlay (which drives mpv) — same as
  // live. Capture phase + stopImmediatePropagation keeps the source list behind
  // from also acting on Esc/Backspace. Scroll = volume anywhere over the player.
  // Inactive while popped out (mpv's own window handles its keys).
  useEffect(() => {
    if (!isTauri() || poppedOut) return;
    const onKey = (e: KeyboardEvent) => {
      const raw = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const key = raw === "Backspace" ? "Escape" : raw;
      // With the panel open, Escape closes it (rather than stopping playback).
      if (panelRef.current && key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setPanelOpen(false);
        return;
      }
      if (!VOD_SHORTCUTS.has(key)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      void tauriCompKey(key).catch(() => {});
    };
    const onWheel = (e: WheelEvent) => {
      // Over the side panel, let it scroll instead of changing volume.
      const t = e.target as Element | null;
      if (t && t.closest(".src-panel")) return;
      e.preventDefault();
      void tauriCompKey(e.deltaY < 0 ? "ArrowUp" : "ArrowDown").catch(() => {});
    };
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("wheel", onWheel);
    };
  }, [poppedOut]);

  if (!isTauri()) {
    return (
      <div className="vod-player-fallback">
        <p>Playback opens in the BlammyTV desktop app.</p>
        <button className="btn btn--primary" type="button" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  if (poppedOut) {
    return (
      <div className="vod-player vod-player--popped">
        <p className="vod-popped__title">Player Popped Out</p>
        <button
          className="btn btn--primary"
          type="button"
          onClick={async () => {
            let pos = posRef.current;
            try {
              pos = await tauriPopoutPos();
            } catch {
              /* fall back to last polled position */
            }
            await tauriPopoutStop().catch(() => {});
            bringBack(pos);
          }}
        >
          Bring It Back
        </button>
      </div>
    );
  }

  return (
    <div className={"vod-player" + (panelOpen ? " vod-player--panel" : "")}>
      <div className="vod-player__stage">
        <CompositionPreview url={url} meta={meta} fullscreen start={resumeAt} />
      </div>
      {panelOpen && (
        <SourcePanel
          item={item}
          shareCode={shareCode}
          currentUrl={url}
          currentEpisodeId={episodeId}
          onPick={onSwitch}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </div>
  );
}

function CurrentScreen({
  screen,
  config,
  errors,
  onRetry,
  shareCode,
  push,
  back,
  onPlay,
  onResume,
}: {
  screen: Screen;
  config: ConfigBlob;
  errors: ConfigErrors;
  onRetry: () => void;
  shareCode: ShareCode;
  push: (s: Screen) => void;
  back: () => void;
  onPlay: (
    url: string,
    meta: TheaterMeta,
    ctx: { item: VodItem; episodeId?: string },
  ) => void;
  onResume: (item: VodItem) => void;
}) {
  switch (screen.kind) {
    case "tab":
      return (
        <TabContent
          tab={screen.tab}
          config={config}
          errors={errors}
          onRetry={onRetry}
          onOpen={(item) => push({ kind: "title", item })}
          onResume={onResume}
        />
      );
    case "title":
      return (
        <TitleScreen
          item={screen.item}
          shareCode={shareCode}
          push={push}
          back={back}
          onPlay={onPlay}
        />
      );
    case "source": {
      const { item, episode, seasonNumber } = screen;
      return (
        <SourceSelector
          item={item}
          shareCode={shareCode}
          sourceKind="series"
          sourceId={episode.id}
          fallbackSources={episode.sources}
          episodeLabel={`Season ${seasonNumber} · Episode ${episode.number}`}
          episodeTitle={episode.title}
          onBack={back}
          onPlay={onPlay}
        />
      );
    }
  }
}

/** A title page. The catalog item from the blob is lightweight, so on open we
 * pull full detail (synopsis/cast, and seasons for series) from the backend,
 * then branch: series → episode browser, movie → source selector. In demo mode
 * the item already carries everything, so it renders straight through. */
function TitleScreen({
  item,
  shareCode,
  push,
  back,
  onPlay,
}: {
  item: VodItem;
  shareCode: ShareCode;
  push: (s: Screen) => void;
  back: () => void;
  onPlay: (
    url: string,
    meta: TheaterMeta,
    ctx: { item: VodItem; episodeId?: string },
  ) => void;
}) {
  const [detail, setDetail] = useState<VodItem>(item);
  const [loading, setLoading] = useState(vodBackendConfigured());

  useEffect(() => {
    if (!vodBackendConfigured()) {
      setDetail(item);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    fetchVodDetail(shareCode, item.kind, item.id)
      .then((full) => {
        if (alive && full) setDetail(full);
      })
      .catch(() => {
        /* keep the lightweight item — at worst we show no sources */
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [item, shareCode]);

  if (loading) return <DetailLoading onBack={back} />;

  if (detail.kind === "series" && detail.seasons.length > 0) {
    return (
      <EpisodeBrowser
        item={detail}
        onBack={back}
        onPick={(episode, seasonNumber) =>
          push({ kind: "source", item: detail, episode, seasonNumber })
        }
      />
    );
  }
  return (
    <SourceSelector
      item={detail}
      shareCode={shareCode}
      sourceKind={detail.kind}
      sourceId={detail.id}
      fallbackSources={detail.sources}
      onBack={back}
      onPlay={onPlay}
    />
  );
}

/** Brief placeholder while a title's detail is fetched, with a way back out. */
function DetailLoading({ onBack }: { onBack: () => void }) {
  return (
    <div className="detail">
      <div className="detail__scrim" />
      <div className="detail__body">
        <button className="detail__back" type="button" onClick={onBack}>
          <ChevronIcon className="detail__back-icon" />
          Back
        </button>
        <p className="detail__loading">Loading…</p>
      </div>
    </div>
  );
}

function TabContent({
  tab,
  config,
  errors,
  onRetry,
  onOpen,
  onResume,
}: {
  tab: TabKey;
  config: ConfigBlob;
  errors: ConfigErrors;
  onRetry: () => void;
  onOpen: (item: VodItem) => void;
  onResume: (item: VodItem) => void;
}) {
  switch (tab) {
    case "live":
      return (
        <LiveScreen config={config} error={errors.live} onRetry={onRetry} />
      );
    case "stream":
      return (
        <StreamScreen
          config={config}
          error={errors.vod}
          onRetry={onRetry}
          onOpen={onOpen}
          onResume={onResume}
        />
      );
    case "discover":
      return (
        <PlaceholderScreen
          title="Discover"
          note="A place to browse and find something new to watch. Coming next."
        />
      );
  }
}

function ErrorState({
  message,
  onRetry,
  onUnpair,
}: {
  message: string;
  onRetry: () => void;
  onUnpair: () => void;
}) {
  return (
    <div className="error-state">
      <h2>Can't reach your setup</h2>
      <p>{message}</p>
      <div className="error-state__actions">
        <button className="btn btn--primary" type="button" onClick={onRetry}>
          Try again
        </button>
        <button className="btn" type="button" onClick={onUnpair}>
          Use a different code
        </button>
      </div>
    </div>
  );
}

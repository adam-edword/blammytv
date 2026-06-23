import { useCallback, useEffect, useState } from "react";
import type {
  ConfigBlob,
  ShareCode,
  VodItem,
  Episode,
} from "@blammytv/shared";
import { AppHeader } from "./components/AppHeader";
import { type TabKey } from "./components/TopTabs";
import { PairingScreen } from "./screens/PairingScreen";
import { LiveScreen } from "./screens/LiveScreen";
import { StreamScreen } from "./screens/StreamScreen";
import { PlaceholderScreen } from "./screens/PlaceholderScreen";
import { SourceSelector } from "./components/SourceSelector";
import { EpisodeBrowser } from "./components/EpisodeBrowser";
import { SettingsPanel } from "./components/SettingsPanel";
import { LoadingScreen } from "./components/LoadingScreen";
import { CompositionPreview } from "./components/CompositionPreview";
import type { TheaterMeta } from "./components/Player";
import { ChevronIcon } from "./components/icons";
import { fetchConfig } from "./lib/config";
import { fetchVodDetail, vodBackendConfigured } from "./lib/vod";
import { isTauri, onCompClosed, onCompExitFullscreen, onCompFullscreen, tauriCompKey, tauriSetFullscreen } from "./lib/tauri";
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
  | { status: "ready"; config: ConfigBlob }
  | { status: "error"; message: string };

/** A navigable page. The base of the stack is always a tab; opening a title or
 * episode pushes deeper. */
type Screen =
  | { kind: "tab"; tab: TabKey }
  | { kind: "title"; item: VodItem }
  | { kind: "source"; item: VodItem; episode: Episode; seasonNumber: number };

export function App() {
  const [shareCode, setShareCode] = useState<ShareCode | null>(() =>
    loadShareCode(),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ status: "idle" });
  // A chosen VOD source playing fullscreen over everything (null = not playing).
  const [playing, setPlaying] = useState<{
    url: string;
    meta: TheaterMeta;
  } | null>(null);

  // Navigation lives in the browser history, so Back/Forward — keyboard,
  // browser buttons, and the mouse thumb buttons — all step through pages.
  const [nav, setNav] = useState<{ stack: Screen[]; index: number }>({
    stack: [{ kind: "tab", tab: "live" }],
    index: 0,
  });

  useEffect(() => {
    history.replaceState({ idx: 0 }, "");
    const onPop = (e: PopStateEvent) => {
      const idx = typeof e.state?.idx === "number" ? e.state.idx : 0;
      setNav((n) => ({
        stack: n.stack,
        index: Math.max(0, Math.min(idx, n.stack.length - 1)),
      }));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const push = useCallback((screen: Screen) => {
    setNav((n) => {
      // Truncate any forward entries, like a browser does on a new navigation.
      const stack = n.stack.slice(0, n.index + 1).concat(screen);
      history.pushState({ idx: stack.length - 1 }, "");
      return { stack, index: stack.length - 1 };
    });
  }, []);

  const back = useCallback(() => history.back(), []);

  const pull = useCallback((code: ShareCode) => {
    setLoad({ status: "loading" });
    fetchConfig(code)
      .then((config) => setLoad({ status: "ready", config }))
      .catch((err) =>
        setLoad({
          status: "error",
          message: err instanceof Error ? err.message : "Couldn't load",
        }),
      );
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

  const screen = nav.stack[nav.index];
  const activeTab: TabKey = screen.kind === "tab" ? screen.tab : "stream";

  const onTab = (tab: TabKey) => {
    if (screen.kind === "tab" && screen.tab === tab) return;
    push({ kind: "tab", tab });
  };

  return (
    <div className="app-shell">
      <AppHeader
        active={activeTab}
        onChange={onTab}
        onOpenSettings={() => setSettingsOpen(true)}
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
            shareCode={shareCode}
            push={push}
            back={back}
            onPlay={(url, meta) => setPlaying({ url, meta })}
          />
        )}
      </main>
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onConfigChanged={() => pull(shareCode)}
      />
      {playing && (
        <VodPlayer
          url={playing.url}
          meta={playing.meta}
          onClose={() => setPlaying(null)}
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
  onClose,
}: {
  url: string;
  meta: TheaterMeta;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!isTauri()) return;
    const offClose = onCompClosed(onClose);
    const offFull = onCompFullscreen(() => tauriSetFullscreen(true));
    const offExit = onCompExitFullscreen(() => tauriSetFullscreen(false));
    return () => {
      offClose();
      offFull();
      offExit();
      tauriSetFullscreen(false);
    };
    // onClose just clears state; binding once per source is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // The main webview holds keyboard focus, so capture the YouTube-style
  // shortcuts here and forward them to the overlay (which drives mpv) — same as
  // live. Capture phase + stopImmediatePropagation keeps the source list behind
  // from also acting on Esc/Backspace. Scroll = volume anywhere over the player.
  useEffect(() => {
    if (!isTauri()) return;
    const onKey = (e: KeyboardEvent) => {
      const raw = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const key = raw === "Backspace" ? "Escape" : raw;
      if (!VOD_SHORTCUTS.has(key)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      void tauriCompKey(key).catch(() => {});
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      void tauriCompKey(e.deltaY < 0 ? "ArrowUp" : "ArrowDown").catch(() => {});
    };
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("wheel", onWheel);
    };
  }, []);

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
  return (
    <div className="vod-player">
      <CompositionPreview url={url} meta={meta} fullscreen />
    </div>
  );
}

function CurrentScreen({
  screen,
  config,
  shareCode,
  push,
  back,
  onPlay,
}: {
  screen: Screen;
  config: ConfigBlob;
  shareCode: ShareCode;
  push: (s: Screen) => void;
  back: () => void;
  onPlay: (url: string, meta: TheaterMeta) => void;
}) {
  switch (screen.kind) {
    case "tab":
      return (
        <TabContent
          tab={screen.tab}
          config={config}
          onOpen={(item) => push({ kind: "title", item })}
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
  onPlay: (url: string, meta: TheaterMeta) => void;
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
  onOpen,
}: {
  tab: TabKey;
  config: ConfigBlob;
  onOpen: (item: VodItem) => void;
}) {
  switch (tab) {
    case "live":
      return <LiveScreen config={config} />;
    case "stream":
      return <StreamScreen config={config} onOpen={onOpen} />;
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

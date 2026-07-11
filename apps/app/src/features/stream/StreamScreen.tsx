import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckIcon, ChevronIcon, CloseIcon, PlayIcon } from "../../ui/icons";
import { createPortal } from "react-dom";
import { isTauri, tauriSetFullscreen } from "../../lib/tauri";
import { setOverlayApiOverride } from "../live/overlayApi";
import { InvertedPlayer } from "../live/InvertedPlayer";
import { TheaterOverlay } from "../live/TheaterOverlay";
import { useDirectOverlay } from "../live/useDirectOverlay";
import type { Episode, Season, StreamSource, VodData, VodItem } from "./model";
import {
  loadVod,
  onVodUpdate,
  peekVod,
  resolveVodItem,
  resolveVodSources,
} from "./source";
import { nextEpisode, nextUpEpisode, pickCachedIndex } from "./mapper";
import { getAniskipRanges, type SkipRange } from "./aniskip";
import {
  onOpenRequest,
  requestReturnToDiscover,
  takeOpenRequest,
} from "./openRequest";
import { loadWatched, markWatched } from "./watched";
import { inMyList, toggleMyList } from "./myList";
import { loadAioUrl } from "../settings/aiostreams";
import { loadOneClickPlay } from "../settings/oneClickPlay";
import {
  fetchDiscoverPage,
  gridCatalogs,
  interleave,
  loadDiscover,
  type DiscoverConfig,
} from "../discover/data";
import {
  cardMetaLine,
  loadCardMeta,
  onCardMetaChange,
  type CardMetaField,
} from "../settings/cardMeta";
import {
  clearWatching,
  loadWatching,
  recordWatching,
  resumePoint,
  retiredFromContinue,
  updateWatchingProgress,
  type WatchEntry,
} from "./watching";
import {
  onPopoutClosed,
  tauriMpvStatus,
  tauriPopoutOpen,
  tauriPopoutPos,
  tauriPopoutStop,
} from "../../lib/tauri";

/**
 * The Stream tab: AIOStreams-powered movies + series. A featured hero, then
 * poster rows; click through to a detail page whose right rail lists the
 * addon's pre-ranked sources; picking one plays fullscreen through the same
 * inverted-layer player Live uses. Ported in spirit from the old build's
 * StreamScreen/SourceSelector/EpisodeBrowser trio, restyled to the rebuild.
 * (VOD scrubber chrome is the next phase — j/l/arrow seeks already work
 * through the shared overlay's keys.)
 */

type View =
  | { at: "home" }
  | { at: "title"; item: VodItem }
  | { at: "episodes"; item: VodItem }
  | {
      at: "sources";
      item: VodItem;
      episodeId?: string;
      episodeLabel?: string;
      /** Structured pieces for the overlay's granular meta toggles. */
      episodeInfo?: { season: number; episode: number; title: string };
    };

type Load =
  | { status: "loading" }
  | { status: "ready"; data: VodData }
  | { status: "error"; message: string };

export function StreamScreen() {
  const [load, setLoad] = useState<Load>(() => {
    const cached = peekVod();
    return cached ? { status: "ready", data: cached } : { status: "loading" };
  });
  const [view, setView] = useState<View>({ at: "home" });
  const [playing, setPlayingRaw] = useState<{
    url: string;
    item: VodItem;
    label?: string;
    episodeId?: string;
    episodeInfo?: { season: number; episode: number; title: string };
    /** Remaining source candidates, in addon order — the failover queue. */
    queue?: StreamSource[];
    /** The playing source's binge key — episode rolls stay in-group. */
    bingeGroup?: string;
    resumeAt?: number;
    /** theater = fills the APP WINDOW; fullscreen = OS fullscreen. */
    mode: "theater" | "fullscreen";
    /** Playing in the PiP window: the stage stays (black), video doesn't. */
    popped?: boolean;
  } | null>(null);
  const [watching, setWatching] = useState<WatchEntry[]>(loadWatching);
  // Between "user clicked play" and "sources resolved": the player-style
  // black screen with the art breathing, INSTANTLY — a quick-resume /
  // Watch Now click must never sit on a dead screen for seconds.
  const [resolving, setResolving] = useState<{
    art?: string;
    title: string;
  } | null>(null);
  const setPlaying = useCallback(
    (
      p: {
        url: string;
        item: VodItem;
        label?: string;
        episodeId?: string;
        episodeInfo?: { season: number; episode: number; title: string };
        queue?: StreamSource[];
        bingeGroup?: string;
      } | null,
    ) => {
      if (!p) {
        setUpNext(null);
        setUpNextMini(null);
        setResolving(null);
        return setPlayingRaw(null);
      }
      setUpNext(null);
      setUpNextMini(null);
      setResolving(null);
      // Starting a new play while a pop-out runs would double the provider
      // connections — reel the pop-out in first (silent close).
      if (playingRef.current?.popped) void tauriPopoutStop().catch(() => {});
      // Resume decision reads the entry BEFORE this play overwrites it —
      // same title (and, for series, same episode) picks up a few seconds
      // before where it left off.
      const prev = loadWatching().find((e) => e.id === p.item.id);
      const resumeAt = resumePoint(prev, p.episodeId);
      const sameEp = !p.episodeId || prev?.episodeId === p.episodeId;
      // Playback opens in THEATER (fills the app window); f goes OS-full.
      setPlayingRaw({ ...p, resumeAt, mode: "theater" });
      setWatching(
        recordWatching({
          id: p.item.id,
          episodeId: p.episodeId,
          title: p.item.title,
          label: p.label,
          art: p.item.backdrop ?? p.item.poster,
          logo: p.item.logo,
          rating: p.item.rating,
          year: p.item.year,
          runtimeMin: p.item.runtimeMin,
          genre: p.item.genres[0],
          kind: p.item.kind,
          ...(p.episodeInfo
            ? {
                season: p.episodeInfo.season,
                episode: p.episodeInfo.episode,
                epTitle: p.episodeInfo.title,
              }
            : {}),
          // Same episode/title keeps its progress; switching episodes resets.
          ...(sameEp && prev?.posSec ? { posSec: prev.posSec } : {}),
          ...(sameEp && prev?.durSec ? { durSec: prev.durSec } : {}),
          at: Date.now(),
        }),
      );
    },
    [],
  );

  // Hero picks enrich after the rows land — repaint as each arrives (the
  // shared items map is already mutated; a fresh outer object re-renders).
  useEffect(
    () =>
      onVodUpdate((data) => setLoad({ status: "ready", data: { ...data } })),
    [],
  );
  useEffect(() => {
    let stale = false;
    loadVod().then(
      (data) =>
        !stale &&
        setLoad((prev) =>
          data.error
            ? // A failed refresh never replaces a catalog we're already
              // showing (the stale-while-revalidate peek) with an error.
              prev.status === "ready"
              ? prev
              : { status: "error", message: data.error }
            : { status: "ready", data },
        ),
      (e) =>
        !stale &&
        setLoad((prev) =>
          prev.status === "ready"
            ? prev
            : {
                status: "error",
                message: e instanceof Error ? e.message : String(e),
              },
        ),
    );
    return () => {
      stale = true;
    };
  }, []);

  // Back/forward history over the view state — the ← Back buttons and the
  // mouse side buttons (4 = back, 5 = forward) all walk the same stacks.
  // Stack mutation stays OUTSIDE the setView updaters: updaters must be
  // pure (StrictMode double-invokes them — a pop inside ran twice and Back
  // became a no-op in dev). viewRef mirrors the committed view instead.
  const backStack = useRef<View[]>([]);
  const fwdStack = useRef<View[]>([]);
  const viewRef = useRef(view);
  viewRef.current = view;
  const navigate = useCallback((next: View) => {
    backStack.current.push(viewRef.current);
    fwdStack.current = [];
    setView(next);
  }, []);
  // Set when the current stack was seeded by a Discover hand-off: backing
  // all the way out returns to Discover (where the pick was made), not
  // Stream home. The ref dies with the screen, so a real Stream visit
  // never inherits it.
  const handoffRef = useRef(false);
  const goBack = useCallback(() => {
    const prev = backStack.current.pop();
    if (!prev) return;
    fwdStack.current.push(viewRef.current);
    setView(prev);
    if (handoffRef.current && backStack.current.length === 0) {
      handoffRef.current = false;
      requestReturnToDiscover();
    }
  }, []);
  const goForward = useCallback(() => {
    const next = fwdStack.current.pop();
    if (!next) return;
    backStack.current.push(viewRef.current);
    setView(next);
  }, []);
  useEffect(() => {
    if (playing) return;
    // MouseEvent.button: 3 = back (mouse 4), 4 = forward (mouse 5).
    // preventDefault on BOTH phases or WebView2 walks its own history.
    const onButton = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      if (e.type === "mouseup") (e.button === 3 ? goBack : goForward)();
    };
    window.addEventListener("mousedown", onButton);
    window.addEventListener("mouseup", onButton);
    return () => {
      window.removeEventListener("mousedown", onButton);
      window.removeEventListener("mouseup", onButton);
    };
  }, [playing, goBack, goForward]);

  const open = useCallback(async (item: VodItem) => {
    // Show the lightweight item immediately; swap in the full detail
    // (synopsis, cast, seasons) when it lands. Failure keeps the light one.
    navigate(
      item.kind === "series" ? { at: "episodes", item } : { at: "title", item },
    );
    try {
      const full = await resolveVodItem(item.kind, item.id);
      if (full)
        setView((v) =>
          (v.at === "title" || v.at === "episodes") && v.item.id === item.id
            ? { ...v, item: full }
            : v,
        );
    } catch {
      /* best-effort: the light item still renders */
    }
  }, [navigate]);

  // Hero "Watch Now": resolve fresh sources and play the best CACHED one
  // straight away (the addon's ranking within cached). Auto-play NEVER
  // touches an uncached source: opening one tells debrid to start
  // downloading a torrent, no frame arrives for minutes, and a burst of
  // those requests rate-limited a real account. No cached source → the
  // detail page, where uncached is a visible, deliberate click.
  const watchNow = useCallback(
    async (item: VodItem) => {
      if (item.kind === "series") return open(item); // series always browse
      setResolving({ art: item.logo ?? item.poster, title: item.title });
      try {
        const sources = await resolveVodSources("movie", item.id);
        const idx = sources.findIndex((s) => s.cached);
        if (idx >= 0)
          return setPlaying({
            url: sources[idx].streamUrl,
            item,
            bingeGroup: sources[idx].bingeGroup,
            queue: sources.filter((s, i) => i !== idx && s.cached),
          });
      } catch {
        /* fall through to detail */
      }
      setResolving(null);
      void open(item);
    },
    [open, setPlaying],
  );

  // Card click: browse — or, with the opt-in setting on, straight to
  // playback for MOVIES (watchNow falls back to the detail page when
  // nothing's cached; series always browse). Read at click time so the
  // Settings toggle applies without a remount.
  const cardOpen = useCallback(
    (item: VodItem) =>
      loadOneClickPlay() && item.kind === "movie"
        ? watchNow(item)
        : open(item),
    [watchNow, open],
  );

  // Discover/My List → Stream handoff: drain the mailbox on mount (the
  // tab switch mounts this screen after the request was parked) and on
  // the event (already-on-Stream case). One-click play applies here too.
  useEffect(() => {
    const consume = () => {
      const item = takeOpenRequest();
      if (item) {
        handoffRef.current = true;
        void cardOpen(item);
      }
    };
    consume();
    return onOpenRequest(consume);
  }, [cardOpen]);

  // ---- Playback: fullscreen through the shared inverted player. The
  // overlay's meta is minimal VOD shape (live:false, no programme). ----
  const stop = useCallback(() => {
    setPlaying(null);
    if (isTauri()) void tauriSetFullscreen(false).catch(() => {});
  }, [setPlaying]);
  // Theater ↔ OS-fullscreen. State flips in the pure updater; the window
  // call rides outside it.
  const setVodMode = useCallback((mode: "theater" | "fullscreen") => {
    setPlayingRaw((p) => (p && p.mode !== mode ? { ...p, mode } : p));
    if (isTauri()) void tauriSetFullscreen(mode === "fullscreen").catch(() => {});
  }, []);

  // Up Next (series EOF): the stage stays black, the card counts down.
  const [upNext, setUpNext] = useState<{
    item: VodItem;
    season: Season;
    episode: Episode;
  } | null>(null);
  // Mini Up Next: the corner popup while the CREDITS still play (the
  // fullscreen card above is reserved for true EOF). Driven by the
  // overlay's creditsWindow signal; ✕ keys the dismissal to the next
  // episode's id, so the card stays away for the rest of this episode's
  // credits but the following episode gets a fresh one.
  const [upNextMini, setUpNextMini] = useState<{
    item: VodItem;
    season: Season;
    episode: Episode;
  } | null>(null);
  const miniDismissedRef = useRef<string | null>(null);
  // Shared by Up Next, the overlay's next-episode button, and any future
  // episode jump: resolve cached-first and play, else land on sources.
  const playEpisode = useCallback(
    async (item: VodItem, season: Season, episode: Episode) => {
      // Sticky bingeGroup (Stremio semantics): rolling to another episode
      // prefers a cached source from the SAME release group as what's
      // playing now — captured before setResolving/setPlaying churn it.
      const stickyGroup = playingRef.current?.bingeGroup;
      setResolving({ art: item.logo ?? item.poster, title: item.title });
      const label = `S${season.number} · E${episode.number} — ${episode.title}`;
      const info = {
        season: season.number,
        episode: episode.number,
        title: episode.title,
      };
      try {
        const sources = await resolveVodSources("series", episode.id);
        // Cached only — see watchNow. No cached → the source screen below.
        const idx = pickCachedIndex(sources, stickyGroup);
        if (idx >= 0) {
          setPlaying({
            url: sources[idx].streamUrl,
            item,
            label,
            episodeId: episode.id,
            episodeInfo: info,
            bingeGroup: sources[idx].bingeGroup,
            queue: sources.filter((s, i) => i !== idx && s.cached),
          });
          return;
        }
      } catch {
        /* fall through to the source screen */
      }
      setPlaying(null);
      if (isTauri()) void tauriSetFullscreen(false).catch(() => {});
      navigate({
        at: "sources",
        item,
        episodeId: episode.id,
        episodeLabel: label,
        episodeInfo: info,
      });
    },
    [setPlaying, navigate],
  );
  const playUpNext = useCallback(async () => {
    const un = upNextRef.current;
    if (!un) return;
    setUpNext(null);
    await playEpisode(un.item, un.season, un.episode);
  }, [playEpisode]);
  const upNextRef = useRef(upNext);
  upNextRef.current = upNext;
  // Autoplay countdown — the tick and the fire live in separate effects
  // (updaters stay pure; StrictMode double-invokes them).
  const [countdown, setCountdown] = useState(10);
  useEffect(() => {
    if (!upNext) return;
    setCountdown(10);
    const id = window.setInterval(
      () => setCountdown((c) => Math.max(0, c - 1)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [upNext]);
  useEffect(() => {
    if (upNext && countdown === 0) void playUpNext();
  }, [countdown, upNext, playUpNext]);

  // Source failover: play the next CACHED candidate from the queue at
  // (about) the position the dying source reached. Uncached candidates are
  // skipped for the same reason auto-play never picks them (see watchNow) —
  // auto-pick queues are already cached-only, but the panel's queue keeps
  // the full list. No cached candidate left → exit cleanly.
  const tryNextSource = useCallback(() => {
    const p = playingRef.current;
    if (!p) return;
    const q = p.queue ?? [];
    const nextIdx = q.findIndex((s) => s.cached);
    const next = nextIdx >= 0 ? q[nextIdx] : undefined;
    const rest = nextIdx >= 0 ? q.slice(nextIdx + 1) : [];
    if (!next) {
      setPlaying(null);
      if (isTauri()) void tauriSetFullscreen(false).catch(() => {});
      return;
    }
    const entry = loadWatching().find((e) => e.id === p.item.id);
    const at =
      entry?.posSec && entry.posSec > 10
        ? Math.max(0, entry.posSec - 3)
        : undefined;
    setPlayingRaw({
      ...p,
      url: next.streamUrl,
      bingeGroup: next.bingeGroup,
      queue: rest,
      resumeAt: at,
    });
  }, [setPlaying]);

  // Continue Watching quick-resume: one click straight into playback
  // (sources resolve fresh; first cached wins). Any miss falls back to
  // the detail/source screen.
  const quickResume = useCallback(
    async (entry: WatchEntry, known?: VodItem) => {
      const kind = entry.kind ?? (entry.episodeId ? "series" : "movie");
      setResolving({
        art: known?.logo ?? entry.logo ?? known?.poster ?? entry.art,
        title: entry.title,
      });
      let item = known;
      if (!item || (kind === "series" && item.seasons.length === 0)) {
        const full = await resolveVodItem(kind, entry.id).catch(() => null);
        if (full) item = full;
        // The catalog preview had no clearlogo; the full meta does —
        // upgrade the breathing art mid-resolve.
        if (full?.logo)
          setResolving((r) => (r ? { ...r, art: full.logo } : r));
      }
      if (!item) {
        setResolving(null);
        return;
      }
      const episodeInfo =
        entry.season != null && entry.episode != null
          ? {
              season: entry.season,
              episode: entry.episode,
              title: entry.epTitle ?? "",
            }
          : undefined;
      try {
        const sources = await resolveVodSources(
          kind,
          entry.episodeId ?? item.id,
        );
        // Cached only — see watchNow. This is the path that got a real
        // account rate-limited: quick-resume auto-played an uncached
        // source sight-unseen, then the tune watchdog re-requested it.
        const idx = sources.findIndex((s) => s.cached);
        if (idx >= 0) {
          setPlaying({
            url: sources[idx].streamUrl,
            item,
            label: entry.label,
            episodeId: entry.episodeId,
            episodeInfo,
            bingeGroup: sources[idx].bingeGroup,
            queue: sources.filter((s, i) => i !== idx && s.cached),
          });
          return;
        }
        // Nothing cached: land the episode's own source screen so the
        // pick (with its missing ⚡) is deliberate; movies get the detail
        // page below, which shows the same list.
        if (entry.episodeId) {
          setResolving(null);
          navigate({
            at: "sources",
            item,
            episodeId: entry.episodeId,
            episodeLabel: entry.label,
            episodeInfo,
          });
          return;
        }
      } catch {
        /* fall through to the browse path */
      }
      setResolving(null);
      void open(item);
    },
    [setPlaying, open, navigate],
  );

  // Skip Intro Phase 2: exact AniSkip intervals for the playing episode,
  // resolved async (imdb → MAL via the cached mapping index, then one API
  // call). Everything fails soft to the chapter heuristics in the overlay.
  const [aniSkips, setAniSkips] = useState<SkipRange[] | null>(null);
  useEffect(() => {
    setAniSkips(null);
    const p = playingRef.current;
    if (!p) return;
    let stale = false;
    getAniskipRanges(p.item, p.episodeId).then(
      (r) => {
        if (!stale && r.length) setAniSkips(r);
      },
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [playing?.url, playing?.episodeId]);

  // In-playback source panel: slides over the video (which keeps playing);
  // picking a source switches the stream at the current position. Sources
  // resolve fresh on every open — debrid links are short-lived.
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelSources, setPanelSources] = useState<
    StreamSource[] | null | "failed"
  >(null);
  useEffect(() => {
    if (!playing) setPanelOpen(false);
  }, [playing]);
  useEffect(() => {
    if (!panelOpen) return;
    const p = playingRef.current;
    if (!p) return;
    let stale = false;
    setPanelSources(null);
    resolveVodSources(p.item.kind, p.episodeId ?? p.item.id).then(
      (list) => !stale && setPanelSources(list),
      () => !stale && setPanelSources("failed"),
    );
    return () => {
      stale = true;
    };
  }, [panelOpen]);
  const pickPanelSource = useCallback((src: StreamSource, all: StreamSource[]) => {
    const p = playingRef.current;
    if (!p) return;
    setPanelOpen(false);
    if (src.streamUrl === p.url) return; // already playing this one
    const entry = loadWatching().find((e) => e.id === p.item.id);
    const at =
      entry?.posSec && entry.posSec > 10
        ? Math.max(0, entry.posSec - 3)
        : undefined;
    setPlayingRaw({
      ...p,
      url: src.streamUrl,
      bingeGroup: src.bingeGroup,
      queue: all.filter((s) => s.id !== src.id && s.streamUrl !== p.url),
      resumeAt: at,
    });
  }, []);
  const playMeta = playing
    ? {
        channelName: playing.item.title,
        logo: playing.item.logo ?? playing.item.poster,
        title: playing.label ?? playing.item.title,
        description: playing.item.synopsis,
        live: false,
        skips: aniSkips ?? undefined,
        vod: playing.episodeInfo
          ? {
              ...playing.episodeInfo,
              hasNext:
                !!playing.episodeId &&
                !!nextEpisode(playing.item.seasons, playing.episodeId),
            }
          : undefined,
      }
    : null;
  const directApi = useDirectOverlay(
    isTauri() && !!playing && !playing.popped,
    playing?.url ?? null,
    playMeta,
    {
      onClose: stop,
      onExpand: () => {},
      onCollapse: stop, // t / ✕ in theater = back to the catalog
      onFullscreen: () => setVodMode("fullscreen"),
      onExitFullscreen: () => setVodMode("theater"),
      // Same open sequence Live uses: heal the shell's clip hole BEFORE
      // Rust tears the video child down (losing that race flashes the
      // desktop through the still-cut hole), then popout_open captures
      // time-pos natively so the PiP resumes exactly there. The app STAYS
      // on the fullscreen stage, black, until the PiP closes — then
      // playback returns in-app at the popout's final position.
      onPopout: () => {
        if (!playing) return;
        const shell = document.querySelector<HTMLElement>(".app-shell");
        if (shell) shell.style.clipPath = "";
        void tauriPopoutOpen(playing.url).catch(() => {});
        // Old-app pattern: popping out drops OS fullscreen — the popped
        // placeholder is a normal windowed app view.
        setPlayingRaw({ ...playing, popped: true, mode: "theater" });
        if (isTauri()) void tauriSetFullscreen(false).catch(() => {});
      },
      onToggleFavorite: () => {},
      // Natural end of the file: mark the entry finished (full bar; next
      // play starts over), ledger the episode as watched, then either roll
      // the Up Next card (series with a next episode) or exit. Without
      // this, EOF took the live-death path — watchdog reload, restart at
      // 0:00, and the progress tick then shredding the saved position.
      onEnded: () => {
        setUpNextMini(null); // the fullscreen card takes over at true EOF
        const p = playingRef.current;
        if (p) {
          const e = loadWatching().find((x) => x.id === p.item.id);
          if (e?.durSec)
            setWatching(updateWatchingProgress(p.item.id, e.durSec, e.durSec));
          if (p.episodeId) {
            markWatched(p.item.id, p.episodeId);
            const nxt = nextEpisode(p.item.seasons, p.episodeId);
            if (nxt) {
              // Re-arm the countdown HERE, not just in the [upNext]
              // effect: after a fired countdown the state rests at 0, and
              // the fire effect would see 0 + the new card in the same
              // commit — episode 3 of a binge started with no card.
              setCountdown(10);
              setUpNext({ item: p.item, ...nxt });
              return; // stage stays; the Up Next card takes over
            }
          }
        }
        stop();
      },
      onNextSource: () => tryNextSource(),
      onNextEpisode: () => {
        const p = playingRef.current;
        if (!p?.episodeId) return;
        const nxt = nextEpisode(p.item.seasons, p.episodeId);
        if (nxt) void playEpisode(p.item, nxt.season, nxt.episode);
      },
      onSourcePanel: () => setPanelOpen((o) => !o),
      // Credits started/ended (overlay's AniSkip/chapter clock): pop the
      // corner Up Next while the episode still plays — never for movies,
      // never re-popping one the user dismissed this cycle.
      onCreditsWindow: (active) => {
        if (!active) return setUpNextMini(null);
        const p = playingRef.current;
        if (!p?.episodeId || p.popped) return;
        const nxt = nextEpisode(p.item.seasons, p.episodeId);
        if (!nxt || miniDismissedRef.current === nxt.episode.id) return;
        setUpNextMini({ item: p.item, ...nxt });
      },
    },
  );
  if (isTauri() && playing) setOverlayApiOverride(directApi);

  // Resume-from-position: one absolute seek on the first presented frame
  // (seeking before the file loads is a no-op mpv-side).
  const resumedRef = useRef(false);
  useEffect(() => {
    resumedRef.current = false;
    if (!playing?.resumeAt || playing.popped || !isTauri()) return;
    const at = playing.resumeAt;
    const fire = () => {
      if (resumedRef.current) return;
      resumedRef.current = true;
      directApi.seekAbs?.(at);
    };
    if (!directApi.getLoading()) fire();
    return directApi.onLoading((l) => {
      if (!l) fire();
    });
    // popped in the deps: returning from the PiP remounts playback and
    // must re-arm the one-shot seek.
  }, [playing?.url, playing?.resumeAt, playing?.popped, directApi]);

  // PiP closed → bring playback back in-app, resuming where the popout
  // got to (its final position rides the event; the watch entry catches
  // up too). Ignored unless we're actually in popped state.
  const playingRef = useRef(playing);
  playingRef.current = playing;
  useEffect(() => {
    if (!isTauri()) return;
    return onPopoutClosed((pos) => {
      const p = playingRef.current;
      if (!p?.popped) return;
      if (pos) setWatching(updateWatchingProgress(p.item.id, pos));
      // No position from the quitting core → fall back to the watch
      // entry (ticked up to the pop moment), then to the original resume.
      const fallback = pos
        ? undefined
        : resumePoint(loadWatching().find((e) => e.id === p.item.id));
      setPlayingRaw({
        ...p,
        popped: false,
        resumeAt: pos ? Math.max(0, pos - 1) : (fallback ?? p.resumeAt),
      });
    });
  }, []);

  // While popped: poll the floating window's position every second (the
  // old app's pattern) so Bring It Back / a reclaim resumes at the right
  // spot — and Continue Watching keeps ticking through the PiP session.
  const popPosRef = useRef(0);
  useEffect(() => {
    if (!playing?.popped || !isTauri()) return;
    popPosRef.current = 0;
    const itemId = playing.item.id;
    const id = window.setInterval(() => {
      tauriPopoutPos()
        .then((p) => {
          if (p > 0) {
            popPosRef.current = p;
            setWatching(updateWatchingProgress(itemId, p));
          }
        })
        .catch(() => {});
    }, 1000);
    return () => window.clearInterval(id);
  }, [playing]);
  // "Bring It Back": read the popout's position, close it silently (no
  // popout-closed event — stop_popout takes ownership first), resume here.
  // Fallback chain: live read → last 1s-poll value → the watch entry —
  // a fresh read that RESOLVES 0.0 (popout died under the click) must not
  // discard a whole PiP session's worth of polled progress.
  const bringBack = useCallback(async () => {
    const p = playingRef.current;
    if (!p?.popped) return;
    let pos = 0;
    try {
      pos = await tauriPopoutPos();
    } catch {
      /* fall through the chain */
    }
    if (!(pos > 0)) pos = popPosRef.current;
    await tauriPopoutStop().catch(() => {});
    const fallback =
      pos > 0
        ? undefined
        : resumePoint(loadWatching().find((e) => e.id === p.item.id));
    setPlayingRaw({
      ...p,
      popped: false,
      resumeAt: pos > 0 ? Math.max(0, pos - 1) : (fallback ?? p.resumeAt),
    });
  }, []);
  // Unmounting this screen while popped (any escape hatch to another tab)
  // must not orphan the pop-out: nothing would track it, and LiveScreen's
  // popout-closed listener would misread its close as a live reclaim.
  useEffect(
    () => () => {
      if (playingRef.current?.popped) void tauriPopoutStop().catch(() => {});
    },
    [],
  );

  // Progress tick: every 5s while playing, mirror pos/dur into the watch
  // entry — powers resume and the Continue Watching progress bar.
  useEffect(() => {
    if (!playing || playing.popped || !isTauri()) return;
    const itemId = playing.item.id;
    const episodeId = playing.episodeId;
    const id = window.setInterval(() => {
      tauriMpvStatus()
        .then((st) => {
          if (st.pos != null && st.pos > 0)
            setWatching(
              updateWatchingProgress(itemId, st.pos, st.dur ?? undefined),
            );
          // 90% through = watched, same threshold resumePoint treats as
          // finished — credits-skippers and next-episode jumps get their
          // checkmarks without reaching hard EOF (markWatched dedupes).
          if (
            episodeId &&
            st.pos != null &&
            st.dur != null &&
            st.dur > 0 &&
            st.pos >= st.dur * 0.9
          )
            markWatched(itemId, episodeId);
        })
        .catch(() => {});
    }, 5000);
    return () => window.clearInterval(id);
  }, [playing]);
  const chromeHostRef = useRef<HTMLDivElement | null>(null);
  if (isTauri() && !chromeHostRef.current) {
    const host = document.createElement("div");
    host.id = "inv-chrome";
    chromeHostRef.current = host;
  }
  // One mount per stream (url key, NOT the playing identity — mode flips
  // must not re-force the window state setVodMode owns). While popped the
  // host comes DOWN: an empty full-window layer above the app swallowed
  // every click. The initial mode is applied here off the ref.
  const playingUrl = playing?.url ?? null;
  const popped = !!playing?.popped;
  useEffect(() => {
    const host = chromeHostRef.current;
    if (!host || !playingUrl || popped) return;
    document.body.appendChild(host);
    void tauriSetFullscreen(
      playingRef.current?.mode === "fullscreen",
    ).catch(() => {});
    return () => {
      host.remove();
    };
  }, [playingUrl, popped]);

  if (resolving && !playing && isTauri()) {
    return (
      <div className="vod-stage vod-stage--popped">
        <div className="vod-pip">
          {resolving.art ? (
            <img
              className="tune__vodlogo"
              src={resolving.art}
              alt=""
              aria-hidden
            />
          ) : (
            <span className="tune__vodtitle">{resolving.title}</span>
          )}
        </div>
      </div>
    );
  }

  if (playing && isTauri()) {
    return (
      <div className={"vod-stage" + (playing.popped ? " vod-stage--popped" : "")}>
        <div id="player-slot" className="vod-stage__slot" />
        {!playing.popped && <InvertedPlayer url={playing.url} squared />}
        {!playing.popped &&
          chromeHostRef.current &&
          createPortal(
            <TheaterOverlay frame={playing.mode} playbackKey={playing.url} />,
            chromeHostRef.current,
          )}
        {panelOpen &&
          !playing.popped &&
          chromeHostRef.current &&
          createPortal(
            <>
              {/* Click-away backdrop: marked data-interactive so the
                * overlay's click-to-pause skips it (TheaterOverlay only
                * pauses on clicks OUTSIDE [data-interactive]) — a click
                * off the panel closes the panel, nothing else. */}
              <div
                className="vod-panel__backdrop"
                data-interactive
                onClick={() => setPanelOpen(false)}
              />
              <div className="vod-panel" data-interactive>
              <div className="vod-panel__head">
                <h3>Sources</h3>
                <button
                  type="button"
                  className="player__btn player__btn--glass"
                  aria-label="Close sources"
                  onClick={() => setPanelOpen(false)}
                >
                  <CloseIcon size={18} />
                </button>
              </div>
              <div className="vod-panel__list">
                {panelSources === null && (
                  <p className="vod-sources__note">Finding sources…</p>
                )}
                {panelSources === "failed" && (
                  <p className="vod-sources__note">Couldn&rsquo;t load sources.</p>
                )}
                {Array.isArray(panelSources) &&
                  panelSources.map((src) => (
                    <button
                      key={src.id}
                      type="button"
                      className={
                        "vod-source" +
                        (src.streamUrl === playing.url
                          ? " vod-source--current"
                          : "")
                      }
                      onClick={() => pickPanelSource(src, panelSources)}
                    >
                      <span className="vod-source__quality">
                        {src.quality}
                        {src.cached && <span className="vod-source__zap">⚡</span>}
                      </span>
                      <span className="vod-source__lines">
                        {src.lines.slice(0, 2).map((l, i) => (
                          <span key={i}>{l}</span>
                        ))}
                      </span>
                    </button>
                  ))}
              </div>
              </div>
            </>,
            chromeHostRef.current,
          )}
        {/* PORTALED like the player chrome: the app shell has the video
          * hole clipped out of it, so anything rendered in-shell inside
          * the hole region is invisible (the first Up Next render was —
          * mpv's gray idle fill showed through instead). */}
        {upNext &&
          !playing.popped &&
          chromeHostRef.current &&
          createPortal(
            <div className="upnext" data-interactive>
              {/* Wallpaper behind the card: at EOF mpv idles and its gray
                * fill showed through the hole (or, raced, a frozen last
                * frame). The detail page's backdrop art makes it
                * deterministic and worth looking at. */}
              {(upNext.item.backdrop ?? upNext.item.poster) && (
                <img
                  className="upnext__art"
                  src={upNext.item.backdrop ?? upNext.item.poster}
                  alt=""
                  aria-hidden
                />
              )}
              <div className="upnext__scrim" aria-hidden />
              {upNext.episode.still && (
                <img
                  className="upnext__still"
                  src={upNext.episode.still}
                  alt=""
                  aria-hidden
                />
              )}
              <p className="upnext__eyebrow">Up next</p>
              <h2 className="upnext__title">
                S{upNext.season.number} · E{upNext.episode.number} —{" "}
                {upNext.episode.title}
              </h2>
              <p className="upnext__count">Playing in {countdown}s</p>
              <div className="upnext__actions">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void playUpNext()}
                >
                  Play now
                </button>
                <button
                  type="button"
                  className="shero__btn-quiet"
                  onClick={stop}
                >
                  Cancel
                </button>
              </div>
            </div>,
            chromeHostRef.current,
          )}
        {/* Mini Up Next: corner popup while the credits play — content
          * keeps rolling, no countdown, no takeover. Stands down for the
          * fullscreen EOF card and while the source panel is open. */}
        {upNextMini &&
          !upNext &&
          !panelOpen &&
          !playing.popped &&
          chromeHostRef.current &&
          createPortal(
            <div className="upnext-mini" data-interactive>
              {(upNextMini.episode.still ?? upNextMini.item.backdrop) && (
                <img
                  className="upnext-mini__thumb"
                  src={upNextMini.episode.still ?? upNextMini.item.backdrop}
                  alt=""
                  aria-hidden
                />
              )}
              <div className="upnext-mini__body">
                <p className="upnext-mini__eyebrow">Up next</p>
                <p className="upnext-mini__title">
                  S{upNextMini.season.number} · E{upNextMini.episode.number} —{" "}
                  {upNextMini.episode.title}
                </p>
                <div className="upnext-mini__actions">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => {
                      const m = upNextMini;
                      setUpNextMini(null);
                      void playEpisode(m.item, m.season, m.episode);
                    }}
                  >
                    Play now
                  </button>
                </div>
              </div>
              <button
                type="button"
                className="player__btn player__btn--glass upnext-mini__close"
                aria-label="Dismiss"
                onClick={() => {
                  miniDismissedRef.current = upNextMini.episode.id;
                  setUpNextMini(null);
                }}
              >
                <CloseIcon size={14} />
              </button>
            </div>,
            chromeHostRef.current,
          )}
        {playing.popped && (
          <div className="vod-pip">
            {(playing.item.logo ?? playing.item.poster) && (
              <img
                className="vod-pip__logo"
                src={playing.item.logo ?? playing.item.poster}
                alt=""
                aria-hidden
              />
            )}
            <p className="vod-pip__hint">Player popped out</p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void bringBack()}
            >
              Bring It Back
            </button>
            {/* ✕ = done with the pop-out too: close it and land on the
              * source selector (the view under the stage). */}
            <button
              type="button"
              className="player__btn player__btn--glass vod-pip__close"
              aria-label="Close pop-out"
              onClick={() => {
                void tauriPopoutStop().catch(() => {});
                stop();
              }}
            >
              <CloseIcon size={20} />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    // Off home, the detail/episode screens go full-bleed: no scroll-box
    // padding, backdrop to the window edges, under the floating header.
    <div className={"stream" + (view.at === "home" ? "" : " stream--full")}>
      {view.at === "home" && (
        <Home
          load={load}
          onOpen={cardOpen}
          onWatchNow={watchNow}
          watching={watching}
          onClearWatching={(id) => setWatching(clearWatching(id))}
          onOpenWatching={(e) => {
            const item =
              load.status === "ready" ? load.data.items.get(e.id) : undefined;
            void quickResume(e, item);
          }}
          onSourcesWatching={(e) => {
            const item =
              load.status === "ready" ? load.data.items.get(e.id) : undefined;
            if (item) void open(item);
          }}
        />
      )}
      {view.at === "title" && (
        <Detail
          item={view.item}
          onBack={goBack}
          onOpenItem={open}
          onPlaySource={(s, queue) =>
            setPlaying({
              url: s.streamUrl,
              item: view.item,
              bingeGroup: s.bingeGroup,
              queue,
            })
          }
        />
      )}
      {view.at === "episodes" && (
        <Episodes
          item={view.item}
          onBack={goBack}
          onPick={(episodeId, episodeLabel, episodeInfo) =>
            navigate({
              at: "sources",
              item: view.item,
              episodeId,
              episodeLabel,
              episodeInfo,
            })
          }
        />
      )}
      {view.at === "sources" && (
        <Detail
          item={view.item}
          episodeId={view.episodeId}
          episodeLabel={view.episodeLabel}
          onBack={goBack}
          onPlaySource={(s, queue) =>
            setPlaying({
              url: s.streamUrl,
              item: view.item,
              label: view.episodeLabel,
              episodeId: view.episodeId,
              episodeInfo: view.episodeInfo,
              bingeGroup: s.bingeGroup,
              queue,
            })
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Home({
  load,
  onOpen,
  onWatchNow,
  watching,
  onClearWatching,
  onOpenWatching,
  onSourcesWatching,
}: {
  load: Load;
  onOpen: (i: VodItem) => void;
  onWatchNow: (i: VodItem) => void;
  watching: WatchEntry[];
  onClearWatching: (id: string) => void;
  onOpenWatching: (e: WatchEntry) => void;
  onSourcesWatching: (e: WatchEntry) => void;
}) {
  // Which details the cards show — flips live while Settings is open.
  const [metaFields, setMetaFields] = useState<CardMetaField[]>(loadCardMeta);
  useEffect(() => onCardMetaChange(setMetaFields), []);
  if (!loadAioUrl()) {
    return (
      <div className="stream__note">
        <h2>Movies and shows, one tab over from live.</h2>
        <p>
          Paste your AIOStreams manifest URL in Settings → AIOStreams and the
          catalog appears here.
        </p>
      </div>
    );
  }
  if (load.status === "loading")
    return (
      <div className="stream__note stream__note--dim">Loading your catalog…</div>
    );
  if (load.status === "error")
    return (
      <div className="stream__note">
        <h2>Couldn't load your catalog.</h2>
        <p>{load.message}. Check the manifest URL in Settings → AIOStreams.</p>
      </div>
    );
  const { data } = load;
  const featured = data.featured
    .map((id) => data.items.get(id))
    .filter((v): v is VodItem => !!v);
  // Finished movies retire from Continue Watching (display-only filter —
  // the entry survives for resume bookkeeping).
  const activeWatching = watching.filter((e) => !retiredFromContinue(e));
  return (
    <>
      {featured.length > 0 && (
        <Hero items={featured} onOpen={onOpen} onWatchNow={onWatchNow} />
      )}
      <div className="stream__rows">
        {activeWatching.length > 0 && (
          <section className="media-row">
            <h3 className="media-row__title">Continue Watching</h3>
            <RowScroller>
              {activeWatching.map((e) => (
                <ContinueCard
                  key={e.id}
                  entry={e}
                  metaFields={metaFields}
                  onOpen={() => onOpenWatching(e)}
                  onSources={() => onSourcesWatching(e)}
                  onClear={() => onClearWatching(e.id)}
                />
              ))}
            </RowScroller>
          </section>
        )}
        {data.rows.map((row) => (
          <section key={row.id} className="media-row">
            <h3 className="media-row__title">{row.title}</h3>
            <RowScroller>
              {row.itemIds.map((id) => {
                const item = data.items.get(id);
                return item ? (
                  <Card
                    key={id}
                    item={item}
                    metaFields={metaFields}
                    onOpen={onOpen}
                  />
                ) : null;
              })}
            </RowScroller>
          </section>
        ))}
      </div>
    </>
  );
}

/** Horizontal row shell: scroller + edge scrims + hover arrows. Scrims
 * and arrows only exist on a side that actually has hidden content
 * (scroll position tracked; ResizeObserver keeps it honest). Arrows
 * nudge by ~75% of the viewport, smooth. */
export function RowScroller({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [can, setCan] = useState({ left: false, right: false });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCan({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [update]);
  const nudge = (dir: 1 | -1) =>
    ref.current?.scrollBy({
      left: dir * ref.current.clientWidth * 0.75,
      behavior: "smooth",
    });
  // Click-and-drag scrolling: pointer deltas map 1:1 onto scrollLeft (no
  // physics — native feel only). Past a small slop the gesture is a DRAG:
  // capture the pointer and swallow the next click so the card under the
  // cursor doesn't open. Serves every row: Stream home, Continue
  // Watching, and Discover's genre rail all render through here.
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(
    null,
  );
  // Set when a drag ends; the gesture's trailing click (which fires AFTER
  // pointerup) checks-and-clears it in the capture phase, before any
  // card's own onClick can open something.
  const justDragged = useRef(false);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.pointerType !== "mouse") return; // touch scrolls natively
    const el = ref.current;
    if (!el) return;
    justDragged.current = false;
    drag.current = { x: e.clientX, left: el.scrollLeft, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 6) return; // click slop
    if (!d.moved) {
      d.moved = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add("is-dragging");
    }
    el.scrollLeft = d.left - dx;
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = ref.current;
    drag.current = null;
    if (!d?.moved || !el) return;
    justDragged.current = true;
    // Self-heal: if the trailing click never arrives (capture-release
    // edge cases), don't leave the latch armed to eat a later real click.
    window.setTimeout(() => {
      justDragged.current = false;
    }, 250);
    el.releasePointerCapture(e.pointerId);
    el.classList.remove("is-dragging");
  };
  const swallowDragClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!justDragged.current) return;
    justDragged.current = false;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div className="media-row__viewport">
      <div
        className="media-row__scroller"
        ref={ref}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={swallowDragClick}
      >
        {children}
      </div>
      <div
        className={"media-row__scrim media-row__scrim--left" + (can.left ? " is-on" : "")}
        aria-hidden
      />
      <div
        className={"media-row__scrim media-row__scrim--right" + (can.right ? " is-on" : "")}
        aria-hidden
      />
      {can.left && (
        <button
          type="button"
          className="media-row__arrow media-row__arrow--left"
          aria-label="Scroll back"
          onClick={() => nudge(-1)}
        >
          <ChevronIcon />
        </button>
      )}
      {can.right && (
        <button
          type="button"
          className="media-row__arrow media-row__arrow--right"
          aria-label="Scroll forward"
          onClick={() => nudge(1)}
        >
          <ChevronIcon />
        </button>
      )}
    </div>
  );
}

/** The Figma hero (133-721): a ~90vh sliding carousel that never rewinds.
 * The index is VIRTUAL (unbounded, forward-only on auto-advance); slides
 * are a moving window of absolute-positioned cards, each showing
 * items[slot mod n] — so wrapping from the 9th back to the 1st is just one
 * more slide to the right, forever. Hovering the section pauses the
 * auto-advance; the active card wears the Figma glow; neighbors stay at
 * full strength and click-slide. */
const HERO_GAP = 30;
function heroMargin(w: number): number {
  // Side inset ≈ 15% of the window, clamped sane — the card is ~15%
  // thinner than full-bleed and the neighbors fill the reveal.
  return Math.min(320, Math.max(200, w * 0.15));
}
function Hero({
  items,
  onOpen,
  onWatchNow,
}: {
  items: VodItem[];
  onOpen: (i: VodItem) => void;
  onWatchNow: (i: VodItem) => void;
}) {
  const [v, setV] = useState(0); // virtual index — never wraps
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const count = items.length;
  // Layout effect: measured BEFORE first paint, so no width-0 frame exists.
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Track transitions stay OFF until a frame has painted at the measured
  // geometry — otherwise entering the tab animates the 650ms slide from
  // the width-0 layout ("the slider moves in a bit"). Same guard snaps
  // (not glides) the tracks on window resizes.
  const [animReady, setAnimReady] = useState(false);
  const lastW = useRef(width);
  if (lastW.current !== width) {
    lastW.current = width;
    if (animReady) setAnimReady(false);
  }
  useEffect(() => {
    if (animReady || width === 0) return;
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => setAnimReady(true)),
    );
    return () => cancelAnimationFrame(id);
  }, [animReady, width]);
  useEffect(() => {
    if (hovered || count < 2) return;
    const id = window.setInterval(() => setV((x) => x + 1), 8000);
    return () => window.clearInterval(id);
  }, [hovered, count]);

  const m = heroMargin(width);
  const cardW = Math.max(0, width - 2 * m);
  const step = cardW + HERO_GAP;

  // Window of live slots around the current one: both neighbors visible,
  // one extra each side so a slide-in mounts before it enters the frame.
  // One extra slot AHEAD of the window: the next-next card mounts and
  // decodes ~8s before it ever enters the frame, so a slide never pays
  // an image decode mid-animation.
  const slots = [v - 2, v - 1, v, v + 1, v + 2, v + 3];
  return (
    <div
      className="shero"
      ref={hostRef}
      role="region"
      aria-label="Featured"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Adam's shadow slider: the same carousel again, blurred, masked
        * to the stationary (android-style) box behind the center slot.
        * The box never moves — the blurred art sliding through it IS the
        * ambient light reacting to the cards, in exact lockstep (same
        * geometry, same transition). The inner track's offset subtracts
        * the box's own left so both tracks align in screen space. */}
      <div
        className="shero__glowbox"
        aria-hidden
        style={{ left: m - 210, width: cardW + 420 }}
      >
        <div
          className="shero__glowtrack"
          style={{
            transform: `translateX(${210 - v * step}px)`,
            transition: animReady ? undefined : "none",
          }}
        >
          {slots.map((slot) => {
            const item = items[((slot % count) + count) % count];
            const art = item?.backdrop ?? item?.poster;
            return art ? (
              <img
                key={slot}
                className={slot === v ? "shero__glow--lit" : undefined}
                src={art}
                alt=""
                decoding="async"
                style={{ left: slot * step, width: cardW }}
              />
            ) : null;
          })}
        </div>
      </div>
      <div
        className="shero__track"
        style={{
          transform: `translateX(${m - v * step}px)`,
          transition: animReady ? undefined : "none",
        }}
      >
        {slots.map((slot) => {
          const item = items[((slot % count) + count) % count];
          if (!item) return null;
          const active = slot === v;
          return (
            <div
              key={slot}
              role="button"
              tabIndex={active ? 0 : -1}
              onKeyDown={(e) => {
                if (active && (e.key === "Enter" || e.key === " ")) onOpen(item);
              }}
              className={"shero__card" + (active ? " shero__card--active" : "")}
              style={{ left: slot * step, width: cardW }}
              // Whole-card click: neighbors slide into place; the ACTIVE
              // card opens the title's source-selection screen (the
              // buttons stopPropagation, so Watch Now stays instant-play).
              onClick={() => (active ? onOpen(item) : setV(slot))}
            >
              {(item.backdrop ?? item.poster) && (
                <img
                  className="shero__art"
                  src={item.backdrop ?? item.poster}
                  alt=""
                  decoding="async"
                />
              )}
              <div className="shero__scrim" aria-hidden />
              <div className="shero__text">
                {item.logo ? (
                  <img
                    className="shero__logo"
                    src={item.logo}
                    alt={item.title}
                  />
                ) : (
                  <h2 className="shero__title">{item.title}</h2>
                )}
                {item.synopsis && (
                  <p className="shero__synopsis">{item.synopsis}</p>
                )}
                <p className="shero__meta">
                  {[
                    item.year,
                    item.runtimeMin ? `${item.runtimeMin} min` : null,
                    item.kind === "series" ? "Series" : "Movie",
                  ]
                    .filter(Boolean)
                    .join("   ")}
                  {item.rating ? (
                    <span className="shero__rating">
                      {" "}
                      ★ {item.rating.toFixed(1)}/10
                    </span>
                  ) : null}
                </p>
                <div className="shero__actions">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onWatchNow(item);
                    }}
                  >
                    Watch Now
                  </button>
                  <button
                    type="button"
                    className="shero__btn-quiet"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(item);
                    }}
                  >
                    More Info
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Card({
  item,
  metaFields,
  onOpen,
}: {
  item: VodItem;
  metaFields: CardMetaField[];
  onOpen: (i: VodItem) => void;
}) {
  // Real catalogs carry poster URLs of wildly varying health — a broken
  // one falls back to the lettermark like a missing one does, instead of
  // the browser's broken-image box (same pattern as the guide's logos).
  const [broken, setBroken] = useState(false);
  // Enrichment can swap a dead preview poster for a working full-meta
  // one under the same item id — give the new URL a chance.
  useEffect(() => setBroken(false), [item.poster]);
  const meta = cardMetaLine(metaFields, {
    rating: item.rating,
    year: item.year,
    runtimeMin: item.runtimeMin,
    genre: item.genres[0],
    kind: item.kind,
  });
  return (
    <button type="button" className="stream-card" onClick={() => onOpen(item)}>
      {item.poster && !broken ? (
        <img
          className="stream-card__poster"
          src={item.poster}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="stream-card__mono">{item.title.slice(0, 1)}</span>
      )}
      <span className="stream-card__name">{item.title}</span>
      {meta && <span className="stream-card__meta">{meta}</span>}
    </button>
  );
}

/** Continue Watching card: landscape art, meta line, HOLD to clear (the
 * Figma interaction — a click opens, a ~1s press-and-hold removes). */
function ContinueCard({
  entry,
  metaFields,
  onOpen,
  onSources,
  onClear,
}: {
  entry: WatchEntry;
  metaFields: CardMetaField[];
  onOpen: () => void;
  onSources: () => void;
  onClear: () => void;
}) {
  const meta = cardMetaLine(metaFields, {
    rating: entry.rating,
    year: entry.year,
    runtimeMin: entry.runtimeMin,
    genre: entry.genre,
    kind: entry.kind,
  });
  // "42m left" from the progress clocks — only while genuinely mid-way
  // (finished movies retire from the row entirely; see Home's filter).
  const leftMin =
    entry.posSec && entry.durSec && entry.posSec < entry.durSec * 0.9
      ? Math.max(1, Math.round((entry.durSec - entry.posSec) / 60))
      : null;
  const metaLine = [meta, leftMin != null ? `${leftMin}m left` : null]
    .filter(Boolean)
    .join(" · ");
  const [holding, setHolding] = useState(false);
  const timer = useRef(0);
  const held = useRef(false);
  const start = () => {
    held.current = false;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      held.current = true;
      setHolding(false);
      onClear();
    }, 1000);
  };
  const cancel = () => {
    window.clearTimeout(timer.current);
    setHolding(false);
  };
  return (
    // div+role, not <button>: the Sources chip nests a real button inside.
    <div
      role="button"
      tabIndex={0}
      className={"continue-card" + (holding ? " continue-card--holding" : "")}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onClick={() => {
        if (!held.current) onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen();
      }}
    >
      <span className="continue-card__artwrap">
        {entry.art ? (
          <img className="continue-card__art" src={entry.art} alt="" loading="lazy" draggable={false} />
        ) : (
          <span className="continue-card__art continue-card__art--empty" />
        )}
        {/* Clearlogo over the art, lower-middle — sits UNDER the hover
          * play cue (which is dead center), never fighting it. */}
        {entry.logo && (
          <img
            className="continue-card__logo"
            src={entry.logo}
            alt=""
            aria-hidden
            loading="lazy"
            draggable={false}
          />
        )}
        <span className="continue-card__cue" aria-hidden>
          <PlayIcon size={36} />
        </span>
        {entry.posSec && entry.durSec ? (
          <span className="continue-card__progress" aria-hidden>
            <span
              style={{
                width: `${Math.min(100, (entry.posSec / entry.durSec) * 100)}%`,
              }}
            />
          </span>
        ) : null}
        {/* Straight to the source screen instead of quick-resume. */}
        <button
          type="button"
          className="continue-card__sources"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onSources();
          }}
        >
          Sources ›
        </button>
      </span>
      <span className="continue-card__hold" aria-hidden>
        Keep holding to clear
      </span>
      <span className="stream-card__name">{entry.title}</span>
      {metaLine && <span className="stream-card__meta">{metaLine}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** One Discover-config resolve per session for the More Like This rows
 * (loadDiscover refetches the manifest otherwise); failures clear the
 * memo so a later detail visit can retry. */
let discoverCfgPromise: Promise<DiscoverConfig> | null = null;
const discoverCfg = (): Promise<DiscoverConfig> =>
  (discoverCfgPromise ??= loadDiscover().catch((e) => {
    discoverCfgPromise = null;
    throw e;
  }));

/** "+ My List" / "✓ My List" toggle on the detail screens — feeds the
 * Stream section's My List grid. Re-reads per mount; state is local
 * (the grid re-reads storage when IT mounts). */
function SaveButton({ item }: { item: VodItem }) {
  const [saved, setSaved] = useState(() => inMyList(item.id));
  return (
    <button
      type="button"
      className={"vod-save" + (saved ? " vod-save--on" : "")}
      onClick={() => setSaved(toggleMyList(item))}
    >
      {saved ? <CheckIcon size={15} /> : <span aria-hidden>+</span>} My List
    </button>
  );
}

// ---------------------------------------------------------------------------

/** Detail page: backdrop + info left, the addon's pre-ranked sources right.
 * For an episode, `episodeId` scopes the source resolve. Sources re-resolve
 * on every open — debrid links can be short-lived. */
function Detail({
  item,
  episodeId,
  episodeLabel,
  onBack,
  onPlaySource,
  onOpenItem,
}: {
  item: VodItem;
  episodeId?: string;
  episodeLabel?: string;
  onBack: () => void;
  onPlaySource: (s: StreamSource, queue: StreamSource[]) => void;
  /** Enables the More Like This strip (movie detail only). */
  onOpenItem?: (i: VodItem) => void;
}) {
  const [sources, setSources] = useState<StreamSource[] | null | "failed">(
    null,
  );
  // More Like This: first-genre neighbors from the user's own catalogs
  // (Discover's conglomerate machinery), current title excluded. Movie
  // detail only — the episode source screen stays utilitarian. Pure
  // garnish: any failure just means no row.
  const [more, setMore] = useState<VodItem[]>([]);
  const moreGenre = item.genres[0];
  useEffect(() => {
    setMore([]);
    if (episodeId || !onOpenItem || !moreGenre) return;
    let stale = false;
    (async () => {
      try {
        const cfg = await discoverCfg();
        const cats = gridCatalogs(cfg.catalogs, item.kind, moreGenre).slice(
          0,
          2,
        );
        if (cats.length === 0) return;
        const pages = await Promise.all(
          cats.map((c) =>
            fetchDiscoverPage(cfg, c, moreGenre, 0).catch(() => []),
          ),
        );
        const seen = new Set([item.id]);
        const picks: VodItem[] = [];
        for (const v of interleave(...pages)) {
          if (seen.has(v.id) || !v.poster) continue;
          seen.add(v.id);
          picks.push(v);
          if (picks.length >= 12) break;
        }
        if (!stale) setMore(picks);
      } catch {
        /* no row */
      }
    })();
    return () => {
      stale = true;
    };
  }, [item.id, item.kind, moreGenre, episodeId, onOpenItem]);
  useEffect(() => {
    let stale = false;
    setSources(null);
    resolveVodSources(item.kind, episodeId ?? item.id).then(
      (s) => !stale && setSources(s),
      () => !stale && setSources("failed"),
    );
    return () => {
      stale = true;
    };
  }, [item.kind, item.id, episodeId]);

  return (
    <div className="vod-detail">
      {item.backdrop && (
        <img className="vod-detail__backdrop" src={item.backdrop} alt="" />
      )}
      <div className="vod-detail__scrim" aria-hidden />
      <div className="vod-detail__body">
        <div className="vod-detail__info">
          <button type="button" className="vod-back" onClick={onBack}>
            ← Back
          </button>
          {item.logo ? (
            <img className="vod-detail__logo" src={item.logo} alt={item.title} />
          ) : (
            <h2 className="vod-detail__title">{item.title}</h2>
          )}
          {episodeLabel && <p className="vod-detail__episode">{episodeLabel}</p>}
          <p className="vod-detail__meta">
            {[
              item.year,
              item.runtimeMin ? `${item.runtimeMin} min` : null,
              item.rating ? `★ ${item.rating.toFixed(1)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {item.cast.length > 0 && (
            <p className="vod-detail__castline">
              With {item.cast.slice(0, 6).join(", ")}
            </p>
          )}
          {item.synopsis && (
            <p className="vod-detail__synopsis">{item.synopsis}</p>
          )}
          <SaveButton item={item} />
          {item.genres.length > 0 && (
            <div className="vod-detail__pills">
              {item.genres.slice(0, 5).map((g) => (
                <span key={g}>{g}</span>
              ))}
            </div>
          )}
          {more.length > 0 && (
            <div className="vod-more">
              <h4 className="vod-more__title">More Like This</h4>
              <div className="vod-more__row">
                {more.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className="vod-more__card"
                    title={v.title}
                    onClick={() => onOpenItem?.(v)}
                  >
                    <img
                      src={v.poster}
                      alt={v.title}
                      loading="lazy"
                      draggable={false}
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="vod-sources">
          <h3>Sources</h3>
          {sources === null && (
            <p className="vod-sources__note">Finding sources…</p>
          )}
          {sources === "failed" && (
            <p className="vod-sources__note">Couldn't load sources.</p>
          )}
          {Array.isArray(sources) && sources.length === 0 && (
            <p className="vod-sources__note">No sources available.</p>
          )}
          {Array.isArray(sources) &&
            sources.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className="vod-source"
                onClick={() => onPlaySource(s, sources.slice(i + 1))}
              >
                <span className="vod-source__quality">
                  {s.quality}
                  {s.cached && <span className="vod-source__zap">⚡</span>}
                </span>
                <span className="vod-source__lines">
                  {s.lines.slice(0, 3).map((l, i) => (
                    <span key={i}>{l}</span>
                  ))}
                </span>
                <PlayIcon className="vod-source__play" />
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Episodes({
  item,
  onBack,
  onPick,
}: {
  item: VodItem;
  onBack: () => void;
  onPick: (
    episodeId: string,
    label: string,
    info: { season: number; episode: number; title: string },
  ) => void;
}) {
  // Watched ledger (checkmarks). Re-read per mount — playback marks land
  // between visits to this screen.
  const watched = useMemo(() => loadWatched(item.id), [item.id]);
  // Next up: the episode after the last one watched/played (the CW entry
  // knows exactly where you are; the ledger covers checkmark-only state).
  const nextUp = useMemo(() => {
    const entry = loadWatching().find((w) => w.id === item.id);
    const finished =
      !!entry?.posSec && !!entry?.durSec && entry.posSec >= entry.durSec * 0.9;
    return nextUpEpisode(
      item.seasons,
      watched,
      entry ? { episodeId: entry.episodeId, finished } : undefined,
    );
  }, [item, watched]);
  // Smart resume: open on the season you're actually in, not Season 1.
  const [seasonIdx, setSeasonIdx] = useState(() => {
    if (!nextUp) return 0;
    const idx = item.seasons.findIndex((se) =>
      se.episodes.some((e) => e.id === nextUp),
    );
    return idx >= 0 ? idx : 0;
  });
  const season =
    item.seasons[Math.min(seasonIdx, Math.max(0, item.seasons.length - 1))];
  return (
    <div className="vod-detail">
      {item.backdrop && (
        <img className="vod-detail__backdrop" src={item.backdrop} alt="" />
      )}
      <div className="vod-detail__scrim" aria-hidden />
      <div className="vod-detail__body vod-detail__body--episodes">
        <div className="vod-detail__info">
          <button type="button" className="vod-back" onClick={onBack}>
            ← Back
          </button>
          {item.logo ? (
            <img className="vod-detail__logo" src={item.logo} alt={item.title} />
          ) : (
            <h2 className="vod-detail__title">{item.title}</h2>
          )}
          {item.synopsis && (
            <p className="vod-detail__synopsis">{item.synopsis}</p>
          )}
          {item.cast.length > 0 && (
            <p className="vod-detail__castline">
              With {item.cast.slice(0, 6).join(", ")}
            </p>
          )}
          <SaveButton item={item} />
        </div>
        {item.seasons.length === 0 ? (
          <p className="vod-sources__note">Loading episodes…</p>
        ) : (
          <>
            <div className="season-bar">
              {item.seasons.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  className={
                    "season-chip" + (i === seasonIdx ? " season-chip--on" : "")
                  }
                  onClick={() => setSeasonIdx(i)}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <div className="episode-grid">
              {season?.episodes.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className={
                    "episode-card" +
                    (e.id === nextUp ? " episode-card--next" : "")
                  }
                  onClick={() =>
                    onPick(e.id, `S${season.number} · E${e.number} — ${e.title}`, {
                      season: season.number,
                      episode: e.number,
                      title: e.title,
                    })
                  }
                >
                  {e.still && (
                    <span className="episode-card__thumb">
                      <img src={e.still} alt="" loading="lazy" />
                      <span className="episode-card__cue" aria-hidden>
                        <PlayIcon size={36} />
                      </span>
                      {watched.has(e.id) && (
                        <span className="episode-card__seen" title="Watched">
                          <CheckIcon size={13} />
                        </span>
                      )}
                    </span>
                  )}
                  <span className="episode-card__text">
                    <span className="episode-card__num">E{e.number}</span>
                    <span className="episode-card__title">{e.title}</span>
                  </span>
                  {e.airDate && (
                    <span className="episode-card__date">{e.airDate}</span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { MultiviewGrid, type GridStream } from "./MultiviewGrid";
import { MultiviewPicker, type PickerMode } from "./MultiviewPicker";
import {
  loadGrid,
  loadLayoutKinds,
  loadMvVolume,
  loadSplits,
  saveGrid,
  saveLayoutKinds,
  saveMvVolume,
  saveSplits,
  type MvVolume,
} from "./multiviewAck";
import { onAddRequest, peekLiveGames, takeAddRequest } from "./multiviewEntry";
import { gameLabel, liveWithChannels, useGamesToday } from "./mvGames";
import { isFixture, type Fixture } from "../sports/model";
import { defaultKind, kindsFor, type MvKind } from "./mvLayout";
import {
  addPick,
  arrive,
  cellsFor,
  channelIndex,
  countKey,
  fullReason,
  gameOver,
  goneFrom,
  lineFor,
  meterLine,
  removePick,
  replacePick,
  roomOn,
  settledOn,
  swapToFront,
  type Pick,
} from "./mvGrid";
import { forMultiview } from "./mvKeys";
import { useConnections } from "./connections";
import { loadPlaylists } from "../settings/playlists";
import { resolveStreamUrl } from "./stream";
import { useLiveData } from "./useLiveData";
import { loadRecents, recordRecent } from "./recents";
import { tunedChannel } from "../sports/catalog";
import {
  isTauri,
  stopLivePopout,
  tauriIsFullscreen,
  tauriMvConvertWarm,
  tauriSetFullscreen,
} from "../../lib/tauri";
import { HEVC_MIME } from "./mvTile";
import { hasRoom, passGate } from "./mvRecover";
import {
  ExitFullscreenIcon,
  FocusLayoutIcon,
  FullscreenIcon,
  GridLayoutIcon,
  MuteIcon,
  PlusIcon,
  VolumeIcon,
} from "../../ui/icons";
import { Hint } from "../../ui/Hint";

/**
 * THE MULTI-VIEW TAB (plan 017): several streams at once, as a place you
 * go rather than a panel inside Sports.
 *
 * It behaves like the player. The page is black, and the app header becomes
 * multi-view's own bar: the nav capsule stays in its centre, where it always
 * sits, so leaving works the way it does from every other tab; the clock
 * and Settings step aside, and this tab's controls take the two flanks. The
 * bar, capsule and all, dims after two seconds without the pointer and
 * comes back on the first movement. The stage starts under the bar, so the
 * bar covers black, never a picture.
 *
 * LEAVING STOPS EVERY TILE. The tab unmounts with the nav, the tiles go
 * with it, and each hands its provider connection back (mvproxy.rs drops
 * the upstream when the loopback reader goes, proven in v0.9.101). The
 * Guide or the player you go to next then has the line to itself.
 *
 * PICKING (P3). The count follows the channels (M8): Add, the empty place
 * or A opens the picker, a tile's X closes it, Replace swaps it in place.
 * The line's limit is the ceiling, shown on the meter, and the grid is
 * remembered across launches (M7).
 *
 * A TILE TAKES ANY CHANNEL, not only a live game, and that is a correction
 * rather than a feature. The first build filled tiles from live fixtures
 * alone, which Adam found unusable on the first evening he tried it: "i
 * cant multi anything, there's only 1 game live rn". So games are the
 * SHORTCUT, not the source, and either way a pick resolves to a channel id.
 */

/** How long the pointer has to rest before the bar goes (plan 017). */
const IDLE_MS = 2000;

/**
 * Idle after IDLE_MS without the pointer or a key, but never while the
 * pointer rests on the bar or the capsule, keyboard focus is in them, or
 * the picker is open: a bar that dims under your hand reads as one about
 * to go away.
 *
 * Checked when the timer fires rather than tracked with enter/leave: the
 * header's children take the pointer while the header itself does not, and
 * `:hover` already knows the answer for every case at the moment it matters.
 */
function useIdle(): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let t = 0;
    const arm = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const busy = document.querySelector(
          ".header:hover, .mvbar:hover, .header :focus-visible, .mvbar :focus-visible, [data-slot='dialog-content']",
        );
        if (busy) arm();
        else setIdle(true);
      }, IDLE_MS);
    };
    const wake = () => {
      setIdle(false);
      arm();
    };
    arm();
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    // The wheel too: turning the volume over a tile should show the slider.
    window.addEventListener("wheel", wake, { passive: true });
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
      window.removeEventListener("wheel", wake);
    };
  }, []);
  return idle;
}

/** How long the window holds still before full screen is asked again. */
const RESIZE_SETTLE_MS = 150;

/**
 * Whether the WINDOW is full screen, and a way to flip it.
 *
 * The window is the truth, not a flag of ours: Escape exits full screen at
 * app level (App.tsx) and the window-state plugin restores it across
 * launches, so this re-asks after every resize. Full screen this tab turned
 * on is turned off again when you leave it; one it found already on is left
 * alone.
 */
function useWindowFullscreen(): [boolean, () => void] {
  const [full, setFull] = useState(false);
  const ours = useRef(false);
  useEffect(() => {
    const sync = () => {
      if (isTauri()) void tauriIsFullscreen().then(setFull).catch(() => {});
      else setFull(document.fullscreenElement != null);
    };
    sync();
    // Asked once the window has settled, not on every resize event: a drag
    // fires about 60 a second, each an IPC call (plan 018, P7). Going full
    // screen is one resize, so the switch follows 150ms later.
    let settle = 0;
    const onResize = () => {
      window.clearTimeout(settle);
      settle = window.setTimeout(sync, RESIZE_SETTLE_MS);
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("fullscreenchange", sync);
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("fullscreenchange", sync);
      if (!ours.current) return;
      if (isTauri()) void tauriSetFullscreen(false).catch(() => {});
      else if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);
  const toggle = useCallback(() => {
    if (isTauri()) {
      void (async () => {
        const now = await tauriIsFullscreen().catch(() => false);
        await tauriSetFullscreen(!now).catch(() => {});
        ours.current = !now;
        setFull(!now);
      })();
      return;
    }
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else {
      ours.current = true;
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);
  return [full, toggle];
}

/**
 * Whether the bar's left side has to drop its words to clear the capsule.
 *
 * The capsule is centred on its MARK, not on itself, and on this tab the
 * open "Multi-view" label sits in its left half, so its left edge is about
 * 291px short of the midline at 100% scale. The side with words is 293px.
 * Below a window of roughly 1260 they would meet, and the window goes down
 * to 1000. The number moves with the UI scale and the font, so it is
 * measured rather than written into a media query.
 */
function useCompactSide(
  ref: RefObject<HTMLElement | null>,
  edge: "left" | "right" = "left",
): boolean {
  const [compact, setCompact] = useState(false);
  // The side's width WITH its words, from the last time they showed. Once
  // they are gone, its own width no longer says whether they would fit.
  const full = useRef(0);
  useLayoutEffect(() => {
    const side = ref.current;
    const cap = document.querySelector<HTMLElement>(".navcap");
    if (!side || !cap) return;
    const fit = () => {
      const s = side.getBoundingClientRect();
      if (!side.classList.contains("is-compact")) full.current = s.width;
      const c = cap.getBoundingClientRect();
      const room = edge === "left" ? c.left - s.left - 16 : s.right - c.right - 16;
      setCompact(full.current > room);
    };
    fit();
    // The window, the capsule's size, and the capsule settling after the
    // nav moved (it travels on margin-left, which no observer sees).
    const ro = new ResizeObserver(fit);
    ro.observe(cap);
    ro.observe(side);
    window.addEventListener("resize", fit);
    cap.addEventListener("transitionend", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
      cap.removeEventListener("transitionend", fit);
    };
  }, [ref, edge]);
  return compact;
}


/**
 * How long a channel sent from elsewhere waits for the line's answer before
 * joining on what is known. The panel usually answers in well under a
 * second; without one there is no limit to count against, only four.
 */
const LINE_WAIT_MS = 3000;

export function MultiviewTab() {
  /** The catalog: loaded here if nothing has yet, and followed after, so
   * the picker works however this tab was reached (useLiveData). */
  const live = useLiveData();

  // HEVC tiles are converted natively (mvconvert.rs), after one look at what
  // this machine can do. Taken now, so the first HEVC tile doesn't wait for
  // it: on Adam's it did, and a tile never catches up the time it waited.
  useEffect(() => {
    if (isTauri() && !MediaSource.isTypeSupported(HEVC_MIME))
      void tauriMvConvertWarm().catch(() => {});
  }, []);

  // A live popout holds one of the line's connections, so it stops as the
  // tab opens (plan 017, F10), the way the Guide's player stops by
  // unmounting. The grid needs every connection the line has.
  useEffect(() => {
    if (isTauri()) stopLivePopout();
  }, []);

  // The grid, as it was left (M7).
  const [saved] = useState(loadGrid);
  const [picks, setPicks] = useState<Pick[]>(saved.picks);
  const [soundId, setSoundId] = useState<string | null>(saved.sound);
  useEffect(() => saveGrid({ picks, sound: soundId }), [picks, soundId]);

  // A remembered channel that has left the catalog is dropped quietly, once
  // the catalog is here to say so. ITS OWN PLAYLIST's catalog: one that
  // failed to load (a slow panel, a refresh that timed out) says nothing
  // about its channels, and its tiles used to be dropped and the smaller
  // grid saved, mid-game (plan 018, L5). The sound goes with a tile that
  // goes, so the channel coming back later doesn't find it waiting.
  useEffect(() => {
    if (!live) return;
    const loaded = live.groups.filter((g) => !g.error).map((g) => g.id);
    const known = channelIndex(live);
    const gone = (id: string) => goneFrom(loaded, id, (c) => known.has(c));
    setPicks((was) => (was.some((p) => gone(p.channelId)) ? was.filter((p) => !gone(p.channelId)) : was));
    setSoundId((s) => (s !== null && gone(s) ? null : s));
  }, [live]);

  /**
   * The line: its limit, what it reports in use, and so what is left.
   *
   * ONLY WHEN ONE PLAYLIST ANSWERS, AND EVERY TILE IS ON IT: with several,
   * or with tiles from another source (an M3U beside an Xtream line), no
   * single cap describes the grid, and guessing wrong in either direction
   * is worse than offering up to four and letting a tile say it was
   * refused. It used to be "one Xtream line answered", so a line of one
   * stream capped an M3U beside it too (plan 018, L4).
   *
   * Keyed on the grid's channels so the count is asked again after every
   * change, then again once the panel has caught up. The SET of them, not
   * their order: making a small tile big in Focus reorders the grid without
   * changing a connection, and restarted the count, opening a window where
   * a full line offered Add (plan 018, L2).
   */
  const key = countKey(picks);
  /** Tiles waiting on the gate for a free slot: the panel is asked every
   * few seconds while any is (plan 018, H1). */
  const [waitingRoom, setWaitingRoom] = useState(0);
  const conns = useConnections(key || null, waitingRoom > 0);
  const line = lineFor(conns, picks);
  // When the grid's channels last changed. Set as the render sees the new
  // key, not in an effect after it, so no render believes a reading taken
  // before the change against the new grid.
  const changed = useRef({ key, at: Date.now() });
  if (changed.current.key !== key) changed.current = { key, at: Date.now() };
  const settled = settledOn(line, changed.current.at);
  const room = roomOn(line, picks.length, settled);
  const roomRef = useRef(room);
  roomRef.current = room;

  /**
   * A channel sent from the Guide or the player (plan 017, P6b), held until
   * the line has answered: whether it fits is the line's to say, and the
   * panel is asked as the tab opens. Taken from the mailbox as the tab
   * mounts (App flipped here to deliver it), or as it arrives.
   */
  const [incoming, setIncoming] = useState<Pick | null>(null);
  useEffect(() => {
    const take = () => {
      const p = takeAddRequest();
      if (p) setIncoming(p);
    };
    take();
    return onAddRequest(take);
  }, []);
  const [xtream] = useState(() => loadPlaylists().some((p) => p.kind === "xtream" && p.enabled));
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (!incoming) return;
    const t = window.setTimeout(() => setWaited(true), LINE_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [incoming]);
  // One line that answered, several (no single cap, as `line` says), no
  // panel to ask, or the wait is over.
  const lineKnown = line !== null || conns.size > 1 || !xtream || waited;
  /** A channel waiting for you to pick the tile it replaces: the grid was
   * full when it came. */
  const [choosing, setChoosing] = useState<Pick | null>(null);
  const cells = cellsFor(picks.length);

  const [kinds, setKinds] = useState(loadLayoutKinds);
  const kind: MvKind = kinds[cells] ?? defaultKind(picks.length);
  const chooseKind = (k: MvKind) => {
    const next = { ...kinds, [cells]: k };
    saveLayoutKinds(next);
    setKinds(next);
  };

  // Where Focus's seam sits, per count; none means the natural split
  // (multiviewAck.loadSplits). The grid says where a drag or a key left it.
  const [splits, setSplits] = useState(loadSplits);
  const chooseSplit = (s: number | null) => {
    const next = { ...splits };
    if (s === null) delete next[cells];
    else next[cells] = s;
    saveSplits(next);
    setSplits(next);
  };

  // In Focus the sound tile is the big one (decision M2): choosing a small
  // tile swaps it in, and switching to Focus brings the sound tile up.
  // Before paint, so the big spot never shows the wrong tile for a frame.
  useLayoutEffect(() => {
    if (kind !== "focus" || !soundId) return;
    setPicks((was) => swapToFront(was, soundId));
  }, [kind, soundId]);

  // The sound tile's volume and mute, kept between visits (plan 017, "Sound
  // and volume"). Saved as it moves: a slider steps 20 times end to end.
  const [vol, setVol] = useState<MvVolume>(loadMvVolume);
  useEffect(() => saveMvVolume(vol), [vol]);
  const toggleMute = () => setVol((v) => ({ ...v, muted: !v.muted }));
  // ↑ and ↓ step it as the main player's do, and up also unmutes.
  const nudge = (d: number) =>
    setVol((v) => ({
      volume: Math.min(1, Math.max(0, +(v.volume + d).toFixed(2))),
      muted: d > 0 ? false : v.muted,
    }));

  /**
   * Each channel's stream URL, looked up once (audit F12).
   *
   * The lookup used to be an effect that cancelled its own in-flight
   * lookups whenever one finished, and dropped a channel whose lookup came
   * back empty, which then held a slot nobody could see. Now a lookup runs
   * to the end, its answer is kept, and an empty answer is a tile that says
   * so and can try again. Null means looked up and found nothing.
   */
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const looking = useRef(new Set<string>());
  useEffect(() => {
    for (const p of picks) {
      const id = p.channelId;
      if (id in urls || looking.current.has(id)) continue;
      const real = live ? channelIndex(live).get(id) : undefined;
      // Not in the catalog yet: wait for it (the effect above drops the
      // pick if it never turns up).
      if (!real) continue;
      looking.current.add(id);
      void resolveStreamUrl(real)
        .then(
          (url) => setUrls((was) => ({ ...was, [id]: url })),
          () => setUrls((was) => ({ ...was, [id]: null })),
        )
        .finally(() => looking.current.delete(id));
    }
  }, [picks, urls, live]);
  const retryResolve = (id: string) =>
    setUrls((was) => {
      const next = { ...was };
      delete next[id];
      return next;
    });

  /** The gate a tile passes before it connects again (mvRecover.passGate):
   * a free slot on the line, its turn, a fresh link. */
  const lineRef = useRef(line);
  lineRef.current = line;
  const turn = useRef({ last: 0 });
  const gate = useCallback(
    (id: string, waiting: (on: boolean) => void) =>
      passGate({
        room: () => hasRoom(lineRef.current),
        waiting: (on) => {
          setWaitingRoom((n) => n + (on ? 1 : -1));
          waiting(on);
        },
        sleep: (ms) => new Promise((r) => window.setTimeout(r, ms)),
        now: () => performance.now(),
        turn: turn.current,
        // Every kind is looked up again; for most it is the same URL.
        fresh: () =>
          setUrls((was) => {
            if (!(id in was)) return was;
            const next = { ...was };
            delete next[id];
            return next;
          }),
      }),
    [],
  );

  const [picker, setPicker] = useState<PickerMode | null>(null);

  /**
   * Today's games, asked for only while something here needs them: the
   * picker is open, or a tile is a game (its score). Until the first answer
   * lands, the picker shows what the Sports board last saw, which is
   * instant and at most half an hour old (multiviewEntry).
   */
  const gameLeagues = picks.flatMap((p) => (p.gameId && p.league ? [p.league] : []));
  const today = useGamesToday(
    picker !== null || gameLeagues.length > 0,
    gameLeagues,
    picker !== null,
  );
  const [snapshot] = useState(peekLiveGames);
  // One list per answer, not per render: it is the picker's input, and a new
  // array every render re-ran the picker's whole memo (plan 018, P3).
  const liveGames = useMemo(
    () => (today.listed ? liveWithChannels(today.games) : snapshot),
    [today.listed, today.games, snapshot],
  );
  const fixtures = new Map(
    today.games.filter(isFixture).map((g) => [g.id, g] as const),
  );

  // A game tile goes back to being its channel once its game is over: half
  // an hour after the board first called it final, or 12 hours after it
  // started. A tile from before `start` was kept goes when a look at the
  // board no longer has its game. It used to say "Buffalo at Kansas City"
  // the next day, and keep ESPN asked every 90 seconds (plan 018, L9).
  const finalSeen = useRef(new Map<string, number>());
  useEffect(() => {
    const now = Date.now();
    const onBoard = new Map(today.games.filter(isFixture).map((g) => [g.id, g] as const));
    for (const g of onBoard.values())
      if (g.state === "final" && !finalSeen.current.has(g.id)) finalSeen.current.set(g.id, now);
    const over = (p: Pick) =>
      !!p.gameId &&
      gameOver(p, now, finalSeen.current.get(p.gameId), today.looked, onBoard.has(p.gameId));
    setPicks((was) =>
      was.some(over)
        ? was.map((p) =>
            over(p) ? { channelId: p.channelId, label: tunedChannel(p.channelId)?.name ?? p.label } : p,
          )
        : was,
    );
  }, [today.games, today.looked]);

  // The channel behind each tile, from the catalog's index (plan 018, P4).
  const known = live ? channelIndex(live) : null;
  const streams: GridStream[] = picks.map((p) => {
    const ch = known?.get(p.channelId);
    const url = urls[p.channelId];
    return {
      id: p.channelId,
      name: p.label,
      url: url ?? null,
      unresolved: url === null,
      channel: { name: ch?.name ?? p.label, number: ch?.number, logo: ch?.logo },
      programmes: live?.programmes.get(p.channelId),
      game: p.gameId ? fixtures.get(p.gameId) : undefined,
      scoreAt: p.gameId ? (today.at ?? undefined) : undefined,
    };
  });

  // One Set per change of the grid, not per render: the picker's search is
  // memoised on it, and a new Set every render re-ran the search over the
  // whole catalog on every tick of the tab.
  const inGrid = useMemo(() => new Set(picks.map((p) => p.channelId)), [picks]);

  const choosingRef = useRef(false);
  choosingRef.current = choosing !== null;
  const openAdd = useCallback(() => {
    if (roomRef.current.left > 0 && !choosingRef.current) setPicker({ kind: "add" });
  }, []);
  const choose = (pick: Pick) => {
    if (!picker) return;
    if (picker.kind === "replace") {
      setPicks((was) => replacePick(was, picker.id, pick));
      // Same place, same sound.
      if (soundId === picker.id) setSoundId(pick.channelId);
    } else if (room.left === 0) {
      // The line filled while the picker was open (the count settled, a
      // poll came in): pick the tile it replaces, as a channel sent from
      // the Guide does. It used to close the picker and add nothing
      // (plan 018, L8).
      setPicker(null);
      setChoosing(pick);
      return;
    } else {
      setPicks((was) => addPick(was, pick, room));
    }
    // What you put in a grid is what you watched: the picker's Recent
    // section, and the Guide's, should know it.
    recordRecent(loadRecents(), pick.channelId);
    setPicker(null);
  };
  // Fill with live games (M9): the picker has already chosen them, as many
  // as the line has room for, the ones you follow first (mvGames.fillFrom).
  const fill = (list: Fixture[]) => {
    setPicks((was) =>
      list.reduce(
        (acc, g) =>
          addPick(
            acc,
            {
              channelId: g.channels[0].id,
              label: gameLabel(g),
              gameId: g.id,
              league: g.leagueKey,
              start: g.start.getTime(),
            },
            roomOn(line, acc.length, settled),
          ),
        was,
      ),
    );
    let recents = loadRecents();
    for (const g of list) recents = recordRecent(recents, g.channels[0].id);
    setPicker(null);
  };

  // A channel sent from elsewhere, once the line has answered: it joins,
  // or takes the sound, or waits for you to pick a tile (mvGrid.arrive).
  useEffect(() => {
    if (!incoming || !lineKnown) return;
    setIncoming(null);
    // A line of one shows why multi-view can't run on it, not a grid.
    if (line !== null && line.max <= 1) return;
    const a = arrive(picks, incoming, room);
    if (a.kind === "full") {
      setChoosing(incoming);
      return;
    }
    if (a.kind === "add") {
      setPicks(a.picks);
      recordRecent(loadRecents(), incoming.channelId);
    }
    setSoundId(incoming.channelId);
  }, [incoming, lineKnown, line, picks, room]);
  /** The tile you picked for it: replaced in place, and it takes the sound
   * (so in Focus it moves to the big spot, M2). */
  const chooseTile = (id: string) => {
    if (!choosing) return;
    setPicks((was) => replacePick(was, id, choosing));
    setSoundId(choosing.channelId);
    recordRecent(loadRecents(), choosing.channelId);
    setChoosing(null);
  };
  // Escape lets it go, before the grid's own Escape or the app's full
  // screen hear it (both leave an Escape that is already taken).
  useEffect(() => {
    if (!choosing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      setChoosing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [choosing]);

  const idle = useIdle();
  const [fullscreen, toggleFullscreen] = useWindowFullscreen();

  // The bar's keys from plan 017's table: A adds, M mutes, ↑ and ↓ are the
  // volume, G flips Grid and Focus, F is full screen. The tiles' own keys
  // (1 to 4, ← →, R, Delete) are the grid's. Never while typing, or while a
  // dialog has the keyboard (mvKeys.forMultiview). Through a ref, so the
  // listener is added once.
  const streamCount = picks.length;
  const barKeys = useRef({ openAdd, toggleMute, nudge, chooseKind, kind, streamCount, toggleFullscreen });
  barKeys.current = { openAdd, toggleMute, nudge, chooseKind, kind, streamCount, toggleFullscreen };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!forMultiview(e)) return;
      const k = barKeys.current;
      switch (e.key) {
        case "a":
        case "A":
          k.openAdd();
          break;
        case "m":
        case "M":
          k.toggleMute();
          break;
        case "ArrowUp":
          k.nudge(0.05);
          break;
        case "ArrowDown":
          k.nudge(-0.05);
          break;
        case "g":
        case "G":
          if (kindsFor(k.streamCount).length < 2) return;
          k.chooseKind(k.kind === "grid" ? "focus" : "grid");
          break;
        case "f":
        case "F":
          k.toggleFullscreen();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const leftRef = useRef<HTMLDivElement>(null);
  const compact = useCompactSide(leftRef);
  const rightRef = useRef<HTMLDivElement>(null);
  const compactRight = useCompactSide(rightRef, "right");

  // The shell reads these: the header hides its clock and Settings while
  // this tab is up, and dims with the bar when idle. On the root because
  // the header is App's, not ours.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.mv = "1";
    return () => {
      delete root.dataset.mv;
      delete root.dataset.mvIdle;
    };
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (idle) root.dataset.mvIdle = "1";
    else delete root.dataset.mvIdle;
  }, [idle]);

  const blocked = line !== null && line.max <= 1;
  const full = fullReason(room);
  const dashes = room.max !== null ? Math.min(room.max, 8) : 0;

  return (
    <div className={"mvtab" + (idle ? " is-idle" : "")}>
      <div className="mvbar">
        <div className={"mvbar__side" + (compact ? " is-compact" : "")} ref={leftRef}>
          {choosing && (
            // In place of the meter and the layout switch while a channel
            // sent from elsewhere waits for its tile: what to do, and the
            // way out.
            <span className="mvchoose" role="status">
              <span className="mvchoose__words">
                Pick a tile<span className="mvchoose__for"> for {choosing.label}</span>
              </span>
              <button type="button" className="mvchoose__cancel" onClick={() => setChoosing(null)}>
                Cancel <kbd>Esc</kbd>
              </button>
            </span>
          )}
          {!blocked && !choosing && (
            <span className="mvmeter" aria-label={meterLine(room)}>
              {dashes > 0 && (
                <span className="mvmeter__dashes" aria-hidden>
                  {Array.from({ length: dashes }, (_, i) => (
                    <i
                      key={i}
                      className={
                        i < room.used ? "is-on" : i < room.used + room.elsewhere ? "is-elsewhere" : undefined
                      }
                    />
                  ))}
                </span>
              )}
              <span className="mvmeter__text" aria-hidden>
                {meterLine(room)}
              </span>
            </span>
          )}
          {kindsFor(picks.length).length > 1 && !choosing && (
            <div className="mvseg" role="group" aria-label="Layout">
              <button
                type="button"
                className={kind === "grid" ? "is-on" : undefined}
                aria-pressed={kind === "grid"}
                aria-label="Grid"
                onClick={() => chooseKind("grid")}
              >
                <GridLayoutIcon size={15} />
                <span className="mvseg__word">Grid</span>
              </button>
              <button
                type="button"
                className={kind === "focus" ? "is-on" : undefined}
                aria-pressed={kind === "focus"}
                aria-label="Focus"
                onClick={() => chooseKind("focus")}
              >
                <FocusLayoutIcon size={15} />
                <span className="mvseg__word">Focus</span>
              </button>
            </div>
          )}
        </div>
        <div className={"mvbar__side" + (compactRight ? " is-compact" : "")} ref={rightRef}>
          {!blocked && picks.length > 0 && (
            <div className="mvvol">
              <Hint label={vol.muted ? "Unmute (M)" : "Mute (M)"}>
                <button
                  type="button"
                  className="mvbar__icon"
                  aria-label={vol.muted ? "Unmute" : "Mute"}
                  onClick={toggleMute}
                >
                  {vol.muted || vol.volume === 0 ? <MuteIcon size={18} /> : <VolumeIcon size={18} />}
                </button>
              </Hint>
              <input
                className="mvvol__slider"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={vol.muted ? 0 : vol.volume}
                aria-label="Volume"
                onChange={(e) => setVol({ volume: parseFloat(e.target.value), muted: false })}
              />
            </div>
          )}
          {!blocked && (
            <Hint label={full ?? "Add a channel (A)"}>
              <button
                type="button"
                className="mvbar__add"
                aria-disabled={full !== null}
                aria-label="Add channel"
                onClick={openAdd}
              >
                <PlusIcon size={16} />
                <span className="mvbar__addword">Add channel</span>
              </button>
            </Hint>
          )}
          <Hint label={fullscreen ? "Exit full screen (F)" : "Full screen (F)"}>
            <button
              type="button"
              className="mvbar__icon"
              aria-label={fullscreen ? "Exit full screen" : "Full screen"}
              onClick={toggleFullscreen}
            >
              {fullscreen ? <ExitFullscreenIcon size={18} /> : <FullscreenIcon size={18} />}
            </button>
          </Hint>
        </div>
      </div>

      <div className="mvtab__stage">
        {blocked ? (
          <p className="mvtab__blocked">
            Your line allows one stream at a time, so multi-view can’t run on it.
          </p>
        ) : (
          <MultiviewGrid
            streams={streams}
            cells={cells}
            kind={kind}
            split={splits[cells]}
            onSplit={chooseSplit}
            onVolumeStep={nudge}
            idle={idle}
            choosing={choosing?.label ?? null}
            onChoose={chooseTile}
            conns={line}
            soundId={soundId}
            volume={vol.volume}
            muted={vol.muted}
            onSound={setSoundId}
            onRemove={(id) => {
              setPicks((was) => removePick(was, id));
              // The sound falls to the first tile left (the grid derives it).
              // Holding the closed stream's id would hand the sound back,
              // and Focus's big spot with it, if that channel came back.
              if (id === soundId) setSoundId(null);
            }}
            onReplace={(id, name) => setPicker({ kind: "replace", id, name })}
            onRetryResolve={retryResolve}
            onAdd={openAdd}
            onGate={gate}
            // The LINE full, not the grid: four tiles on a line of five, or
            // on a provider with no limit, used to read as "your line is at
            // its limit" on any refusal (plan 018, R9).
            atCap={room.max !== null && room.used + room.elsewhere >= room.max}
          />
        )}
      </div>

      <MultiviewPicker
        open={picker !== null}
        onOpenChange={(o) => {
          if (!o) setPicker(null);
        }}
        mode={picker ?? { kind: "add" }}
        live={live}
        games={liveGames}
        inGrid={inGrid}
        room={room}
        onChoose={choose}
        onFill={fill}
      />
    </div>
  );
}

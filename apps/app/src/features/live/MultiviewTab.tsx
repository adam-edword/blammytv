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
  saveGrid,
  saveLayoutKinds,
  saveMvVolume,
  type MvVolume,
} from "./multiviewAck";
import { peekLiveGames } from "./multiviewEntry";
import { gameLabel, liveWithChannels, useGamesToday } from "./mvGames";
import { isFixture, type Fixture } from "../sports/model";
import { defaultKind, kindsFor, type MvKind } from "./mvLayout";
import {
  addPick,
  cellsFor,
  fullReason,
  meterLine,
  removePick,
  replacePick,
  roomOn,
  swapToFront,
  type Pick,
} from "./mvGrid";
import { forMultiview } from "./mvKeys";
import { useConnections } from "./connections";
import { resolveStreamUrl } from "./stream";
import { useLiveData } from "./useLiveData";
import { loadRecents, recordRecent } from "./recents";
import { tunedChannel } from "../sports/catalog";
import {
  isTauri,
  tauriIsFullscreen,
  tauriMvConvertWarm,
  tauriSetFullscreen,
} from "../../lib/tauri";
import { HEVC_MIME } from "./mvTile";
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
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);
  return idle;
}

/**
 * Whether the WINDOW is full screen, and a way to flip it.
 *
 * The window is the truth, not a flag of ours: Escape exits full screen at
 * app level (App.tsx) and the window-state plugin restores it across
 * launches, so this re-asks on every resize. Full screen this tab turned on
 * is turned off again when you leave it; one it found already on is left
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
    window.addEventListener("resize", sync);
    document.addEventListener("fullscreenchange", sync);
    return () => {
      window.removeEventListener("resize", sync);
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
 * How long after the grid changes before the panel's count is believed.
 * connections.ts measured a panel taking up to about 20 seconds to notice a
 * stream has gone; a little over that.
 */
const SETTLE_MS = 25_000;

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

  // The grid, as it was left (M7).
  const [saved] = useState(loadGrid);
  const [picks, setPicks] = useState<Pick[]>(saved.picks);
  const [soundId, setSoundId] = useState<string | null>(saved.sound);
  useEffect(() => saveGrid({ picks, sound: soundId }), [picks, soundId]);

  // A remembered channel that has left the catalog is dropped quietly, once
  // the catalog is here to say so.
  useEffect(() => {
    if (!live) return;
    setPicks((was) => {
      const next = was.filter((p) => tunedChannel(p.channelId));
      return next.length === was.length ? was : next;
    });
  }, [live]);

  /**
   * The line: its limit, what it reports in use, and so what is left.
   *
   * ONLY WHEN ONE PLAYLIST ANSWERS: with several, a grid can draw tiles from
   * different lines and no single cap describes it, and guessing wrong in
   * either direction is worse than offering up to four and letting a tile
   * say it was refused. Keyed on the grid's channels so the count is asked
   * again after every change, then again once the panel has caught up.
   */
  const key = picks.map((p) => p.channelId).join("|");
  const conns = useConnections(key || null);
  const line = conns.size === 1 ? [...conns.values()][0] : null;
  const [settledKey, setSettledKey] = useState<string | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setSettledKey(key), SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [key]);
  const room = roomOn(line, picks.length, settledKey === key);
  const roomRef = useRef(room);
  roomRef.current = room;
  const cells = cellsFor(picks.length, room.left);

  const [kinds, setKinds] = useState(loadLayoutKinds);
  const kind: MvKind = kinds[cells] ?? defaultKind(cells);
  const chooseKind = (k: MvKind) => {
    const next = { ...kinds, [cells]: k };
    saveLayoutKinds(next);
    setKinds(next);
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
      const real = tunedChannel(id);
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

  const [picker, setPicker] = useState<PickerMode | null>(null);

  /**
   * Today's games, asked for only while something here needs them: the
   * picker is open, or a tile is a game (its score). Until the first answer
   * lands, the picker shows what the Sports board last saw, which is
   * instant and at most half an hour old (multiviewEntry).
   */
  const gameLeagues = picks.flatMap((p) => (p.gameId && p.league ? [p.league] : []));
  const today = useGamesToday(picker !== null || gameLeagues.length > 0, gameLeagues);
  const [snapshot] = useState(peekLiveGames);
  const liveGames = today.looked ? liveWithChannels(today.games) : snapshot;
  const fixtures = new Map(
    today.games.filter(isFixture).map((g) => [g.id, g] as const),
  );

  const streams: GridStream[] = picks.map((p) => {
    const ch = tunedChannel(p.channelId);
    const url = urls[p.channelId];
    return {
      id: p.channelId,
      name: p.label,
      url: url ?? null,
      unresolved: url === null,
      channel: { name: ch?.name ?? p.label, number: ch?.number, logo: ch?.logo },
      programmes: live?.programmes.get(p.channelId),
      game: p.gameId ? fixtures.get(p.gameId) : undefined,
    };
  });

  // One Set per change of the grid, not per render: the picker's search is
  // memoised on it, and a new Set every render re-ran the search over the
  // whole catalog on every tick of the tab.
  const inGrid = useMemo(() => new Set(picks.map((p) => p.channelId)), [picks]);

  const openAdd = useCallback(() => {
    if (roomRef.current.left > 0) setPicker({ kind: "add" });
  }, []);
  const choose = (pick: Pick) => {
    if (!picker) return;
    if (picker.kind === "replace") {
      setPicks((was) => replacePick(was, picker.id, pick));
      // Same place, same sound.
      if (soundId === picker.id) setSoundId(pick.channelId);
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
            { channelId: g.channels[0].id, label: gameLabel(g), gameId: g.id, league: g.leagueKey },
            roomOn(line, acc.length, settledKey === key),
          ),
        was,
      ),
    );
    let recents = loadRecents();
    for (const g of list) recents = recordRecent(recents, g.channels[0].id);
    setPicker(null);
  };

  const idle = useIdle();
  const [fullscreen, toggleFullscreen] = useWindowFullscreen();

  // The bar's keys from plan 017's table: A adds, M mutes, ↑ and ↓ are the
  // volume, G flips Grid and Focus, F is full screen. The tiles' own keys
  // (1 to 4, ← →, R, Delete) are the grid's. Never while typing, or while a
  // dialog has the keyboard (mvKeys.forMultiview). Through a ref, so the
  // listener is added once.
  const barKeys = useRef({ openAdd, toggleMute, nudge, chooseKind, kind, cells, toggleFullscreen });
  barKeys.current = { openAdd, toggleMute, nudge, chooseKind, kind, cells, toggleFullscreen };
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
          if (kindsFor(k.cells).length < 2) return;
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
          {!blocked && (
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
          {kindsFor(cells).length > 1 && (
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
            conns={line}
            soundId={soundId}
            volume={vol.volume}
            muted={vol.muted}
            onSound={setSoundId}
            onRemove={(id) => setPicks((was) => removePick(was, id))}
            onReplace={(id, name) => setPicker({ kind: "replace", id, name })}
            onRetryResolve={retryResolve}
            onAdd={openAdd}
            atCap={room.left === 0}
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

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
import { allowedSizes, usableSize, type GridSize } from "./multiview";
import {
  loadGridSize,
  loadLayoutKinds,
  saveGridSize,
  saveLayoutKinds,
} from "./multiviewAck";
import { peekLiveGames } from "./multiviewEntry";
import { defaultKind, kindsFor, type MvKind } from "./mvLayout";
import { useConnections } from "./connections";
import { resolveStreamUrl } from "./stream";
import { useLiveData } from "./useLiveData";
import { tunedChannel } from "../sports/catalog";
import { Matchup } from "../sports/Matchup";
import {
  isTauri,
  tauriIsFullscreen,
  tauriSetFullscreen,
} from "../../lib/tauri";
import {
  ExitFullscreenIcon,
  FocusLayoutIcon,
  FullscreenIcon,
  GridLayoutIcon,
} from "../../ui/icons";
import { Hint } from "../../ui/Hint";

/**
 * THE MULTI-VIEW TAB (plan 017, P1): several streams at once, as a place you
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
 * P1 keeps the picking as it was: the rail on the right, games from Sports
 * first, then search. P3 replaces it with the palette.
 *
 * A TILE TAKES ANY CHANNEL, not only a live game, and that is a correction
 * rather than a feature. The first build filled tiles from live fixtures
 * alone, which Adam found unusable on the first evening he tried it: "i
 * cant multi anything, there's only 1 game live rn". So games are the
 * SHORTCUT, not the source, and either way a pick resolves to a channel id.
 */

/** One chosen tile, already reduced to the channel that will play in it. */
interface Pick {
  /** Channel id, which is also the identity: the same channel twice would
   * be two tiles of one stream and two connections spent on it. */
  channelId: string;
  /** What the tile is called. A game says the fixture, a channel says
   * itself, because that is what you picked in each case. */
  label: string;
}

/** How many catalog rows a search shows. Enough to find it, few enough that
 * the rail stays a rail: a bare query can match thousands. */
const SEARCH_LIMIT = 40;

/** How long the pointer has to rest before the bar goes (plan 017). */
const IDLE_MS = 2000;

/**
 * Idle after IDLE_MS without the pointer or a key, but never while the
 * pointer rests on the bar or the capsule, or keyboard focus is in them:
 * a bar that dims under your hand reads as one about to go away.
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
          ".header:hover, .mvbar:hover, .mvtab__rail:hover, .header :focus-visible, .mvbar :focus-visible",
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
function useCompactSide(ref: RefObject<HTMLElement | null>): boolean {
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
      const room = cap.getBoundingClientRect().left - s.left - 16;
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
  }, [ref]);
  return compact;
}

export function MultiviewTab() {
  /**
   * The line's connection cap, which is multi-view's real ceiling.
   *
   * ONLY WHEN ONE PLAYLIST ANSWERS: with several, a grid can draw tiles from
   * different lines and no single cap describes it, and guessing wrong in
   * either direction is worse than the documented "unknown means offer
   * everything" rule. See allowedSizes.
   */
  const conns = useConnections(null);
  const line = conns.size === 1 ? [...conns.values()][0] : null;

  // The size you chose is a preference and is kept as chosen; the size the
  // grid USES is that, clamped to the line. Writing the clamp back (as the
  // Sports version did, audit F14) lost a 4 the moment you opened a
  // 3-connection playlist.
  const [size, setSize] = useState<GridSize>(loadGridSize);
  const cells = usableSize(size, line);
  const sizes = allowedSizes(line);
  const chooseSize = (n: GridSize) => {
    saveGridSize(n);
    setSize(n);
  };

  const [kinds, setKinds] = useState(loadLayoutKinds);
  const kind: MvKind = cells ? kinds[cells] ?? defaultKind(cells) : "grid";
  const chooseKind = (k: MvKind) => {
    if (!cells) return;
    const next = { ...kinds, [cells]: k };
    saveLayoutKinds(next);
    setKinds(next);
  };

  const [picked, setPicked] = useState<Pick[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const cap = cells ?? 0;

  /** The live games Sports last published. Read once: the tab is a fresh
   * mount each visit, and the list moving under the pointer mid-pick would
   * be worse than one that is a visit old. */
  const [games] = useState(peekLiveGames);

  /** The catalog: loaded here if nothing has yet, and followed after, so
   * the search works however this tab was reached (useLiveData). */
  const live = useLiveData();
  /** The visible channels, for the search. Hidden folders stay hidden: this
   * is a picker, and the guide's own hiding is a statement about clutter. */
  const channels = useMemo(() => live?.channels ?? [], [live]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const out = [];
    for (const c of channels) {
      if (c.name.toLowerCase().includes(q)) out.push(c);
      if (out.length >= SEARCH_LIMIT) break;
    }
    return out;
  }, [channels, query]);

  // Resolve each pick to a playable URL, once per channel.
  useEffect(() => {
    let dead = false;
    for (const p of picked) {
      if (urls[p.channelId]) continue;
      const real = tunedChannel(p.channelId);
      if (!real) continue;
      void resolveStreamUrl(real).then(
        (url) => {
          if (dead || !url) return;
          setUrls((was) =>
            was[p.channelId] ? was : { ...was, [p.channelId]: url },
          );
        },
        () => undefined,
      );
    }
    return () => {
      dead = true;
    };
  }, [picked, urls]);

  // A smaller grid drops what no longer fits rather than keeping it selected
  // invisibly and surprising you on the way back up.
  useEffect(() => {
    setPicked((was) => (was.length > cap ? was.slice(0, cap) : was));
  }, [cap]);

  const toggle = (channelId: string, label: string) =>
    setPicked((was) =>
      was.some((p) => p.channelId === channelId)
        ? was.filter((p) => p.channelId !== channelId)
        : was.length >= cap
          ? was
          : [...was, { channelId, label }],
    );

  const streams: GridStream[] = [];
  for (const p of picked) {
    const url = urls[p.channelId];
    if (!url) continue;
    const ch = tunedChannel(p.channelId);
    streams.push({
      id: p.channelId,
      name: p.label,
      url,
      channel: { name: ch?.name ?? p.label, number: ch?.number, logo: ch?.logo },
      programmes: live?.programmes.get(p.channelId),
    });
  }
  const remove = (channelId: string) =>
    setPicked((was) => was.filter((p) => p.channelId !== channelId));

  const has = (channelId: string) => picked.some((p) => p.channelId === channelId);
  const full = picked.length >= cap;

  const idle = useIdle();
  const [fullscreen, toggleFullscreen] = useWindowFullscreen();
  const leftRef = useRef<HTMLDivElement>(null);
  const compact = useCompactSide(leftRef);

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

  return (
    <div className={"mvtab" + (idle ? " is-idle" : "")}>
      <div className="mvbar">
        <div className={"mvbar__side" + (compact ? " is-compact" : "")} ref={leftRef}>
          {cells !== null && sizes.length > 1 && (
            <div className="mvseg" role="group" aria-label="Tiles">
              <span className="mvseg__label" aria-hidden>
                Tiles
              </span>
              {sizes.map((n) => (
                <button
                  type="button"
                  key={n}
                  className={n === cells ? "is-on" : undefined}
                  aria-pressed={n === cells}
                  aria-label={`${n} tiles`}
                  onClick={() => chooseSize(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
          {cells !== null && kindsFor(cells).length > 1 && (
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
        <div className="mvbar__side">
          <Hint label={fullscreen ? "Exit full screen" : "Full screen"}>
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
        {cells === null ? (
          <p className="mvtab__blocked">
            Your line allows one stream at a time, so multi-view can’t run on it.
          </p>
        ) : (
          <MultiviewGrid
            streams={streams}
            cells={cells}
            kind={kind}
            conns={line}
            onRemove={remove}
          />
        )}
      </div>

      {cells !== null && (
        <aside className="mvtab__rail mvscreen__rail">
          <h2 className="mvscreen__title">
            Fill the grid
            <span className="mvscreen__count">
              {picked.length}/{cap}
            </span>
          </h2>

          {games.length > 0 && (
            <>
              <p className="mvscreen__section">Live now</p>
              {games.map((g) => {
                const ch = g.channels[0];
                if (!ch) return null;
                const on = has(ch.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    className={
                      "mvscreen__game" +
                      (on ? " is-on" : "") +
                      (!on && full ? " is-full" : "")
                    }
                    aria-pressed={on}
                    disabled={!on && full}
                    onClick={() =>
                      toggle(
                        ch.id,
                        `${g.away.shortName ?? g.away.name} at ${g.home.shortName ?? g.home.name}`,
                      )
                    }
                  >
                    <Matchup game={g} />
                  </button>
                );
              })}
            </>
          )}

          <p className="mvscreen__section">Any channel</p>
          <input
            className="mvscreen__search"
            type="search"
            value={query}
            placeholder="Search your channels"
            aria-label="Search your channels"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.trim().length >= 2 && results.length === 0 && (
            <p className="mvscreen__empty">Nothing matches that.</p>
          )}
          {results.map((c) => {
            const on = has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                className={
                  "mvscreen__chan" +
                  (on ? " is-on" : "") +
                  (!on && full ? " is-full" : "")
                }
                aria-pressed={on}
                disabled={!on && full}
                onClick={() => toggle(c.id, c.name)}
              >
                {c.name}
              </button>
            );
          })}
        </aside>
      )}
    </div>
  );
}

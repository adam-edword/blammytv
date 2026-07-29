import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import Tilt from "react-parallax-tilt";
import { REDUCED_MOTION } from "../../lib/reducedMotion";
import { useMouseNav } from "../../lib/mouseNav";
import {
  isTauri,
  tauriIsFullscreen,
  tauriMpvGoLive,
  tauriPopoutOpen,
  tauriSetFullscreen,
  type TheaterMeta,
} from "../../lib/tauri";
import { InvertedPlayer } from "../live/InvertedPlayer";
import { TheaterOverlay } from "../live/TheaterOverlay";
import { useDirectOverlay } from "../live/useDirectOverlay";
import { setOverlayApiOverride } from "../live/overlayApi";
import { resolveStreamUrl } from "../live/stream";
import { loadFavorites, toggleFavorite } from "../live/favorites";
import { Matchup } from "./Matchup";
import { CompactCard } from "./CompactCard";
import { autoPlay, nextSource } from "./autoplay";
import { tunedChannel } from "./catalog";
import { matchEvent, matchGame } from "./matcher";
import type { Catalog, Match } from "./matcher";
import type { Game } from "./model";

/** CSS corner radius of .sportstheater__slot. Two things round by it and
 * they must agree: the stylesheet below, and the rect InvertedPlayer cuts
 * the hole with. */
const SLOT_RADIUS = 18;

/** A playback in progress. The url is its identity; the rest is what the
 * rail and the chrome need to say what is on. */
interface Tuned {
  id: string;
  name: string;
  logo?: string;
  url: string;
}

/**
 * Theater: one game, the player, and the ways into it (plan 010).
 *
 * The hub has two modes and this is the second. The board answers "what is
 * on"; this answers "I am watching this one". There is deliberately no
 * middle mode with a small player on the board: a mini player either
 * competes with the thing it sits beside or is too small to be worth the
 * room, and the board is already the place you go to stop watching.
 *
 * The video is a NATIVE window showing through a hole cut in the page, so
 * the layout is built around one rule: nothing may overlap the slot. The
 * sidebar sits beside it, never over it, and the matchup header carries no
 * chrome that could stray across the boundary.
 */
export function SportsTheater({
  game,
  others,
  catalog,
  onOpen,
  onClose,
}: {
  game: Game;
  /** The other games on now, to switch to. Not this one. */
  others: Game[];
  /** The user's channels. The rail resolves its own, rather than taking the
   * card's list: the card counts only what it is sure of, and the rail is
   * the one place a doubtful match can be shown honestly, with its score. */
  catalog: Catalog | null;
  /** Switch the theater to another game, from the live scores below. The
   * same handler the board opens a card with, so switching in here and
   * arriving from out there land in exactly the same place. */
  onOpen: (game: Game) => void;
  onClose: () => void;
}) {
  const matches = useMemo(() => {
    if (!catalog) return [];
    // Channels naming this exact fixture first, then whatever carries the
    // networks the schedule listed. Same order the card counts them in.
    const named = matchEvent(
      [game.home.name, game.away.name],
      game.start,
      catalog,
    );
    const seen = new Set(named.map((c) => c.id));
    return [
      ...named,
      ...matchGame(game.broadcasts, catalog).filter((c) => !seen.has(c.id)),
    ];
  }, [game, catalog]);

  /**
   * The other live games, by league, in the order their first one started.
   *
   * A Map keyed on the league name, because it keeps insertion order: the
   * board hands `others` over sorted by kick-off, so the league whose games
   * began earliest heads the list and every group keeps that order inside
   * itself. Nothing here re-sorts, which is the point.
   */
  const groups = useMemo(() => {
    const by = new Map<string, Game[]>();
    for (const g of others) {
      const seen = by.get(g.league);
      if (seen) seen.push(g);
      else by.set(g.league, [g]);
    }
    return [...by];
  }, [others]);

  /**
   * What is playing, and it is a URL rather than a channel on purpose.
   *
   * The url IS the identity of a playback: InvertedPlayer keys its whole
   * effect on it, and useDirectOverlay re-arms `loading` on it. The id and
   * the name ride along only so the rail can mark its own row and the
   * chrome can say what it is showing.
   */
  const [tuned, setTuned] = useState<Tuned | null>(null);
  const tunedRef = useRef<Tuned | null>(null);
  tunedRef.current = tuned;
  const [fullscreen, setFullscreen] = useState(false);

  /**
   * Tune a rail row.
   *
   * `want` is the guard against a fast second click: resolving is async
   * (Stalker exchanges a play_token over the network), so two clicks race
   * and the SLOWER one must not win. Same shape as the Live screen's
   * "switched away meanwhile" check.
   */
  const want = useRef<string | null>(null);
  const tune = useCallback((channel: Match) => {
    want.current = channel.id;
    // The Channel, not the Tunable: the matcher's type carries no stream
    // credentials, deliberately. Null means the catalog moved under the
    // rail, which is exactly when not to play something.
    const real = tunedChannel(channel.id);
    if (!real) return;
    void resolveStreamUrl(real).then(
      (url) => {
        if (!url || want.current !== channel.id) return;
        setTuned({ id: channel.id, name: channel.name, logo: channel.logo, url });
      },
      () => undefined,
    );
  }, []);

  const stop = useCallback(() => {
    want.current = null;
    setTuned(null);
  }, []);

  /**
   * FAILOVER: this feed is dead, so try the next one down the rail.
   *
   * Called by the overlay the moment its watchdog gives up, which is
   * already after two silent reloads of the same URL — so by the time this
   * runs, "reload it again" has been tried and answered.
   *
   * Read through a ref rather than closed over, because this handler is
   * held by useDirectOverlay for the life of the playback and the rail is
   * rebuilt whenever the catalog refreshes behind it.
   */
  const railRef = useRef(matches);
  railRef.current = matches;
  const failover = useCallback(() => {
    const t = tunedRef.current;
    if (!t) return;
    const next = nextSource(railRef.current, t.id);
    // End of the rail: nothing left to try, so let the overlay's dead card
    // stand rather than starting the same walk over.
    if (next) tune(next);
  }, [tune]);

  /**
   * The subject changed, so decide again what is playing. ONE effect, and
   * it has to be one.
   *
   * This was two — stop on game change, autoplay on matches — and under
   * StrictMode the pair raced and autoplay never survived it. React
   * double-invokes effects on mount, so the order was: stop, autoplay
   * (tune fires, resolve in flight), then stop AGAIN, then autoplay sees
   * itself already armed and declines. The second stop cleared `want`, and
   * when the resolve landed the guard that exists to drop a stale tune
   * dropped the only real one. Autoplay was dead on arrival while clicking
   * the same top row by hand worked perfectly, because a click has no
   * second effect running behind it.
   *
   * Both halves are now guarded by what actually happened rather than by a
   * dependency array: `subject` is the game we last cleared for, `armed`
   * the game we last auto-played for. A repeat invocation with the same
   * game does nothing, which is the property StrictMode is checking for.
   *
   * They are two refs rather than one because they legitimately disagree:
   * a finished game gets cleared and never armed, and a cold start clears
   * on mount and arms later, when the catalog finally lands. That second
   * case is also why `matches` is in the deps and not just the id.
   */
  const subject = useRef<string | null>(null);
  const armed = useRef<string | null>(null);
  useEffect(() => {
    // A channel belongs to the game it was matched to. Nothing carries
    // over: a Cubs feed under a Blue Jays matchup is worse than silence.
    if (subject.current !== game.id) {
      subject.current = game.id;
      stop();
    }
    // OPENING THE THEATER PUTS THE GAME ON. Every reason not to lives in
    // autoplay.ts; `armed` is this side's half of it.
    const pick = autoPlay(game, matches, armed.current);
    if (!pick) return;
    armed.current = game.id;
    tune(pick);
  }, [game, matches, tune, stop]);

  const meta = useMemo<TheaterMeta | null>(
    () =>
      tuned && {
        channelName: tuned.name,
        logo: tuned.logo,
        // The chrome's title line is the GAME, not the programme: the EPG
        // says "MLB Baseball" where the panel already knows exactly which
        // fixture this channel was matched to.
        title: `${game.home.name} v ${game.away.name}`,
        description: game.status,
        // Content type, never derived from EPG coverage. See TheaterMeta.
        live: true,
        sourceName: game.league,
        favorite: loadFavorites().includes(tuned.id),
      },
    [tuned, game],
  );

  const directApi = useDirectOverlay(isTauri() && !!tuned, tuned?.url ?? null, meta, {
    // The overlay's close returns you to the RAIL, not to the board: you
    // are still watching this game, you just stopped this feed. Escape is
    // the way out of the theater, and it stays that way.
    onClose: stop,
    onExpand: () => {},
    onCollapse: stop,
    onFullscreen: () => {
      setFullscreen(true);
      void tauriSetFullscreen(true).catch(() => {});
    },
    onExitFullscreen: () => {
      setFullscreen(false);
      void tauriSetFullscreen(false).catch(() => {});
    },
    // The same open sequence both other hosts use: heal the shell's clip
    // hole BEFORE Rust tears the video child down, because losing that
    // race flashes the desktop through a hole nothing is left to close.
    onPopout: () => {
      const t = tunedRef.current;
      if (!t) return;
      const shell = document.querySelector<HTMLElement>(".app-shell");
      if (shell) shell.style.clipPath = "";
      void tauriPopoutOpen(t.url).catch(() => {});
      stop();
    },
    onToggleFavorite: () => {
      const t = tunedRef.current;
      // Persists inside; the overlay tracks its own state after a toggle.
      if (t) toggleFavorite(loadFavorites(), t.id);
    },
    // The rail IS the failover list. Live TV has no equivalent and so
    // passes no handler, which is what keeps this change to this screen.
    onNextSource: failover,
    // Go-live on a Stalker channel has to re-resolve: the playing URL's
    // play_token is short-lived and mpv's in-place reload of a stale one is
    // a guaranteed 403. A changed URL rebuilds the player; anything else
    // falls through to the plain reload.
    onGoLive: () => {
      const t = tunedRef.current;
      const real = t ? tunedChannel(t.id) : null;
      if (!t || !real?.streamCmd) {
        void tauriMpvGoLive().catch(() => {});
        return;
      }
      resolveStreamUrl(real).then(
        (url) => {
          if (tunedRef.current?.id !== t.id) return;
          if (url && url !== t.url) setTuned({ ...t, url });
          else void tauriMpvGoLive().catch(() => {});
        },
        () => void tauriMpvGoLive().catch(() => {}),
      );
    },
  });
  // First-frame gate for the shell hole (see InvertedPlayer.ready): true
  // re-arms on every tune, false on mpv's first presented frame.
  const [videoReady, setVideoReady] = useState(false);
  useEffect(() => directApi.onLoading((v) => setVideoReady(!v)), [directApi]);
  // Must be set before TheaterOverlay renders: its state initializers read
  // the api synchronously. Idempotent, so the render-path call is safe.
  if (isTauri() && tuned) setOverlayApiOverride(directApi);

  // The chrome lives in the main webview but OUTSIDE .app-shell, so the
  // clip hole cannot cut it. Same host id the other two players use; only
  // one of the three is ever mounted.
  const chromeHost = useRef<HTMLDivElement | null>(null);
  if (isTauri() && !chromeHost.current) {
    const host = document.createElement("div");
    host.id = "inv-chrome";
    chromeHost.current = host;
  }
  useEffect(() => {
    const host = chromeHost.current;
    if (!host) return;
    document.body.appendChild(host);
    return () => {
      host.remove();
      setOverlayApiOverride(null);
    };
  }, []);

  useMouseNav(onClose);
  useEffect(() => {
    /**
     * Escape leaves fullscreen first and the theater second, and the test
     * for "am I fullscreen" is THE WINDOW, not this component's flag.
     *
     * The flag is only true when fullscreen was entered through the
     * overlay's own button. F11 is handled at app level and the
     * window-state plugin restores fullscreen across launches, so the
     * window can be fullscreen while this component has no idea — and then
     * one Escape dropped the window out of fullscreen (App's handler) AND
     * left the hub (this one), which is exactly what it looked like.
     *
     * App.tsx already takes the window out of fullscreen on Escape, so
     * this does not have to. All it has to do is not ALSO leave.
     */
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!isTauri()) {
        onClose();
        return;
      }
      void tauriIsFullscreen().then(
        (full) => {
          if (full) setFullscreen(false);
          else onClose();
        },
        // No answer from the window: closing on a maybe would be the bad
        // half of the bug again, so stay put.
        () => undefined,
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Leaving the theater with the window still in OS fullscreen would strand
  // the whole app there, with no player left to take it out.
  const fsRef = useRef(fullscreen);
  fsRef.current = fullscreen;
  useEffect(
    () => () => {
      if (fsRef.current) void tauriSetFullscreen(false).catch(() => {});
    },
    [],
  );

  return (
    <div
      className={"sportstheater" + (fullscreen ? " sportstheater--full" : "")}
    >
      <aside className="sportstheater__side">
        <Matchup game={game} />

        {/* Every channel of yours carrying this game. The schedule names
         * networks ("NBC", "MASN") and the matcher turns those into your
         * own channels; the card's "Live on 3 channels" is a promise that
         * lands here, and clicking one plays it. */}
        <nav className="sportstheater__rail">
          {matches.length > 0 ? (
            matches.map((c) => (
              <Rail
                key={c.id}
                channel={c}
                on={tuned?.id === c.id}
                onPlay={tune}
              />
            ))
          ) : (
            <p className="sportstheater__empty">
              {/* Same three states as the card: unknown is not none. */}
              {game.channelsPending
                ? "Checking your channels\u2026"
                : game.broadcasts.length > 0
                  ? `On ${game.broadcasts.join(", ")}. None of your channels carry it.`
                  : "No broadcast listed for this game."}
            </p>
          )}
        </nav>

        {groups.length > 0 && (
          <section className="sportstheater__scores">
            <h3 className="sportstheater__heading">
              <span className="gamepip" aria-hidden />
              Live Scores
            </h3>
            {/* The league, said once over its games instead of on every
              * line. The rows lost their own tag because it was the one
              * thing on them whose width the sport did not bound; as a
              * heading it has the whole width and can say "Premier League"
              * in full. */}
            {groups.map(([league, games]) => (
              <div className="sportstheater__group" key={league}>
                <h4 className="sportstheater__league">{league}</h4>
                {/* Leaning, and live. On the board a compact line is a
                  * finished game and answers the pointer with nothing,
                  * because there is nothing to choose. Here every one of
                  * them is a game running right now that you can switch
                  * to, so it gets the rail's lean and the rail's glare and
                  * opens on click.
                  *
                  * The lean is a wrapper rather than something inside the
                  * card: the card is shared with the board, and the board's
                  * copies should stay flat and cheap. */}
                {games.map((g) => (
                  <Lean className="scorelean" key={g.id}>
                    <CompactCard game={g} onOpen={onOpen} />
                  </Lean>
                ))}
              </div>
            ))}
          </section>
        )}
      </aside>

      {/* The hole. InvertedPlayer glues mpv to whatever box carries this
       * id and follows it every frame, so the slot needs no wiring beyond
       * existing: it is an empty slate until a channel is chosen. */}
      <div className="sportstheater__stage">
        <div id="player-slot" className="sportstheater__slot" />
      </div>

      {/* Headless: opens mpv into the slot above and follows the box.
       * Radius said out loud because this slot is not the hero's 12px, and
       * the rect mpv draws into and the hole cut above it both round by
       * that number. */}
      {tuned && (
        <InvertedPlayer
          url={tuned.url}
          squared={fullscreen}
          radius={SLOT_RADIUS}
          ready={videoReady}
        />
      )}

      {/* The chrome, portaled OUT of .app-shell so the clip hole cannot cut
       * it. Always the theater frame: this panel has no mini player to
       * collapse into, which is the whole reason the hub has two modes. */}
      {isTauri() &&
        tuned &&
        chromeHost.current &&
        createPortal(
          <TheaterOverlay
            frame={fullscreen ? "fullscreen" : "theater"}
            playbackKey={tuned.url}
            vod={false}
          />,
          chromeHost.current,
        )}
    </div>
  );
}

/**
 * One channel, with how sure we are that it is the right one.
 *
 * The score is the point. Everything here would once have been dropped or
 * shown without qualification; a number lets a doubtful match be offered
 * honestly instead of either hidden or dressed up as certain.
 */
function Rail({
  channel,
  on,
  onPlay,
}: {
  channel: Match;
  /** This row is the one playing. */
  on: boolean;
  onPlay: (channel: Match) => void;
}) {
  const band =
    channel.confidence >= 85
      ? "sure"
      : channel.confidence >= 60
        ? "likely"
        : "doubt";
  return (
    <button
      type="button"
      className={"sportsrail" + (on ? " is-on" : "")}
      title={channel.name}
      onClick={() => onPlay(channel)}
    >
      <Lean className="sportsrail__tilt">
        {channel.logo && (
          <img
            className="sportsrail__logo"
            src={channel.logo}
            alt=""
            loading="lazy"
          />
        )}
        <span className="sportsrail__name">{channel.name}</span>
        {channel.quality && (
          <span className="sportsrail__badge">{channel.quality}</span>
        )}
        {/* The score stays put now. It used to stand aside for the play
         * mark; with the lean carrying the affordance there is nothing to
         * stand aside for, so the number stays readable throughout. */}
        <span className={`sportsrail__score is-${band}`}>
          <span className="sportsrail__bar" aria-hidden>
            <i style={{ height: `${channel.confidence}%` }} />
          </span>
          <span className="sportsrail__pct">{channel.confidence}%</span>
        </span>
      </Lean>
    </button>
  );
}

/**
 * The panel's lean and glare, over anything row-shaped in it.
 *
 * One component rather than the props twice, because both users are the
 * same shape to within a few pixels: the channel row is 344x62 and the
 * score line 344x65. Tilt reads its angles as degrees and the eye reads
 * them as pixels swept at the corner, so two rows this alike must not be
 * given different numbers.
 *
 * The angles are deliberately NOT the cards' numbers. Half-width times
 * sin(3deg) is 8.9px and half-height times sin(6deg) is 3.2px, which lands
 * on the wide card's own 10.3 and 3.6. Copying its 1.5deg would have been
 * almost no movement at this size.
 *
 * The glare's radius is the pill's, and both rows are pills. It is its own
 * layer with its own clip, so a mismatch shows as a square sheen poking out
 * of a round corner.
 */
function Lean({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <Tilt
      className={className}
      tiltEnable={!REDUCED_MOTION}
      tiltMaxAngleX={6}
      tiltMaxAngleY={3}
      scale={REDUCED_MOTION ? 1 : 1.015}
      transitionSpeed={650}
      glareEnable={!REDUCED_MOTION}
      glareMaxOpacity={0.1}
      glarePosition="all"
      glareBorderRadius="100px"
    >
      {children}
    </Tilt>
  );
}

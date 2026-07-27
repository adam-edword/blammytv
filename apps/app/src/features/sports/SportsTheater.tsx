import { useEffect, useMemo } from "react";
import { useMouseNav } from "../../lib/mouseNav";
import { Badge } from "./Badge";
import { CompactCard } from "./CompactCard";
import { Wash } from "./Wash";
import { loser } from "./result";
import { matchEvent, matchGame } from "./matcher";
import type { Catalog, Match } from "./matcher";
import type { Game } from "./model";

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
  onClose,
}: {
  game: Game;
  /** The other games on now, to switch to. Not this one. */
  others: Game[];
  /** The user's channels. The rail resolves its own, rather than taking the
   * card's list: the card counts only what it is sure of, and the rail is
   * the one place a doubtful match can be shown honestly, with its score. */
  catalog: Catalog | null;
  onClose: () => void;
}) {
  const { home, away } = game;
  const lost = loser(game);
  const matches = useMemo(() => {
    if (!catalog) return [];
    // Channels naming this exact fixture first, then whatever carries the
    // networks the schedule listed. Same order the card counts them in.
    const named = matchEvent([game.home.name, game.away.name], game.start, catalog);
    const seen = new Set(named.map((c) => c.id));
    return [
      ...named,
      ...matchGame(game.broadcasts, catalog).filter((c) => !seen.has(c.id)),
    ];
  }, [game, catalog]);

  useMouseNav(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sportstheater">
      <aside className="sportstheater__side">
        {/* The matchup, bled to the panel's edges. Same wash as the cards,
          * without the card. */}
        <header className="sportstheater__game">
          <Wash side="home" team={home} lost={lost === "home"} />
          <Wash side="away" team={away} lost={lost === "away"} />
          <span className="sportstheater__scrim" aria-hidden />
          <span className="sportstheater__teams">
            <span className="sportstheater__team">
              <Badge team={home} />
              <span className="sportstheater__label">
                <span className="sportstheater__abbr">{home.abbr}</span>
                <span className="sportstheater__name">
                  {home.shortName ?? home.name}
                </span>
              </span>
            </span>
            <span className="sportstheater__team">
              <span className="sportstheater__label sportstheater__label--away">
                <span className="sportstheater__abbr">{away.abbr}</span>
                <span className="sportstheater__name">
                  {away.shortName ?? away.name}
                </span>
              </span>
              <Badge team={away} />
            </span>
          </span>
        </header>

        {/* Every channel of yours carrying this game. Empty until the
          * matcher exists (plan 010 phase 2): the schedule names networks
          * ("NBC", "MASN") and only a matcher can turn those into your own
          * channels. The card's "Live on 3 channels" is a promise that
          * lands here. */}
        {matches.length > 0 && <GlassDefs />}
        <nav className="sportstheater__rail">
          {matches.length > 0 ? (
            matches.map((c) => <Rail key={c.id} channel={c} />)
          ) : (
            <p className="sportstheater__empty">
              {game.broadcasts.length > 0
                ? `On ${game.broadcasts.join(", ")}. None of your channels carry it.`
                : "No broadcast listed for this game."}
            </p>
          )}
        </nav>

        {others.length > 0 && (
          <section className="sportstheater__scores">
            <h3 className="sportstheater__heading">
              <span className="gamepip" aria-hidden />
              Live Scores
            </h3>
            {others.map((g) => (
              <CompactCard key={g.id} game={g} />
            ))}
          </section>
        )}
      </aside>

      {/* The hole. InvertedPlayer glues mpv to whatever box carries this id
        * and follows it every frame, so this needs no wiring beyond
        * existing: it stays an empty slate until a channel is chosen. */}
      <div className="sportstheater__stage">
        <div id="player-slot" className="sportstheater__slot" />
      </div>
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
function Rail({ channel }: { channel: Match }) {
  const band =
    channel.confidence >= 85 ? "sure" : channel.confidence >= 60 ? "likely" : "doubt";
  return (
    <button type="button" className="sportsrail" title={channel.name}>
      {channel.logo && (
        <img className="sportsrail__logo" src={channel.logo} alt="" loading="lazy" />
      )}
      <span className="sportsrail__name">{channel.name}</span>
      {channel.quality && (
        <span className="sportsrail__badge">{channel.quality}</span>
      )}
      {/* The score and the action share one slot. The number is what you
        * need BEFORE deciding; the moment you are pointing at this row it
        * has done its job, so it stands aside for the play mark. The mark
        * takes the band's colour, so the confidence survives the swap as
        * colour even though the digits go. */}
      <span className={`sportsrail__score is-${band}`}>
        <span className="sportsrail__bar" aria-hidden>
          <i style={{ height: `${channel.confidence}%` }} />
        </span>
        <span className="sportsrail__pct">{channel.confidence}%</span>
        <span className="sportsrail__go" aria-hidden>
          <PlayIcon />
        </span>
      </span>
    </button>
  );
}

/**
 * The play mark's gradient, defined once for the whole rail.
 *
 * A shared <defs> rather than one inside every row's icon: the fill is
 * referenced by id, and repeating that id down a list of channels would be
 * invalid and leaves the browser to guess which one wins.
 */
function GlassDefs() {
  return (
    <svg width="0" height="0" aria-hidden focusable="false" style={{ position: "absolute" }}>
      <defs>
        <linearGradient id="sportsrail-glass" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.62" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.16" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * Glass, faked rather than refracted.
 *
 * A real refraction needs something behind it worth bending, and on a
 * near-black row there is nothing: a triangular window with
 * backdrop-filter: brightness() over this surface renders as a dim grey
 * shape you can barely find. Same lesson as the button's own dropped blur.
 *
 * So the depth is drawn instead: a body that falls from 62% to 16% white
 * across the diagonal, and a bright edge to catch the light. On a dark UI
 * that reads as glass and stays legible, which the honest version does not.
 */
function PlayIcon() {
  return (
    <svg width="18" height="21" viewBox="0 0 11 13" aria-hidden focusable="false">
      <path
        d="M1 1.5v10l9-5-9-5Z"
        fill="url(#sportsrail-glass)"
        stroke="rgba(255,255,255,0.8)"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
    </svg>
  );
}

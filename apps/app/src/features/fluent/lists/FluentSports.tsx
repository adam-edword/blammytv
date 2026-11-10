import { useMemo, useState, type KeyboardEvent } from "react";
import { ChevronIcon, MultiviewIcon, PlayIcon } from "../../../ui/icons";
import { requestMultiview, requestWatchInPlayer } from "../../live/multiviewEntry";
import { CompactCard } from "../../sports/CompactCard";
import { GolfCard } from "../../sports/GolfCard";
import { RaceCard } from "../../sports/RaceCard";
import { BoardSkeleton, SportsEmpty } from "../../sports/SportsEmpty";
import { TournamentCard } from "../../sports/TournamentCard";
import { WeekendCard } from "../../sports/WeekendCard";
import { dayLabel } from "../../sports/day";
import type { Follows } from "../../sports/follows";
import { ALL_LEAGUES, league as byPath } from "../../sports/leagues";
import { isField, isTournament, isWeekend, type Game, type Tournament } from "../../sports/model";
import { FluentGameCard } from "./FluentGameCard";
import { FluentLeagues } from "./FluentLeagues";

/** A day's tab: Yesterday, Today, Tomorrow, then "Sat, Nov 14". */
function tabLabel(date: Date): string {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const n = Math.round((date.getTime() - midnight.getTime()) / (24 * 3600_000));
  if (n === -1) return "Yesterday";
  if (n === 0 || n === 1) return dayLabel(date);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

type MoreState = "idle" | "loading" | "error";

interface Props {
  /** Every game the board loaded, ahead of the filter (the club list). */
  clubPool: Game[];
  follows: Follows;
  onFollows: (next: Follows) => void;
  picked: string[];
  onPick: (path: string) => void;
  onClearPicks: () => void;
  reveal: number;
  rankedOnly: boolean;
  onToggleRanked: () => void;
  /** Today's games per league path, ahead of the filter. */
  counts: ReadonlyMap<string, number>;
  /** Every day on the board, in date order. */
  days: { date: Date; games: Game[] }[];
  state: "loading" | "ready" | "error";
  compact: boolean;
  onToggleCompact: () => void;
  onOpenGame: (g: Game) => void;
  onOpenTournament: (t: Tournament) => void;
  cardWhen: (start: Date) => string;
  multiview: boolean;
  redzone: { id: string; name: string } | null;
  unlinked: "no-playlist" | string | null | false | undefined;
  earlier: { show: boolean; state: MoreState; load: () => void };
  more: { show: boolean; state: MoreState; load: () => void };
  /** The empty board's copy, from the screen's own reading of the filter. */
  empty: {
    anything: boolean;
    narrowed: boolean;
    names: string;
    count: number;
    teams: number;
    reachFailed: boolean;
    onReveal: () => void;
  };
}

/**
 * Fluent's Sports board: the leagues column beside a day SelectorBar and the
 * day's games grouped Live Now / Later Today / Final, three across. The data,
 * the filtering and the opening are SportsScreen's; this only lays them out.
 */
export function FluentSports(p: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  const tabs = useMemo(
    () => p.days.filter((d) => d.games.length > 0 || dayLabel(d.date) === "Today"),
    [p.days],
  );
  const day = tabs.find((d) => d.date.toDateString() === picked) ?? tabs.find((d) => dayLabel(d.date) === "Today") ?? tabs[0];
  const isToday = !!day && dayLabel(day.date) === "Today";
  const games = useMemo(() => day?.games ?? [], [day]);
  const groups = [
    { key: "live", title: "Live Now", items: games.filter((g) => g.state === "live") },
    { key: "pre", title: isToday ? "Later Today" : "Scheduled", items: games.filter((g) => g.state === "pre") },
    { key: "final", title: "Final", items: games.filter((g) => g.state === "final") },
  ].filter((g) => g.items.length > 0);
  const hasFinals = games.some((g) => g.state === "final");

  const scope =
    p.picked.length === 1
      ? (byPath(p.picked[0])?.label ?? "Sports")
      : p.picked.length > 1
        ? `${p.picked.length} leagues`
        : p.follows.leagues.length > 0
          ? "Following"
          : "All Sports";
  const subtitle = `${scope} · ${games.length} ${games.length === 1 ? "game" : "games"}`;

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const to = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!to) return;
    const i = tabs.findIndex((d) => d === day);
    const next = tabs[i + to];
    if (!next) return;
    e.preventDefault();
    setPicked(next.date.toDateString());
    e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[i + to]?.focus();
  };

  const card = (g: Game) =>
    isField(g) ? (
      g.sport === "golf" ? <GolfCard key={g.id} round={g} /> : <RaceCard key={g.id} race={g} />
    ) : isWeekend(g) ? (
      <WeekendCard key={g.id} weekend={g} />
    ) : isTournament(g) ? (
      <TournamentCard key={g.id} event={g} onOpen={p.onOpenTournament} />
    ) : p.compact && g.state === "final" ? (
      <CompactCard key={g.id} game={g} onOpen={p.onOpenGame} />
    ) : (
      <FluentGameCard key={g.id} game={g} onOpen={p.onOpenGame} />
    );

  const e = p.empty;
  return (
    <div className="sportsboard fl-sportsboard">
      <aside className="live-sidebar fl-aside">
        <FluentLeagues
          games={p.clubPool}
          follows={p.follows}
          onFollows={p.onFollows}
          picked={p.picked}
          onPick={p.onPick}
          onClearPicks={p.onClearPicks}
          counts={p.counts}
          rankedOnly={p.rankedOnly}
          onToggleRanked={p.onToggleRanked}
          reveal={p.reveal}
        />
      </aside>
      <div className="sports sportsboard__main fl-sports">
        <header className="fl-head">
          <div className="fl-head__text">
            <h1 className="fl-head__title">Sports</h1>
            <p className="fl-head__sub">{subtitle}</p>
          </div>
          <div className="fl-head__actions">
            {hasFinals && (
              <button type="button" className="fl-btn" aria-pressed={p.compact} onClick={p.onToggleCompact}>
                Compact Results
              </button>
            )}
            {p.multiview && (
              <button type="button" className="fl-btn" onClick={requestMultiview}>
                <MultiviewIcon size={16} />
                Multi-View
              </button>
            )}
            {p.redzone && (
              <button type="button" className="fl-btn" data-hint={p.redzone.name} onClick={() => requestWatchInPlayer(p.redzone!.id)}>
                <PlayIcon size={14} />
                Watch RedZone
              </button>
            )}
          </div>
        </header>

        <div className="fl-tabbar">
          {p.earlier.show && (
            <button
              type="button"
              className="fl-btn fl-btn--icon fl-tabbar__step fl-tabbar__step--earlier"
              disabled={p.earlier.state === "loading"}
              data-state={p.earlier.state}
              onClick={p.earlier.load}
              aria-label={p.earlier.state === "loading" ? "Loading…" : p.earlier.state === "error" ? "Couldn’t Load That. Try Again" : "Show Earlier Days"}
              title={p.earlier.state === "loading" ? "Loading…" : p.earlier.state === "error" ? "Couldn’t Load That. Try Again" : "Show Earlier Days"}
            >
              <ChevronIcon size={14} />
            </button>
          )}
          <div className="fl-tabs" role="tablist" aria-label="Day" onKeyDown={onTabKey}>
            {tabs.map((d) => (
              <button
                key={d.date.toDateString()}
                type="button"
                role="tab"
                className="fl-tab"
                aria-selected={d === day}
                tabIndex={d === day ? 0 : -1}
                onClick={() => setPicked(d.date.toDateString())}
              >
                {tabLabel(d.date)}
              </button>
            ))}
          </div>
          {p.more.show && (
            <button
              type="button"
              className="fl-btn fl-btn--icon fl-tabbar__step fl-tabbar__step--more"
              disabled={p.more.state === "loading"}
              data-state={p.more.state}
              onClick={p.more.load}
              aria-label={p.more.state === "loading" ? "Loading…" : p.more.state === "error" ? "Couldn’t Load Those. Try Again" : "Show More Days"}
              title={p.more.state === "loading" ? "Loading…" : p.more.state === "error" ? "Couldn’t Load Those. Try Again" : "Show More Days"}
            >
              <ChevronIcon size={14} />
            </button>
          )}
        </div>

        {(p.earlier.state === "error" || p.more.state === "error") && (
          <p className="fl-tabbar__err" role="alert">
            {p.earlier.state === "error" ? "Couldn’t load that." : "Couldn’t load those."}
            <button type="button" className="fl-link" onClick={p.earlier.state === "error" ? p.earlier.load : p.more.load}>
              Try Again
            </button>
          </p>
        )}

        {p.unlinked && (
          <p className="sports__unlinked" role="status">
            {p.unlinked === "no-playlist"
              ? "Add a playlist in Settings → Sources to match these to channels."
              : "None of these are on a channel in your playlist. Your provider doesn’t carry the networks showing it."}
          </p>
        )}

        {groups.map((g) => (
          <section key={g.key} className="fl-group" aria-label={g.title}>
            <h2 className="fl-caption fl-group__title">{g.title}</h2>
            <div className="sports__grid fl-grid">{g.items.map(card)}</div>
          </section>
        ))}

        {games.length === 0 && e.anything && (
          <SportsEmpty title="Nothing on This Day" note="Pick another day above." />
        )}
        {!e.anything &&
          (p.state === "loading" ? (
            <BoardSkeleton />
          ) : p.state === "error" ? (
            <SportsEmpty alert title="Couldn’t Reach the Schedule" note="It retries on its own." />
          ) : e.narrowed ? (
            <SportsEmpty
              title="Nothing Scheduled Yet"
              note={`${e.names} ${e.count === 1 ? "has" : "have"} ${
                e.reachFailed
                  ? "nothing on the board, and the schedule source did not answer when asked what is next. It retries on its own"
                  : e.teams > 0
                    ? "nothing on the schedule we can reach"
                    : "no fixtures published, not even further out"
              }.`}
              action={{ label: "Pick More Sports", onClick: e.onReveal }}
            />
          ) : (
            <SportsEmpty
              title="Nothing on Today"
              note={`None of the ${ALL_LEAGUES.length} leagues has a game scheduled today or tomorrow. Check back later.`}
            />
          ))}
      </div>
    </div>
  );
}

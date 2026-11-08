import { useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon, StarIcon } from "../../../ui/icons";
import { conferencesIn, POWER_FOUR } from "../../sports/conferences";
import {
  teamKey,
  toggleConference,
  toggleConferences,
  toggleLeague,
  toggleTeam,
  type Follows,
} from "../../sports/follows";
import { ALL_LEAGUES, SPORTS, searchLeagues, type CatalogLeague } from "../../sports/leagues";
import { isFixture, type Game } from "../../sports/model";

/** How long an armed remove stays armed (LeaguePicker's ARM_MS). */
const ARM_MS = 4000;

/** A league has no colour in the catalog, so its square takes a steady hue
 * from its path: the same league is the same colour every time. */
const hue = (path: string): number => {
  let h = 0;
  for (let i = 0; i < path.length; i++) h = (h * 31 + path.charCodeAt(i)) % 360;
  return h;
};

function Square({ path }: { path: string }) {
  return <span className="fl-swatch" aria-hidden style={{ background: `hsl(${hue(path)} 52% 46%)` }} />;
}

/**
 * Fluent's Sports leagues column: WinUI's list/details, as the Live TV
 * folders are. It drives the screen's own picking (a click narrows the board,
 * and it is multi-select) and follows (the star on a row). Teams and
 * conferences, which the classic sidebar has tabs for, sit under the sports
 * as two sections that open on demand.
 */
export function FluentLeagues({
  games,
  follows,
  onFollows,
  picked,
  onPick,
  onClearPicks,
  counts,
  rankedOnly,
  onToggleRanked,
  reveal,
}: {
  /** Every game the board loaded, for the club and conference lists. */
  games: Game[];
  follows: Follows;
  onFollows: (next: Follows) => void;
  picked: string[];
  onPick: (path: string) => void;
  onClearPicks: () => void;
  /** Today's games per league path. */
  counts: ReadonlyMap<string, number>;
  rankedOnly: boolean;
  onToggleRanked: () => void;
  /** The board's empty state asks for the leagues: bumped, so it can repeat. */
  reveal: number;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState({ teams: false, confs: false });
  const [arming, setArming] = useState<string | null>(null);
  const armTimer = useRef<number | undefined>(undefined);
  const filter = useRef<HTMLInputElement>(null);
  useEffect(() => () => window.clearTimeout(armTimer.current), []);
  const revealed = useRef(reveal);
  useEffect(() => {
    if (revealed.current === reveal) return;
    revealed.current = reveal;
    filter.current?.focus();
  }, [reveal]);

  const q = query.trim().toLowerCase();
  const matched = useMemo(() => new Set(searchLeagues(query).map((l) => l.path)), [query]);
  const sports = useMemo(
    () =>
      [...SPORTS]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => ({ sport: s, leagues: s.leagues.filter((l) => matched.has(l.path)) }))
        .filter((g) => g.leagues.length > 0),
    [matched],
  );
  const total = useMemo(() => [...counts.values()].reduce((a, b) => a + b, 0), [counts]);

  const clubs = useMemo(() => {
    const by = new Map<string, { key: string; name: string }>();
    for (const g of games) {
      if (!isFixture(g)) continue;
      for (const side of [g.home, g.away]) {
        const key = teamKey(g.leagueKey, side);
        if (!key || by.has(key)) continue;
        by.set(key, { key, name: side.shortName ?? side.name });
      }
    }
    return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [games]);
  const confs = useMemo(() => conferencesIn(games), [games]);
  const power = useMemo(() => POWER_FOUR.filter((k) => confs.some((c) => c.key === k)), [confs]);
  const powerOn = power.length > 0 && power.every((k) => follows.conferences.includes(k));
  const hit = (name: string) => !q || name.toLowerCase().includes(q);

  /** A followed star takes two clicks to remove, as a favourite tile does:
   * a stray one takes a league off the board and stops it being fetched. */
  const star = (path: string) => {
    window.clearTimeout(armTimer.current);
    if (follows.leagues.includes(path) && arming !== path) {
      setArming(path);
      armTimer.current = window.setTimeout(() => setArming(null), ARM_MS);
      return;
    }
    setArming(null);
    onFollows(toggleLeague(follows, path));
  };

  const row = (l: CatalogLeague) => {
    const on = picked.includes(l.path);
    const followed = follows.leagues.includes(l.path);
    const armed = arming === l.path;
    return (
      <div key={l.path} className={"fl-leaguerow" + (followed ? " is-followed" : "") + (armed ? " is-armed" : "")}>
        <button
          type="button"
          className="fl-nav"
          aria-pressed={on}
          aria-current={on ? "true" : undefined}
          aria-label={`Show only ${l.label}`}
          data-hint={l.name}
          onClick={() => onPick(l.path)}
        >
          <Square path={l.path} />
          <span className="fl-nav__name">{l.label}</span>
          {(counts.get(l.path) ?? 0) > 0 && <span className="fl-nav__count">{counts.get(l.path)}</span>}
        </button>
        <button
          type="button"
          className="fl-leaguerow__star"
          aria-pressed={followed}
          aria-label={
            armed
              ? `Click again to remove ${l.label} from favorites`
              : followed
                ? `Remove ${l.label} from favorites`
                : `Add ${l.label} to favorites`
          }
          onClick={() => star(l.path)}
        >
          {armed ? "Remove" : <StarIcon size={14} filled={followed} />}
        </button>
      </div>
    );
  };

  const toggleRow = (key: string, label: string, on: boolean, go: () => void) => (
    <button key={key} type="button" className="fl-nav" aria-pressed={on} aria-current={on ? "true" : undefined} onClick={go}>
      <span className="fl-nav__name">{label}</span>
      <StarIcon size={13} filled={on} className="fl-nav__flag" />
    </button>
  );

  const noPicks = picked.length === 0;
  return (
    <div className="fl-folders">
      <label className="fl-filter">
        <input
          ref={filter}
          type="search"
          placeholder="Filter leagues"
          aria-label="Filter leagues"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <SearchIcon size={14} className="fl-filter__icon" />
      </label>
      <nav className="fl-folders__list" aria-label="Leagues">
        {(!q || "following".includes(q)) && (
          <button
            type="button"
            className="fl-nav"
            aria-current={noPicks && follows.leagues.length > 0 ? "true" : undefined}
            onClick={onClearPicks}
          >
            <span className="fl-nav__glyph" aria-hidden><StarIcon size={16} /></span>
            <span className="fl-nav__name">Following</span>
            <span className="fl-nav__count">{follows.leagues.length}</span>
          </button>
        )}
        {(!q || "all sports".includes(q)) && (
          <button
            type="button"
            className="fl-nav"
            aria-current={noPicks && follows.leagues.length === 0 ? "true" : undefined}
            onClick={onClearPicks}
          >
            <span className="fl-nav__glyph" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1">
                <rect x="2" y="2" width="5" height="5" rx="1" />
                <rect x="9" y="2" width="5" height="5" rx="1" />
                <rect x="2" y="9" width="5" height="5" rx="1" />
                <rect x="9" y="9" width="5" height="5" rx="1" />
              </svg>
            </span>
            <span className="fl-nav__name">All Sports</span>
            <span className="fl-nav__count">{total}</span>
          </button>
        )}
        {sports.map(({ sport, leagues }) => (
          <section key={sport.key} className="fl-folders__group" aria-label={sport.name}>
            <h3 className="fl-caption">{sport.name}</h3>
            {leagues.map(row)}
          </section>
        ))}
        {sports.length === 0 && q && <p className="fl-folders__error">No leagues match. {ALL_LEAGUES.length} are listed.</p>}

        {clubs.filter((c) => hit(c.name)).length > 0 && (
          <section className="fl-folders__group" aria-label="Teams">
            <button
              type="button"
              className="fl-caption fl-caption--toggle"
              aria-expanded={open.teams || !!q}
              onClick={() => setOpen((o) => ({ ...o, teams: !o.teams }))}
            >
              Teams
            </button>
            {(open.teams || !!q) &&
              clubs
                .filter((c) => hit(c.name))
                .map((c) => toggleRow(c.key, c.name, follows.teams.includes(c.key), () => onFollows(toggleTeam(follows, c.key))))}
          </section>
        )}
        {confs.length > 0 && (
          <section className="fl-folders__group" aria-label="Conferences">
            <button
              type="button"
              className="fl-caption fl-caption--toggle"
              aria-expanded={open.confs || !!q}
              onClick={() => setOpen((o) => ({ ...o, confs: !o.confs }))}
            >
              Conferences
            </button>
            {(open.confs || !!q) && (
              <>
                {!q && (
                  <div className="fl-folders__pills">
                    {power.length > 0 && (
                      <button
                        type="button"
                        className="fl-chip"
                        aria-pressed={powerOn}
                        onClick={() => onFollows(toggleConferences(follows, power))}
                      >
                        Power 4
                      </button>
                    )}
                    <button type="button" className="fl-chip" aria-pressed={rankedOnly} onClick={onToggleRanked}>
                      Ranked
                    </button>
                  </div>
                )}
                {confs
                  .filter((c) => hit(c.label))
                  .map((c) =>
                    toggleRow(c.key, c.label, follows.conferences.includes(c.key), () =>
                      onFollows(toggleConference(follows, c.key)),
                    ),
                  )}
              </>
            )}
          </section>
        )}
      </nav>
    </div>
  );
}

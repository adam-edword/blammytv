import { useMemo, useState } from "react";
import { ModeRail, type RailMode } from "../../ui/ModeRail";
import { PanelIcon, RecentsIcon, StarIcon, TvIcon } from "../../ui/icons";
import { LEAGUE_NAMES, LEAGUES } from "./espn";
import {
  teamKey,
  toggleLeague,
  toggleTeam,
  type Follows,
} from "./follows";
import type { Game } from "./model";

type Mode = "leagues" | "teams" | "channels";

/* Placeholders, and Adam says so: the shapes are Live TV's, borrowed to get
 * the rail's geometry right while the real marks are drawn. */
const MODES: RailMode<Mode>[] = [
  { key: "leagues", label: "Leagues", icon: () => <TvIcon /> },
  { key: "teams", label: "Teams", icon: () => <StarIcon /> },
  { key: "channels", label: "Channels", icon: () => <RecentsIcon /> },
];

/**
 * The board's sidebar: what you follow, and therefore what the board shows.
 *
 * Live TV's sidebar, reused rather than reinvented — the same panel, the
 * same mode rail, the same rows. That is Adam's call and it is the right
 * one: this answers the same question Live's does ("narrow this to what I
 * care about"), so it should not be a second control that nearly matches.
 * The rail itself is now shared code; the classes below are still Live's,
 * which is a naming debt rather than a coupling one.
 *
 * FOLLOWING IS FILTERING, in the plan's own words ("filter by league and
 * team; the hub opens on what you follow"). Nothing followed means nothing
 * is narrowed, so an empty store shows the whole board and the feature has
 * no empty-screen failure mode to fall into on first run.
 */
export function SportsSidebar({
  games,
  follows,
  onFollows,
}: {
  /** Every game the board has loaded, for the club list. */
  games: Game[];
  follows: Follows;
  onFollows: (next: Follows) => void;
}) {
  const [mode, setMode] = useState<Mode>("leagues");
  const [collapsed, setCollapsed] = useState(false);

  /**
   * The clubs to offer, from the games the board actually loaded.
   *
   * Not a full league roster, which would need its own endpoint and its own
   * cache. The board holds today plus the next few days, so in season this
   * is most of a league; out of season it is honestly empty rather than a
   * list of clubs with nothing to follow them to.
   *
   * Deduped by follow key, because a club plays more than once across four
   * days and appears on both sides of the ledger.
   */
  const clubs = useMemo(() => {
    const by = new Map<string, { key: string; name: string; logo?: string }>();
    for (const g of games)
      for (const side of [g.home, g.away]) {
        const key = teamKey(g.leagueKey, side);
        // No id, no follow: see teamKey. Draw nothing rather than key a
        // saved preference on something that moves.
        if (!key || by.has(key)) continue;
        by.set(key, { key, name: side.shortName ?? side.name, logo: side.logo });
      }
    return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [games]);

  return (
    <aside
      className={
        "live-sidebar sportsside" + (collapsed ? " live-sidebar--collapsed" : "")
      }
    >
      <div className="live-sidebar__top">
        <button
          type="button"
          className="live-collapse"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
        >
          <PanelIcon />
        </button>
        {!collapsed && (
          <ModeRail modes={MODES} mode={mode} onChange={setMode} />
        )}
      </div>

      {!collapsed && mode === "leagues" && (
        <div className="live-sidebar__folders">
          {LEAGUES.map((l) => (
            <Row
              key={l.key}
              label={LEAGUE_NAMES[l.key]}
              on={follows.leagues.includes(l.key)}
              onClick={() => onFollows(toggleLeague(follows, l.key))}
            />
          ))}
        </div>
      )}

      {!collapsed && mode === "teams" && (
        <div className="live-sidebar__folders">
          {clubs.length > 0 ? (
            clubs.map((c) => (
              <Row
                key={c.key}
                label={c.name}
                logo={c.logo}
                on={follows.teams.includes(c.key)}
                onClick={() => onFollows(toggleTeam(follows, c.key))}
              />
            ))
          ) : (
            <p className="live-sidebar__note">
              Clubs appear here once there are games to follow them to.
            </p>
          )}
        </div>
      )}

      {!collapsed && mode === "channels" && (
        <p className="live-sidebar__note">
          Not built yet: what this lists is still an open question.
        </p>
      )}
    </aside>
  );
}

/** One followable thing. Live TV's folder row, unchanged: a mark, a name,
 * and an accent fill when it is on. */
function Row({
  label,
  logo,
  on,
  onClick,
}: {
  label: string;
  logo?: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={"live-folder" + (on ? " live-folder--active" : "")}
      aria-pressed={on}
      onClick={onClick}
    >
      {logo ? (
        <img className="sportsside__crest" src={logo} alt="" loading="lazy" />
      ) : (
        <TvIcon className="live-folder__icon" />
      )}
      <span className="live-folder__name">{label}</span>
    </button>
  );
}

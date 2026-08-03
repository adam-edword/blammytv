import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadSidebarCollapsed,
  saveSidebarCollapsed,
} from "../settings/sportsSidebar";
import { ModeRail, type RailMode } from "../../ui/ModeRail";
import {
  LeaguesIcon,
  PanelIcon,
  RecentsIcon,
  TeamsIcon,
  TvIcon,
} from "../../ui/icons";
import { teamKey, toggleTeam, type Follows } from "./follows";
import { LeaguePicker } from "./LeaguePicker";
import { isFixture } from "./model";
import type { Game } from "./model";

type Mode = "leagues" | "teams" | "channels";

/* Leagues and Teams have their own marks (v0.8.116). Channels still borrows
 * Live TV's, and deliberately: the tab is a stub and what it lists is still
 * an open question, so drawing an icon for it would be drawing a picture of
 * a decision nobody has made. */
const MODES: RailMode<Mode>[] = [
  { key: "leagues", label: "Leagues", icon: () => <LeaguesIcon /> },
  { key: "teams", label: "Teams", icon: () => <TeamsIcon /> },
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
  reveal,
}: {
  /** Every game the board has loaded, for the club list. */
  games: Game[];
  follows: Follows;
  onFollows: (next: Follows) => void;
  /**
   * A counter the board bumps to say "show them the leagues".
   *
   * The empty board offers a way out of a filter that is hiding everything
   * (see SportsEmpty), and that way out has to land on the Leagues tab
   * with the panel open, whatever the sidebar was doing before.
   *
   * A COUNTER rather than a boolean, the same shape SportsScreen already
   * uses for the Sports chip: pressing a button that is already satisfied
   * sets no state and so would do nothing the second time.
   */
  reveal?: number;
}) {
  const [mode, setMode] = useState<Mode>("leagues");
  // Read once and written on every toggle. Collapsing this is a statement
  // about how you want to use the screen, so it should outlive the visit.
  const [collapsed, setCollapsed] = useState(loadSidebarCollapsed);
  // Skips the mount, like the chip's own effect: arriving on the board is
  // not someone asking to be shown the leagues.
  const revealed = useRef(reveal);
  useEffect(() => {
    if (revealed.current === reveal) return;
    revealed.current = reveal;
    setMode("leagues");
    setCollapsed((was) => {
      if (!was) return was;
      saveSidebarCollapsed(false);
      return false;
    });
  }, [reveal]);

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
    for (const g of games) {
      // Only a fixture has clubs in it. A race weekend must not put twenty
      // drivers in a list headed "Teams", and a tournament must not put a
      // draw of singles players there either.
      if (!isFixture(g)) continue;
      for (const side of [g.home, g.away]) {
        const key = teamKey(g.leagueKey, side);
        // No id, no follow: see teamKey. Draw nothing rather than key a
        // saved preference on something that moves.
        if (!key || by.has(key)) continue;
        by.set(key, { key, name: side.shortName ?? side.name, logo: side.logo });
      }
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
          onClick={() =>
            setCollapsed((c) => {
              saveSidebarCollapsed(!c);
              return !c;
            })
          }
        >
          <PanelIcon />
        </button>
        {!collapsed && (
          <ModeRail modes={MODES} mode={mode} onChange={setMode} />
        )}
      </div>

      {/* THE PICKER, which used to be a grid of five tiles right here.
        *
        * Tiles are still the shape for a favourite and the reasoning has
        * not changed: a handful of leagues can afford a mark big enough to
        * recognise at a glance, and 146 of them cannot. What changed is
        * that the other 146 now have somewhere to be. See LeaguePicker. */}
      {!collapsed && mode === "leagues" && (
        <LeaguePicker follows={follows} onFollows={onFollows} />
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

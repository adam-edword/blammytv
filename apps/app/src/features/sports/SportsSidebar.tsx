import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadSidebarCollapsed,
  saveSidebarCollapsed,
} from "../settings/sportsSidebar";
import { ModeRail, type RailMode } from "../../ui/ModeRail";
import {
  ConferencesIcon,
  LeaguesIcon,
  PanelIcon,
  TeamsIcon,
  TvIcon,
} from "../../ui/icons";
import {
  teamKey,
  toggleConference,
  toggleConferences,
  toggleTeam,
  type Follows,
} from "./follows";
import { conferencesIn, POWER_FOUR } from "./conferences";
import { Hint } from "../../ui/Hint";
import { LeaguePicker } from "./LeaguePicker";
import { isFixture } from "./model";
import type { Game } from "./model";

type Mode = "leagues" | "teams" | "conferences";

/* Leagues and Teams, each with its own mark (v0.8.116).
 *
 * THERE IS NO CHANNELS TAB, and that is the v0.9.0 decision rather than an
 * oversight (plan 010 #17). It shipped as a rail entry that rendered "Not
 * built yet: what this lists is still an open question", wearing Live TV's
 * Recents icon because drawing one would have been drawing a picture of a
 * decision nobody had made. A headline release cannot carry a tab that says
 * that about itself.
 *
 * The question is still open and still worth answering: the sports channels
 * in your playlist, the channels matched to today's board, or the place
 * corrections get taught (#26). Answer it first, then bring the tab back
 * with a real icon. Re-adding the stub is not the same thing. */
const MODES: RailMode<Mode>[] = [
  { key: "leagues", label: "Leagues", icon: () => <LeaguesIcon /> },
  { key: "teams", label: "Teams", icon: () => <TeamsIcon /> },
];

/**
 * The rail with Conferences on it, built once rather than per render.
 *
 * A THIRD TAB THAT COMES AND GOES, which is unusual here and is the honest
 * shape: only college sport has conferences (ESPN carries no conference or
 * division on any professional competitor), so on an NFL Sunday this tab
 * would be a control with nothing in it and no way to put anything there.
 * The Teams tab can be empty and still make sense, because clubs arrive
 * when games do; a conference tab on a board with no college on it is
 * empty for a reason that will not change by waiting.
 */
const MODES_WITH_CONFS: RailMode<Mode>[] = [
  ...MODES,
  { key: "conferences", label: "Confs", icon: () => <ConferencesIcon /> },
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
  picked,
  onPick,
  onClearPicks,
  reveal,
  rankedOnly,
  onToggleRanked,
}: {
  /** Every game the board has loaded, for the club list. */
  games: Game[];
  follows: Follows;
  onFollows: (next: Follows) => void;
  /** What the board is narrowed to right now. See LeaguePicker. */
  picked: string[];
  onPick: (path: string) => void;
  onClearPicks: () => void;
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
  /** The board's Ranked filter, which lives on the Conferences tab because
   * that is the only place it applies. See rankedOnly. */
  rankedOnly: boolean;
  onToggleRanked: () => void;
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

  /**
   * The conferences to offer, from the games the board actually loaded.
   *
   * Same rule as the clubs above and for the same reason: the shipped table
   * knows 13 in college football and 31 in each college basketball league,
   * and a Tuesday in November has four of them playing. Offering all 75
   * would be a list of mostly dead chips.
   *
   * `conferencesIn` drops any id it cannot NAME, which is not a gap: the
   * college football board carries FCS opponents whose own conferences the
   * FBS sweep never named, and a chip reading "179" filters to something
   * nobody asked for.
   */
  const confs = useMemo(() => conferencesIn(games), [games]);
  /** Is the Power 4 preset worth offering? Only when the board has college
   * football on it — those five keys are that league's and nothing else's. */
  const power = useMemo(
    () => POWER_FOUR.filter((k) => confs.some((c) => c.key === k)),
    [confs],
  );
  const powerOn = power.length > 0 && power.every((k) =>
    follows.conferences.includes(k),
  );

  /**
   * Fall off the Conferences tab when the board stops having conferences.
   *
   * Narrow to the NFL while it is open and the tab disappears from the rail
   * underneath you, leaving `mode` pointing at a panel that renders nothing
   * and a rail with no active entry. Sending it back to Leagues is what the
   * rail would have done if the tab had never been there.
   */
  useEffect(() => {
    if (confs.length === 0) setMode((m) => (m === "conferences" ? "leagues" : m));
  }, [confs.length]);

  return (
    <aside
      className={
        "live-sidebar sportsside" + (collapsed ? " live-sidebar--collapsed" : "")
      }
    >
      <div className="live-sidebar__top">
        <Hint label={collapsed ? "Expand sidebar" : "Collapse sidebar"} side="right">
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
        </Hint>
        {!collapsed && (
          <ModeRail
            modes={confs.length > 0 ? MODES_WITH_CONFS : MODES}
            mode={mode}
            onChange={setMode}
          />
        )}
      </div>

      {/* THE PICKER, which used to be a grid of five tiles right here.
        *
        * Tiles are still the shape for a favourite and the reasoning has
        * not changed: a handful of leagues can afford a mark big enough to
        * recognise at a glance, and 146 of them cannot. What changed is
        * that the other 146 now have somewhere to be. See LeaguePicker. */}
      {!collapsed && mode === "leagues" && (
        <LeaguePicker
          follows={follows}
          onFollows={onFollows}
          picked={picked}
          onPick={onPick}
          onClearPicks={onClearPicks}
        />
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

      {!collapsed && mode === "conferences" && confs.length > 0 && (
        <div className="live-sidebar__folders">
          {/* THE TWO PRESETS, above the list because they are shortcuts
            * INTO it rather than entries in it. Both are pressed-state
            * buttons rather than checkboxes, the same shape the board's
            * Compact results toggle uses. */}
          <div className="sportsside__presets">
            {power.length > 0 && (
              <button
                type="button"
                className={
                  "sports__toggle sports__toggle--pill" +
                  (powerOn ? " is-on" : "")
                }
                aria-pressed={powerOn}
                onClick={() => onFollows(toggleConferences(follows, power))}
              >
                Power 4
              </button>
            )}
            {/* NOT A CONFERENCE, and it is on this tab because this is the
              * only board it can act on: a poll has no opinion about the
              * NFL. It intersects where the conferences union, which is
              * why it is a separate control rather than a chip in the list
              * below. */}
            <button
              type="button"
              className={
                "sports__toggle sports__toggle--pill" +
                (rankedOnly ? " is-on" : "")
              }
              aria-pressed={rankedOnly}
              onClick={onToggleRanked}
            >
              Ranked
            </button>
          </div>
          {confs.map((c) => (
            <Row
              key={c.key}
              label={c.label}
              on={follows.conferences.includes(c.key)}
              onClick={() => onFollows(toggleConference(follows, c.key))}
            />
          ))}
        </div>
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

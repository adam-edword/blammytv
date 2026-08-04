import { useEffect, useMemo, useRef, useState } from "react";
import {
  CloseIcon,
  StarGhostIcon,
  StarRainbowHollowIcon,
} from "../../ui/icons";
import { ALL_LEAGUES, SPORTS, league as byPath, searchLeagues } from "./leagues";
import { toggleLeague, type Follows } from "./follows";
import type { CatalogLeague } from "./leagues";

/**
 * The Leagues tab: what you follow, and the 151 you could (plan 010 #2).
 *
 * THE GATING ITEM, and what it unblocks is already built. The fetch
 * inversion made a followed league a fetched league over the whole
 * catalog; the sidebar then offered five tiles, so nothing anyone could
 * click reached the other 146. This is the door.
 *
 * Two shapes, one list, and the split is Adam's: favourites in the tile
 * grid up top, everything else in a single column under a rule, the way
 * the guide's source selector reads. That is not decoration. A tile is
 * expensive — a mark big enough to recognise at a glance — and it is worth
 * it for the handful you actually watch. 146 of them would be a wall you
 * scroll rather than a list you scan, and a row you read by name is the
 * right shape for those.
 */

/** How long an armed remove stays armed before it forgets. Settings'
 * playlist delete uses the same four seconds. */
const ARM_MS = 4000;

export function LeaguePicker({
  follows,
  onFollows,
  picked,
  onPick,
  onClearPicks,
}: {
  follows: Follows;
  onFollows: (next: Follows) => void;
  /**
   * The leagues the board is NARROWED to right now, which is not the same
   * thing as the ones you follow.
   *
   * Adam's, and it fixes a real collision: clicking a row and clicking its
   * heart both favourited it, so the row and the affordance inside it did
   * the same job and the picker had no way to say "just show me this".
   * Following is what you keep; picking is what you are looking at.
   *
   * Not persisted, deliberately. A narrowing you set on Tuesday should not
   * still be hiding half the board on Friday, where a favourite should.
   */
  picked: string[];
  onPick: (path: string) => void;
  /** Drop the whole narrowing at once. See the button below. */
  onClearPicks: () => void;
}) {
  const [query, setQuery] = useState("");
  /** The favourite whose ✕ has been clicked once. See the tile below. */
  const [arming, setArming] = useState<string | null>(null);
  const armTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(armTimer.current), []);

  /**
   * The search, run ONCE over the whole catalog and then split.
   *
   * Both sections filter, which is what Adam asked for and is the only
   * behaviour that makes sense: a search that emptied the favourites grid
   * while filling the column below would read as "you do not follow any
   * hockey" when the answer is on screen two rows up.
   */
  const hits = useMemo(() => searchLeagues(query), [query]);
  const matched = useMemo(() => new Set(hits.map((l) => l.path)), [hits]);

  /**
   * Favourites in the order they were added, not alphabetically.
   *
   * The store is append-ordered, so the newest lands at the end where it
   * can be seen arriving. Unresolvable paths drop out, which is the same
   * rule the board applies: a catalog regeneration can retire a league.
   */
  const favourites = useMemo(
    () =>
      follows.leagues
        .map(byPath)
        .filter((l): l is CatalogLeague => l !== undefined)
        .filter((l) => matched.has(l.path)),
    [follows.leagues, matched],
  );
  /**
   * Everything else, GROUPED BY SPORT.
   *
   * Adam's, and the numbers make the case: 107 of the 151 leagues are
   * soccer, so one alphabetical list buries the other 44 inside a wall.
   * "Ice Hockey" with four rows under it is a thing you can find by
   * scrolling; four hockey leagues scattered between "Chinese Super
   * League" and "Copa Libertadores" are not.
   *
   * Sports ALPHABETICALLY, not in the catalog's own biggest-first order.
   * That order is right for a ranking and wrong for a search: biggest
   * first puts soccer's 107 rows before everything else, so reaching any
   * other sport means scrolling past all of them. Alphabetical puts Soccer
   * eleventh of fourteen, where its size costs nobody anything, and makes
   * where a sport sits predictable rather than something you learn.
   *
   * Leagues keep the catalog's order inside a group, which is already
   * alphabetical.
   */
  const groups = useMemo(() => {
    const favourite = new Set(follows.leagues);
    return [...SPORTS]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((sport) => ({
        sport,
        leagues: sport.leagues.filter(
          (l) => matched.has(l.path) && !favourite.has(l.path),
        ),
      }))
      .filter((g) => g.leagues.length > 0);
  }, [matched, follows.leagues]);

  const toggle = (path: string) => {
    window.clearTimeout(armTimer.current);
    setArming(null);
    onFollows(toggleLeague(follows, path));
  };

  /** First click arms, second removes, and it forgets after ARM_MS. */
  const armOrRemove = (path: string) => {
    if (arming !== path) {
      setArming(path);
      window.clearTimeout(armTimer.current);
      armTimer.current = window.setTimeout(() => setArming(null), ARM_MS);
      return;
    }
    toggle(path);
  };

  const searching = query.trim().length > 0;

  return (
    <div className="leaguepick">
      <input
        className="settings-input leaguepick__search"
        type="search"
        value={query}
        placeholder="Search leagues and sports…"
        aria-label="Search leagues and sports"
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setQuery(e.target.value)}
      />

      {favourites.length > 0 ? (
        <div className="sportsside__tiles">
          {favourites.map((l) => (
            <FavouriteTile
              key={l.path}
              league={l}
              armed={arming === l.path}
              on={picked.includes(l.path)}
              onPick={() => onPick(l.path)}
              onArm={() => armOrRemove(l.path)}
            />
          ))}
        </div>
      ) : (
        <p className="live-sidebar__note">
          {searching
            ? "No favourites match."
            : /* Not an error, and the opposite of an empty board: with
               * nothing picked the hub shows every league that has anything
               * on. Saying so is the point — the board behind this panel is
               * deliberately more than anyone wants, and this is the line
               * that explains why and what to do about it. */
              `No favourites yet, so all ${ALL_LEAGUES.length} leagues are on the board. Pick the ones you follow to narrow it.`}
        </p>
      )}

      {/* THE WAY OUT OF A NARROWING, and it sits here because here is
        * where you are when you want it. Adam's: "scrolling all the way
        * down to tennis to unclick it is not elegant" — and he is right,
        * the only way to clear a pick was to find the row you picked,
        * which for one of 151 leagues can be a long way down a scroller.
        *
        * Only when there is something to clear, and it counts, because
        * "Clear" on its own does not say how much you are about to undo
        * when the picks are scrolled out of sight. */}
      {picked.length > 0 && (
        <button
          type="button"
          className="leaguepick__clear"
          onClick={onClearPicks}
        >
          Clear filter
          <span className="leaguepick__clearcount">{picked.length}</span>
        </button>
      )}

      {/* The rule between the two shapes, which is the whole of the
        * layout's argument: above it is what you watch, below it is what
        * exists. */}
      <hr className="leaguepick__rule" />

      <div className="live-sidebar__folders leaguepick__all">
        {groups.length > 0 ? (
          groups.map(({ sport, leagues }) => (
            <div className="leaguepick__group" key={sport.key}>
              {/* Sticky, so the sport you are inside is still named when
                * you are forty rows into it. Soccer is 107 of them. */}
              <h4 className="leaguepick__sport">{sport.name}</h4>
              {leagues.map((l) => (
                <span className="live-folder-row leaguepick__row" key={l.path}>
                  {/* The row NARROWS the board to this league; the star
                    * beside it follows it. Exactly Live's split, where the
                    * row filters and the eye hides, and the fix for these
                    * two having previously done the same thing. */}
                  <button
                    type="button"
                    className={
                      "live-folder" +
                      (picked.includes(l.path) ? " live-folder--active" : "")
                    }
                    title={l.name}
                    aria-pressed={picked.includes(l.path)}
                    aria-label={`Show only ${l.label}`}
                    onClick={() => onPick(l.path)}
                  >
                    <LeagueMark league={l} className="leaguepick__mark" />
                    <span className="live-folder__name">{l.label}</span>
                  </button>
                  {/* The guide's hover-eye slot, to the pixel, carrying a
                    * heart instead. Same reveal rules: hidden until the
                    * row is hovered or anything in it has focus. */}
                  <button
                    type="button"
                    className="live-folder__hide leaguepick__fav"
                    aria-label={`Add ${l.label} to favourites`}
                    title={`Add ${l.label} to favourites`}
                    onClick={() => toggle(l.path)}
                  >
                    {/* The guide's own star and its own swap: the ghost
                      * while the row is hovered, the rainbow ring once the
                      * star itself is. Adam's, and it is the right call —
                      * this means the same thing the guide's does, so a
                      * second mark for it was a difference with no
                      * meaning. Two elements and a CSS display flip,
                      * because a :hover in JS would need a listener per
                      * row. */}
                    <StarGhostIcon className="guide__fav-idle" />
                    <StarRainbowHollowIcon className="guide__fav-hot" />
                  </button>
                </span>
              ))}
            </div>
          ))
        ) : (
          <p className="live-sidebar__note">
            {searching ? "Nothing else matches." : "Every league is a favourite."}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * One favourite, as a tile with a way out.
 *
 * TWO CLICKS, which is Adam's and is right for the control it is: a
 * mis-click here does not lose a preference, it takes a league off your
 * board and stops it being fetched. The ✕ expands into the whole sentence
 * rather than into "Sure?", because a pill that says what it is about to
 * do can be read without remembering what was clicked.
 *
 * The mechanism is the one Settings already uses on a playlist delete,
 * four second timeout included: an armed control that stays armed is a
 * trap for the next person to walk past the screen.
 */
function FavouriteTile({
  league,
  armed,
  on,
  onPick,
  onArm,
}: {
  league: CatalogLeague;
  armed: boolean;
  /** Narrowed to this one right now. */
  on: boolean;
  onPick: () => void;
  onArm: () => void;
}) {
  return (
    <span className={"leaguetile" + (on ? " leaguetile--on" : "")}>
      {/* A tile narrows, the same as a row: it is the same league in a
        * different shape, so it must not be a different verb. Removing it
        * from favourites is the small control in the corner. */}
      <button
        type="button"
        className="leaguetile__pick"
        aria-pressed={on}
        aria-label={`Show only ${league.label}`}
        onClick={onPick}
      >
        <LeagueMark league={league} className="leaguetile__mark" />
        <span className="leaguetile__name">{league.label}</span>
      </button>
      <button
        type="button"
        className={"leaguepick__x" + (armed ? " leaguepick__x--armed" : "")}
        aria-label={
          armed
            ? `Click again to remove ${league.label} from favourites`
            : `Remove ${league.label} from favourites`
        }
        onClick={onArm}
      >
        {armed ? "Remove from Favorites" : <CloseIcon />}
      </button>
    </span>
  );
}

/**
 * A league's mark, or its initial.
 *
 * TWO failures, and only one of them was handled. A league with no `logo`
 * at all fell back to a tv icon; a league whose logo URL is dead rendered
 * the browser's torn-picture box, which is what Adam saw on Concacaf. The
 * catalog was generated by asking ESPN, so every row HAS a URL — the ones
 * that break are the ones whose art has since moved.
 *
 * Both fall back to the same thing now, and the tv icon is gone: a
 * television on a league row never meant anything, where an initial is at
 * least the league's own. Same shape the guide uses for channel logos and
 * Stream uses for posters, down to resetting `broken` when the URL
 * changes.
 */
function LeagueMark({
  league,
  className,
}: {
  league: CatalogLeague;
  className: string;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [league.logo]);
  return (
    <span className={className} aria-hidden>
      {league.logo && !broken ? (
        <img
          className="leaguepick__img"
          src={league.logo}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setBroken(true)}
        />
      ) : (
        league.label[0]
      )}
    </span>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { CloseIcon, FavoriteHeartIcon, TvIcon } from "../../ui/icons";
import { DEFAULT_LEAGUES } from "./espn";
import { league as byPath, searchLeagues } from "./leagues";
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
}: {
  follows: Follows;
  onFollows: (next: Follows) => void;
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
  const rest = useMemo(
    () => hits.filter((l) => !follows.leagues.includes(l.path)),
    [hits, follows.leagues],
  );

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
              onArm={() => armOrRemove(l.path)}
            />
          ))}
        </div>
      ) : (
        <p className="live-sidebar__note">
          {searching
            ? "No favourites match."
            : /* Not an error, and not nothing on the board either: an
               * empty store still fetches the default set, so saying
               * "none" without saying that would read as a broken tab. */
              `No favourites yet. ${DEFAULT_LEAGUES.length} leagues are on by default until you pick.`}
        </p>
      )}

      {/* The rule between the two shapes, which is the whole of the
        * layout's argument: above it is what you watch, below it is what
        * exists. */}
      <hr className="leaguepick__rule" />

      <div className="live-sidebar__folders">
        {rest.length > 0 ? (
          rest.map((l) => (
            <span className="live-folder-row leaguepick__row" key={l.path}>
              {/* The whole row favourites it, and the heart says so.
                * Live's rows work differently — there the row filters and
                * the eye hides, two actions — but here there is only one
                * thing to do with a league you do not follow, so the big
                * target and the small affordance agree. */}
              <button
                type="button"
                className="live-folder"
                title={l.name}
                aria-label={`Add ${l.label} to favourites`}
                onClick={() => toggle(l.path)}
              >
                {l.logo ? (
                  <img className="leaguepick__mark" src={l.logo} alt="" loading="lazy" />
                ) : (
                  <TvIcon className="live-folder__icon" />
                )}
                <span className="live-folder__name">{l.label}</span>
              </button>
              {/* The guide's hover-eye slot, to the pixel, carrying a
                * heart instead. Same reveal rules: hidden until the row is
                * hovered or anything in it has keyboard focus. */}
              <button
                type="button"
                className="live-folder__hide leaguepick__fav"
                aria-label={`Add ${l.label} to favourites`}
                title={`Add ${l.label} to favourites`}
                onClick={() => toggle(l.path)}
              >
                <FavoriteHeartIcon />
              </button>
            </span>
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
  onArm,
}: {
  league: CatalogLeague;
  armed: boolean;
  onArm: () => void;
}) {
  return (
    <span className="leaguetile">
      <img className="leaguetile__mark" src={league.logo} alt="" loading="lazy" />
      <span className="leaguetile__name">{league.label}</span>
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

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { loadFavorites } from "../live/favorites";
import { loadRecents } from "../live/recents";
import { loadLive } from "../live/source";
import { useLiveData } from "../live/useLiveData";
import { listNow, watch as watchRecordings, type Recording } from "../recordings/store";
import { loadClockFormat, onClockFormatChange, type ClockFormat } from "../settings/clockFormat";
import { onPlaylistsChange } from "../settings/playlists";
import { loadRankedOnly } from "../settings/rankedOnly";
import { hasLivePlaylist } from "../settings/startupSources";
import { useCatalog } from "../sports/catalog";
import { fetchList, loadFollows, resolvable } from "../sports/follows";
import { ALL_LEAGUES } from "../sports/leagues";
import type { Fixture } from "../sports/model";
import { useGames, withChannels } from "../sports/useGames";
import type { HomeRow, LiveKind } from "./layout";
import { channelCards, followsAny, homeGames, playable, publishGamesToday, type ChannelCard } from "./liveData";

/**
 * The data behind Home's live rows (plan 033, phase 2), read only for a row
 * that is on and only while Home is showing: a row that is off, or a Home that
 * is not up, reads nothing and polls nothing. The rows themselves are
 * LiveRows.tsx.
 */

export interface LiveRowsData {
  onNow: ChannelCard[];
  recent: ChannelCard[];
  games: Fixture[];
  recordings: Recording[];
  now: Date;
  clock: ClockFormat;
  /** A row that is on has not answered yet: the channel catalog is still
   * loading, or ESPN has not replied. Home says it is loading rather than
   * that it is empty, until every row that is on has answered. */
  pending: boolean;
}

/** Whether a live row has anything to draw. Only a row that is on has data. */
export function liveHas(kind: HomeRow["kind"], d: LiveRowsData): boolean {
  switch (kind) {
    case "onnow":
      return d.onNow.length > 0;
    case "recent":
      return d.recent.length > 0;
    case "games":
      return d.games.length > 0;
    case "recordings":
      return d.recordings.length > 0;
    default:
      return false;
  }
}

/** Whether a live source is set up: an enabled playlist, as the nav asks. */
export function useLiveSource(): boolean {
  const [live, setLive] = useState(hasLivePlaylist);
  useEffect(() => onPlaylistsChange(() => setLive(hasLivePlaylist())), []);
  return live;
}

const never = () => () => {};

/**
 * The live rows' data. `layout` is Home's rows (none on Stream's own page);
 * a kind is read only when its row is on, and none at all without a live
 * source, so on Stream, off, or with no playlist this is inert.
 *
 * Today's Games follows the Sports board: what you follow is what is asked
 * for. The board with nothing followed is every league in the catalog, which
 * on Home would be 151 requests for a row, so nothing followed is no row.
 * It reads through `useGames` as the board does, so there is one reader of
 * the scores (the board is not mounted while Home is) and the same 90-second
 * refresh, for today alone.
 */
export function useLiveRows(layout: readonly HomeRow[] | undefined, live: boolean): LiveRowsData {
  const wants = (k: LiveKind) => live && !!layout?.some((r) => r.kind === k && r.on);
  const wantNow = wants("onnow");
  const wantRecent = wants("recent");
  const wantGames = wants("games");
  // Recordings are files on this PC: they play with no playlist set up.
  const wantRecs = !!layout?.some((r) => r.kind === "recordings" && r.on);
  const wantChannels = wantNow || wantRecent;

  // ---- channels
  const data = useLiveData(wantChannels);
  // Whether the catalog's load has settled, if it failed too: without it
  // `data` stays null and a failure reads as "still loading" for good.
  // loadLive is single-flighted, so this joins the load useLiveData started.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!wantChannels) return;
    let alive = true;
    const done = () => alive && setSettled(true);
    void loadLive(new Date()).then(done, done);
    return () => {
      alive = false;
    };
  }, [wantChannels]);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!wantChannels && !wantRecs) return;
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, [wantChannels, wantRecs]);
  const [clock, setClock] = useState(loadClockFormat);
  useEffect(() => onClockFormatChange(setClock), []);
  const favourites = useMemo(() => (wantNow ? loadFavorites() : []), [wantNow]);
  const recents = useMemo(() => (wantRecent ? loadRecents() : []), [wantRecent]);
  const onNow = useMemo(() => (wantNow ? channelCards(favourites, data, now) : []), [wantNow, favourites, data, now]);
  const recent = useMemo(() => (wantRecent ? channelCards(recents, data, now) : []), [wantRecent, recents, data, now]);

  // ---- recordings
  const recs = useSyncExternalStore(wantRecs ? watchRecordings : never, listNow);
  const recordings = useMemo(() => (wantRecs ? playable(recs) : []), [wantRecs, recs]);

  // ---- games
  // Read once per visit, as the board reads them at mount.
  const follows = useMemo(() => resolvable(loadFollows(), ALL_LEAGUES.map((l) => l.path)), []);
  const asking = wantGames && followsAny(follows);
  const leagues = useMemo(() => (asking ? fetchList(follows) : []), [asking, follows]);
  const { days, state: boardState } = useGames(leagues, 1, asking ? follows.teams : [], false, false, asking);
  const catalog = useCatalog(asking);
  const rankedOnly = useMemo(loadRankedOnly, []);
  const today = days[0]?.games;
  const games = useMemo(
    () => (asking && today ? homeGames(withChannels(today, catalog), follows, rankedOnly) : []),
    [asking, today, catalog, follows, rankedOnly],
  );
  // Settings → Home says why this row is empty, from what was counted here:
  // not known (null) until the board has answered, and not while it is off.
  const answered = asking && !!today;
  useEffect(() => {
    publishGamesToday(answered ? games.length : null);
    return () => publishGamesToday(null);
  }, [answered, games.length]);

  const pending = (wantChannels && !data && !settled) || (asking && boardState === "loading");

  return { onNow, recent, games, recordings, now, clock, pending };
}

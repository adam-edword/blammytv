import { useMemo, useState, type CSSProperties } from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { Dialog, DialogContent, DialogTitle } from "../../components/ui/dialog";
import { ChannelLogo } from "../../ui/ChannelLogo";
import { EASE_OUT, lastInputWasKey } from "./mvMotion";
import { REDUCED_MOTION } from "../../lib/reducedMotion";
import { airing } from "./mvTile";
import { channelIndex, leftLine, searchChannels, type Pick, type Room } from "./mvGrid";
import { loadFavorites } from "./favorites";
import { fillFrom, gameLabel } from "./mvGames";
import { isFollowed, loadFollows } from "../sports/follows";
import { loadRecents } from "./recents";
import { Matchup } from "../sports/Matchup";
import { QualityBadge } from "../../ui/QualityBadge";
import { CheckIcon, PlusIcon, SearchIcon } from "../../ui/icons";
import { formatClock } from "../../lib/time";
import { loadClockFormat } from "../settings/clockFormat";
import type { Channel, LiveData } from "./model";
import type { Fixture } from "../sports/model";
import { EYEBROW } from "../../ui/eyebrow";

/**
 * The channel picker (plan 017, P3; decision M3): a search-first palette
 * over the dimmed grid, in place of the rail that sat beside it.
 *
 * Built from Base UI's own command-palette recipe (docs/react/components/
 * autocomplete.md): an Autocomplete rendered `inline open` inside a dialog,
 * so the list, its keyboard (arrows move, Enter takes, Escape closes) and
 * its screen-reader wiring are the library's rather than ours. The dialog
 * is the app's Radix one, which traps focus and gives Escape to the picker
 * before the app's own full-screen handler sees it.
 *
 * Before typing it offers the live games Sports last saw, your favourites
 * and what you watched recently. Typing searches every channel. A channel
 * already in the grid says so and cannot be taken twice.
 */

export type PickerMode = { kind: "add" } | { kind: "replace"; id: string; name: string };

type Row =
  | { key: string; kind: "game"; channelId: string; label: string; game: Fixture; channel?: Channel }
  | { key: string; kind: "channel"; channelId: string; label: string; channel: Channel }
  /** "Fill with live games" (M9): one row, so Enter reaches it like any other. */
  | { key: string; kind: "fill"; channelId: ""; label: string; games: Fixture[]; followed: boolean };

interface Section {
  value: string;
  items: Row[];
}

/** How many favourites and recents show before typing. */
const SHORTLIST = 8;

const channelRow = (c: Channel): Row => ({
  key: `c:${c.id}`,
  kind: "channel",
  channelId: c.id,
  label: c.name,
  channel: c,
});

export function MultiviewPicker({
  open,
  onOpenChange,
  mode,
  live,
  games,
  inGrid,
  room,
  onChoose,
  onFill,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: PickerMode;
  live: LiveData | null;
  /** Live games on your channels (mvGames). */
  games: Fixture[];
  /** Channel ids already on the grid. */
  inGrid: ReadonlySet<string>;
  room: Room;
  onChoose: (pick: Pick) => void;
  /** Fill the grid with these games, in this order. */
  onFill: (games: Fixture[]) => void;
  /** Where focus goes as it closes: the tab's, since it opens from code and
   * has no trigger of its own for Radix to go back to (plan 018, U1). */
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const [query, setQuery] = useState("");
  const [clock] = useState(loadClockFormat);
  const now = new Date();

  /**
   * A fresh dialog for every opening.
   *
   * The overlay fades in 150ms and the picker in 200, and reopening a Radix
   * Dialog inside that gap (Escape, then a quick click on Add) went wrong
   * two ways, both caught by verify-mvtile about one run in four. The
   * closing picker's outside-press dismissal, which Radix holds until the
   * click, shut the picker that same click had just reopened. Or the
   * overlay, in its own portal, came back as the last thing on the page,
   * on top of a picker still fading, and its rows could not be clicked. A
   * new key drops the fading one at once, listeners, overlay and all.
   */
  const [wasOpen, setWasOpen] = useState(open);
  const [opening, setOpening] = useState(0);
  // Opened or closed from the keyboard (A, R, Escape, Enter on a row), it
  // appears and goes at once (plan 017, "Keyboard"). Decided as it opens or
  // closes and held, so typing in it does not restart its entrance.
  const [instant, setInstant] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    setInstant(lastInputWasKey());
    // Every opening starts from an empty search. Only the dialog's own
    // close cleared it, so after a pick (which closes it from outside) the
    // next Add opened on the last search (plan 018, P3). Cleared as it
    // opens rather than as it closes, so the closing one keeps its rows
    // while it fades.
    if (open) {
      setOpening((n) => n + 1);
      setQuery("");
    }
  }
  // Otherwise the plan's timing, not the shared Dialog's: from 0.98 rather
  // than 0.95, 200ms in on the strong ease-out and 150ms out. Reduced motion
  // keeps index.css's guard, which zeroes the scale and keeps the fade.
  const motion: CSSProperties = instant
    ? { animation: "none" }
    : ({
        "--tw-animation-duration": open ? "200ms" : "150ms",
        "--tw-ease": EASE_OUT,
        ...(REDUCED_MOTION ? {} : { "--tw-enter-scale": "0.98", "--tw-exit-scale": "0.98" }),
      } as CSSProperties);

  const sections = useMemo((): Section[] => {
    // Closed, it lists nothing: this ran on every render of the tab, the
    // clock's tick and every volume notch included (plan 018, P3).
    if (!live || !open) return [];
    const byId = channelIndex(live, false);
    const q = query.trim().toLowerCase();
    const gameRows = games
      .filter((g) => g.channels[0])
      .filter(
        (g) =>
          !q ||
          [g.home.name, g.home.shortName, g.away.name, g.away.shortName]
            .filter(Boolean)
            .some((n) => n!.toLowerCase().includes(q)),
      )
      .map(
        (g): Row => ({
          key: `g:${g.id}`,
          kind: "game",
          channelId: g.channels[0].id,
          label: gameLabel(g),
          game: g,
          channel: byId.get(g.channels[0].id),
        }),
      );
    // What you can still add comes first in each section. The list
    // highlights its first row and Enter takes it, and a first row that was
    // already in the grid (so, disabled) left Enter doing nothing.
    const addableFirst = (rows: Row[]) => [
      ...rows.filter((r) => !inGrid.has(r.channelId)),
      ...rows.filter((r) => inGrid.has(r.channelId)),
    ];
    const out: Section[] = [];
    // A section with nothing left to add goes last, so the row the picker
    // opens highlighting is one Enter can take. Every Favorite already on
    // the grid used to open it on a disabled row (plan 018, U10).
    const spent = (sec: Section) => sec.items.every((r) => r.kind !== "fill" && inGrid.has(r.channelId));
    const spentLast = (secs: Section[]) => [...secs.filter((x) => !spent(x)), ...secs.filter(spent)];
    // One action, not a preset system (M9): fill what the line has room
    // for, the games you follow first. Offered only when it would add one.
    const follows = loadFollows();
    const fill = mode.kind === "add" && !q ? fillFrom(games, inGrid, room.left, follows) : [];
    const fillRow: Row[] = fill.length
      ? [
          {
            key: "fill",
            kind: "fill",
            channelId: "",
            label: "Fill with live games",
            games: fill,
            // "The ones you follow first" only when one of them is.
            followed: fill.some((g) => isFollowed(g, follows)),
          },
        ]
      : [];
    if (gameRows.length)
      out.push({ value: "Live games", items: [...fillRow, ...addableFirst(gameRows)] });
    if (q) {
      const found = searchChannels(live, q).map(channelRow);
      if (found.length) out.push({ value: "Channels", items: addableFirst(found) });
      return spentLast(out);
    }
    const favs = loadFavorites()
      .map((id) => byId.get(id))
      .filter((c): c is Channel => !!c)
      .slice(0, SHORTLIST);
    if (favs.length) out.push({ value: "Favorites", items: addableFirst(favs.map(channelRow)) });
    const favIds = new Set(favs.map((c) => c.id));
    const recent = loadRecents()
      .filter((id) => !favIds.has(id))
      .map((id) => byId.get(id))
      .filter((c): c is Channel => !!c)
      .slice(0, SHORTLIST);
    if (recent.length) out.push({ value: "Recent", items: addableFirst(recent.map(channelRow)) });
    return spentLast(out);
    // `now` is left out on purpose: the rows' "what is on" is read at render.
  }, [open, live, games, query, inGrid, mode.kind, room.left]);

  const choose = (row: Row) => {
    if (row.kind === "fill") {
      onFill(row.games);
      return;
    }
    if (inGrid.has(row.channelId)) return;
    onChoose(
      row.kind === "game"
        ? {
            channelId: row.channelId,
            label: row.label,
            gameId: row.game.id,
            league: row.game.leagueKey,
            start: row.game.start.getTime(),
          }
        : { channelId: row.channelId, label: row.label },
    );
  };

  const title = mode.kind === "replace" ? `Replace ${mode.name}` : "Add a channel";

  return (
    <Dialog
      key={opening}
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="mvpick top-[96px] translate-y-0 gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[640px]"
        style={motion}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <Autocomplete.Root
          open
          inline
          mode="none"
          items={sections}
          value={query}
          onValueChange={setQuery}
          itemToStringValue={(r: Row) => r.label}
          autoHighlight="always"
          keepHighlight
        >
          <div className="mvpick__head">
            <SearchIcon size={19} aria-hidden />
            <Autocomplete.Input
              className="mvpick__input"
              placeholder="Search your channels"
              aria-label="Search your channels"
            />
            <span className="mvpick__target">
              {mode.kind === "replace" ? `Replaces ${mode.name}` : null}
            </span>
          </div>

          <div className="mvpick__body">
            <Autocomplete.Empty>
              <p className="mvpick__empty">
                {!live
                  ? "Loading your channels…"
                  : query.trim()
                    ? "Nothing matches that."
                    : "Type to find a channel."}
              </p>
            </Autocomplete.Empty>
            <Autocomplete.List>
              {(section: Section) => (
                <Autocomplete.Group key={section.value} items={section.items} className="mvpick__group">
                  <Autocomplete.GroupLabel className={`mvpick__sec ${EYEBROW}`}>{section.value}</Autocomplete.GroupLabel>
                  <Autocomplete.Collection>
                    {(row: Row) => {
                      const taken = inGrid.has(row.channelId);
                      return (
                        <Autocomplete.Item
                          key={row.key}
                          value={row}
                          disabled={taken}
                          onClick={() => choose(row)}
                          className="mvpick__row"
                        >
                          {row.kind === "fill" ? (
                            <FillRow row={row} />
                          ) : row.kind === "game" ? (
                            <GameRow row={row} />
                          ) : (
                            <ChannelRow
                              channel={row.channel}
                              live={live}
                              now={now}
                              clock={clock}
                            />
                          )}
                          {taken && (
                            <span className="mvpick__ingrid">
                              <CheckIcon size={14} />
                              In the grid
                            </span>
                          )}
                        </Autocomplete.Item>
                      );
                    }}
                  </Autocomplete.Collection>
                </Autocomplete.Group>
              )}
            </Autocomplete.List>
          </div>

          <div className="mvpick__foot">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd>
              move
            </span>
            <span>
              <kbd>↵</kbd>
              {mode.kind === "replace" ? "replace" : "add"}
            </span>
            <span>
              <kbd>esc</kbd>
              close
            </span>
            <span className="mvpick__left">
              {mode.kind === "replace" ? "Same place, same sound" : leftLine(room)}
            </span>
          </div>
        </Autocomplete.Root>
      </DialogContent>
    </Dialog>
  );
}

function ChannelRow({
  channel,
  live,
  now,
  clock,
}: {
  channel: Channel;
  live: LiveData | null;
  now: Date;
  clock: ReturnType<typeof loadClockFormat>;
}) {
  const on = airing(live?.programmes.get(channel.id), now).now;
  const sub = [
    channel.number != null ? String(channel.number) : null,
    on?.title ?? null,
    on ? `until ${formatClock(on.end, clock)}` : null,
  ].filter(Boolean);
  return (
    <>
      <ChannelLogo name={channel.name} logo={channel.logo} size={34} />
      <span className="mvpick__meta">
        <span className="mvpick__name">
          <span className="mvpick__nametext">{channel.name}</span>
          {channel.quality && <QualityBadge quality={channel.quality} />}
        </span>
        {sub.length > 0 && <span className="mvpick__sub">{sub.join(" · ")}</span>}
      </span>
    </>
  );
}

function FillRow({ row }: { row: Extract<Row, { kind: "fill" }> }) {
  const n = row.games.length;
  return (
    <>
      <span className="mvpick__fillicon" aria-hidden>
        <PlusIcon size={16} />
      </span>
      <span className="mvpick__meta">
        <span className="mvpick__name">{row.label}</span>
        <span className="mvpick__sub">
          Adds {n === 1 ? "1 game" : `${n} games`}
          {row.followed ? ", the ones you follow first" : ""}
        </span>
      </span>
    </>
  );
}

function GameRow({ row }: { row: Extract<Row, { kind: "game" }> }) {
  return (
    <>
      <span className="mvpick__game">
        <Matchup game={row.game} />
      </span>
      {row.channel && <span className="mvpick__sub mvpick__gamechan">{row.channel.name}</span>}
    </>
  );
}

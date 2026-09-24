import { useEffect, useMemo, useState } from "react";
import { MultiviewGrid } from "../live/MultiviewGrid";
import { usableSize, type GridSize } from "../live/multiview";
import { resolveStreamUrl } from "../live/stream";
import { lookupLive } from "../live/source";
import { tunedChannel } from "./catalog";
import { Matchup } from "./Matchup";
import type { Fixture } from "./model";
import type { XtreamConnections } from "../../data/xtream";

/**
 * Multi-view: several streams at once (plan 013).
 *
 * A TILE TAKES ANY CHANNEL, not only a live game, and that is a correction
 * rather than a feature. The first build filled tiles from live fixtures
 * alone, which Adam found unusable on the first evening he tried it: "i
 * cant multi anything, there's only 1 game live rn". Sport is bursty. A
 * Sunday has eight simultaneous games and a Tuesday has one, so a grid that
 * only accepts games is a grid you cannot open most of the week — and it
 * also refused the obvious pairing of the one live game beside a channel
 * you wanted next to it.
 *
 * So games are the SHORTCUT, not the source: they sit at the top of the
 * rail already matched to a channel, and the search below reaches the whole
 * catalog. Either way a pick resolves to a channel id, and the grid never
 * learns the difference.
 *
 * THE PICKING HAPPENS HERE, not on the board. You are assembling a grid, so
 * seeing the grid while you assemble it is the feedback loop. And
 * SportsScreen records that the board's cards are memo()d with a
 * deliberately stable `onOpen` because a fresh arrow there re-rendered the
 * whole board every 90 seconds; a selection mode threaded through them is
 * exactly that regression.
 */

/** One chosen tile, already reduced to the channel that will play in it. */
interface Pick {
  /** Channel id, which is also the identity: the same channel twice would
   * be two tiles of one stream and two connections spent on it. */
  channelId: string;
  /** What the tile is called. A game says the fixture, a channel says
   * itself, because that is what you picked in each case. */
  label: string;
}

/** How many catalog rows a search shows. Enough to find it, few enough that
 * the rail stays a rail: a bare query can match thousands. */
const SEARCH_LIMIT = 40;

export function MultiviewScreen({
  live,
  conns,
  size,
  onSize,
  onClose,
}: {
  /** Live fixtures that already have a card-worthy channel. The shortcut. */
  live: Fixture[];
  conns: XtreamConnections | null;
  size: GridSize;
  onSize: (n: GridSize) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Pick[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");

  const cap = usableSize(size, conns) ?? 0;

  /** The visible catalog, for the search. Hidden folders stay hidden: this
   * is a picker, and the guide's own hiding is a statement about clutter. */
  // lookupLive, not peekLive: the search must work however long the Sports
  // tab has been open, and peekLive goes null after half an hour.
  const channels = useMemo(() => lookupLive()?.channels ?? [], []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const out = [];
    for (const c of channels) {
      if (c.name.toLowerCase().includes(q)) out.push(c);
      if (out.length >= SEARCH_LIMIT) break;
    }
    return out;
  }, [channels, query]);

  // Resolve each pick to a playable URL, once per channel.
  useEffect(() => {
    let dead = false;
    for (const p of picked) {
      if (urls[p.channelId]) continue;
      const real = tunedChannel(p.channelId);
      if (!real) continue;
      void resolveStreamUrl(real).then(
        (url) => {
          if (dead || !url) return;
          setUrls((was) =>
            was[p.channelId] ? was : { ...was, [p.channelId]: url },
          );
        },
        () => undefined,
      );
    }
    return () => {
      dead = true;
    };
  }, [picked, urls]);

  // A smaller grid drops what no longer fits rather than keeping it selected
  // invisibly and surprising you on the way back up.
  useEffect(() => {
    setPicked((was) => (was.length > cap ? was.slice(0, cap) : was));
  }, [cap]);

  const toggle = (channelId: string, label: string) =>
    setPicked((was) =>
      was.some((p) => p.channelId === channelId)
        ? was.filter((p) => p.channelId !== channelId)
        : was.length >= cap
          ? was
          : [...was, { channelId, label }],
    );

  const streams = picked
    .map((p) =>
      urls[p.channelId]
        ? { id: p.channelId, name: p.label, url: urls[p.channelId] }
        : null,
    )
    .filter((s): s is { id: string; name: string; url: string } => s !== null);

  const has = (channelId: string) =>
    picked.some((p) => p.channelId === channelId);
  const full = picked.length >= cap;

  return (
    <div className="mvscreen">
      <div className="mvscreen__stage">
        <MultiviewGrid
          streams={streams}
          conns={conns}
          size={size}
          onSize={onSize}
          onClose={onClose}
        />
      </div>
      <aside className="mvscreen__rail">
        <h2 className="mvscreen__title">
          Fill the grid
          <span className="mvscreen__count">
            {picked.length}/{cap}
          </span>
        </h2>

        {live.length > 0 && (
          <>
            <p className="mvscreen__section">Live now</p>
            {live.map((g) => {
              const ch = g.channels[0];
              if (!ch) return null;
              const on = has(ch.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  className={
                    "mvscreen__game" +
                    (on ? " is-on" : "") +
                    (!on && full ? " is-full" : "")
                  }
                  aria-pressed={on}
                  disabled={!on && full}
                  onClick={() =>
                    toggle(ch.id, `${g.away.shortName ?? g.away.name} at ${g.home.shortName ?? g.home.name}`)
                  }
                >
                  <Matchup game={g} />
                </button>
              );
            })}
          </>
        )}

        <p className="mvscreen__section">Any channel</p>
        <input
          className="mvscreen__search"
          type="search"
          value={query}
          placeholder="Search your channels"
          aria-label="Search your channels"
          onChange={(e) => setQuery(e.target.value)}
        />
        {query.trim().length >= 2 && results.length === 0 && (
          <p className="mvscreen__empty">Nothing matches that.</p>
        )}
        {results.map((c) => {
          const on = has(c.id);
          return (
            <button
              key={c.id}
              type="button"
              className={
                "mvscreen__chan" +
                (on ? " is-on" : "") +
                (!on && full ? " is-full" : "")
              }
              aria-pressed={on}
              disabled={!on && full}
              onClick={() => toggle(c.id, c.name)}
            >
              {c.name}
            </button>
          );
        })}
      </aside>
    </div>
  );
}

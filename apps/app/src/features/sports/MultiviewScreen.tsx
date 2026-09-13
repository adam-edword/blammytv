import { useEffect, useState } from "react";
import { MultiviewGrid } from "../live/MultiviewGrid";
import { usableSize, type GridSize } from "../live/multiview";
import { resolveStreamUrl } from "../live/stream";
import { tunedChannel } from "./catalog";
import { Matchup } from "./Matchup";
import type { Fixture } from "./model";
import type { XtreamConnections } from "../../data/xtream";

/**
 * Multi-view: several live games at once (plan 013).
 *
 * THE PICKING HAPPENS HERE, not on the board, and that is the design rather
 * than a shortcut. Two reasons. You are assembling a grid, so seeing the
 * grid while you assemble it is the whole feedback loop: which tile a game
 * lands in, and what swapping one does. And the board's cards are memo()d
 * with a deliberately stable `onOpen` — SportsScreen's comment records that
 * a fresh arrow there re-rendered the entire board every 90 seconds — so a
 * selection mode threaded through them is exactly the change that regresses.
 * The board gains one button and nothing else.
 *
 * Order is selection order, so the first game you pick is the first tile and
 * the one that starts with the sound.
 */
export function MultiviewScreen({
  live,
  conns,
  size,
  onSize,
  onClose,
}: {
  /** Live fixtures that have at least one card-worthy channel. */
  live: Fixture[];
  conns: XtreamConnections | null;
  size: GridSize;
  onSize: (n: GridSize) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [urls, setUrls] = useState<Record<string, { name: string; url: string }>>(
    {},
  );

  const cap = usableSize(size, conns) ?? 0;

  // Resolve each picked game's best channel to a playable URL, once.
  //
  // The best channel is `channels[0]`: withChannels already filtered to
  // card-worthy matches and kept the schedule's own ordering, so the first
  // is the national feed where there is one. A tile is not the place to
  // offer a rail of alternatives; the theater is, and it still does.
  useEffect(() => {
    let dead = false;
    for (const id of picked) {
      if (urls[id]) continue;
      const game = live.find((g) => g.id === id);
      const first = game?.channels[0];
      if (!first) continue;
      const real = tunedChannel(first.id);
      if (!real) continue;
      void resolveStreamUrl(real).then(
        (url) => {
          if (dead || !url) return;
          setUrls((was) =>
            was[id] ? was : { ...was, [id]: { name: first.name, url } },
          );
        },
        () => undefined,
      );
    }
    return () => {
      dead = true;
    };
  }, [picked, live, urls]);

  // A smaller grid drops the games that no longer fit, rather than keeping
  // them selected invisibly and surprising you when you go back up.
  useEffect(() => {
    setPicked((was) => (was.length > cap ? was.slice(0, cap) : was));
  }, [cap]);

  const streams = picked
    .map((id) => {
      const got = urls[id];
      return got ? { id, name: got.name, url: got.url } : null;
    })
    .filter((s): s is { id: string; name: string; url: string } => s !== null);

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
          Live now
          <span className="mvscreen__count">
            {picked.length}/{cap}
          </span>
        </h2>
        {live.length === 0 && (
          <p className="mvscreen__empty">
            Nothing live on your channels right now.
          </p>
        )}
        {live.map((g) => {
          const on = picked.includes(g.id);
          // Full means full: rather than silently dropping the oldest pick,
          // the rest go inert and the count says why.
          const full = !on && picked.length >= cap;
          return (
            <button
              key={g.id}
              type="button"
              className={
                "mvscreen__game" + (on ? " is-on" : "") + (full ? " is-full" : "")
              }
              aria-pressed={on}
              disabled={full}
              onClick={() =>
                setPicked((was) =>
                  was.includes(g.id)
                    ? was.filter((p) => p !== g.id)
                    : [...was, g.id],
                )
              }
            >
              <Matchup game={g} />
            </button>
          );
        })}
      </aside>
    </div>
  );
}

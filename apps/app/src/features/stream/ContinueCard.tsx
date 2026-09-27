import { useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { PlayIcon } from "../../ui/icons";
import { cardMetaLine, type CardMetaField } from "../settings/cardMeta";
import type { WatchEntry } from "./watching";

// Its own file since v0.10.31 (ROADMAP M2), unchanged, and in the Stream
// feature rather than ui/: both of its screens (Stream's home and Library)
// are this feature's, and it is a watch-history card, bound to WatchEntry
// and hold-to-clear, not a primitive another feature would reach for.
// Before, Library imported it out of StreamScreen.tsx.

/** Continue Watching card: landscape art, meta line, HOLD to clear (the
 * Figma interaction — a click opens, a ~1s press-and-hold removes).
 * EXPORTED because the Library tab shows the same row: one implementation,
 * or every future card fix has to be made twice. */
export function ContinueCard({
  entry,
  metaFields,
  onOpen,
  onSources,
  onClear,
}: {
  entry: WatchEntry;
  metaFields: CardMetaField[];
  onOpen: () => void;
  onSources: () => void;
  onClear: () => void;
}) {
  const meta = cardMetaLine(metaFields, {
    rating: entry.rating,
    year: entry.year,
    runtimeMin: entry.runtimeMin,
    genre: entry.genre,
    kind: entry.kind,
  });
  // "42m left" from the progress clocks — only while genuinely mid-way
  // (finished movies retire from the row entirely; see Home's filter).
  const leftMin =
    entry.posSec && entry.durSec && entry.posSec < entry.durSec * 0.9
      ? Math.max(1, Math.round((entry.durSec - entry.posSec) / 60))
      : null;
  const metaLine = [meta, leftMin != null ? `${leftMin}m left` : null]
    .filter(Boolean)
    .join(" · ");
  const [holding, setHolding] = useState(false);
  const timer = useRef(0);
  const held = useRef(false);
  // A press longer than this is a HOLD (the clear gesture, abandoned or
  // not) — releasing must never fall through to opening the show. Under
  // it, it's a click and opens. The holdbar is ~1/3 full at the cutoff,
  // so the visual and the intent boundary roughly agree (Adam).
  const CLICK_MAX_MS = 350;
  const pressAt = useRef(0);
  const start = () => {
    held.current = false;
    pressAt.current = Date.now();
    setHolding(true);
    timer.current = window.setTimeout(() => {
      held.current = true;
      setHolding(false);
      onClear();
    }, 1000);
  };
  const cancel = () => {
    window.clearTimeout(timer.current);
    setHolding(false);
  };
  const wasClick = () => {
    // No pointerdown preceded this click (screen-reader / synthetic
    // activation) — it IS a click; the 350ms rule only judges presses.
    if (pressAt.current === 0) return !held.current;
    const ok = !held.current && Date.now() - pressAt.current < CLICK_MAX_MS;
    pressAt.current = 0;
    return ok;
  };
  return (
    // div+role, not <button>: the Sources chip nests a real button inside.
    <div
      role="button"
      tabIndex={0}
      className={"tile continue-card" + (holding ? " continue-card--holding" : "")}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onClick={() => {
        if (wasClick()) onOpen();
      }}
      onKeyDown={(e) => {
        // Keys aimed at the nested Sources chip (a real button) must not
        // bubble into card actions — Enter there was quick-resuming.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          // Space also pages the scroll container without this.
          e.preventDefault();
          onOpen();
        }
        // The pointer path clears via press-and-hold; this is the
        // keyboard's equivalent (the a11y sweep pattern from Live).
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onClear();
        }
      }}
    >
      {/* The tile (plan 019, K7): a 16:9 picture with nothing on it at
        * rest, progress UNDER it, the caption under that. */}
      <span className="tile__pic continue-card__artwrap">
        {entry.art ? (
          <img className="tile__art continue-card__art" src={entry.art} alt="" loading="lazy" draggable={false} />
        ) : (
          <span className="tile__art continue-card__art" />
        )}
        {/* Clearlogo over the art, lower-middle — sits UNDER the hover
          * play cue (which is dead center), never fighting it. */}
        {entry.logo && (
          <img
            className="continue-card__logo"
            src={entry.logo}
            alt=""
            aria-hidden
            loading="lazy"
            draggable={false}
          />
        )}
        <span className="tile__scrim" aria-hidden />
        <span className="continue-card__cue" aria-hidden>
          <PlayIcon size={36} />
        </span>
        {/* Straight to the source screen instead of quick-resume. */}
        <Button variant="chip" size="chip"
          type="button"
          className="continue-card__sources"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onSources();
          }}
        >
          Sources
        </Button>
        <span className="continue-card__hold" aria-hidden>
          Keep holding to clear
        </span>
        <span className="continue-card__holdbar" aria-hidden />
      </span>
      {entry.posSec && entry.durSec ? (
        <span className="tile__track continue-card__progress" aria-hidden>
          <i style={{ width: `${Math.min(100, (entry.posSec / entry.durSec) * 100)}%` }} />
        </span>
      ) : null}
      {/* The title/meta line goes to the SOURCE list, not playback — the
        * art is the "play this" target, the text is the "what is this"
        * target.
        *
        * pointerdown is deliberately NOT stopped: the card's press-and-hold
        * to clear has to keep working over the text, which is most of the
        * card's lower half. Stopping it there silently killed hold-to-clear
        * on that whole strip. So the press runs the card's own start(), and
        * the click below asks the same wasClick() question the card asks —
        * a completed HOLD already fired onClear and must not also open
        * sources. Only the click is stopped, so the card's onClick (which
        * would quick-resume) never doubles up.
        *
        * tabIndex -1 on purpose: RowScroller keeps ONE tab stop per row and
        * a focusable child sits outside that roving list, so it both adds a
        * stop per card and makes ArrowLeft/Right dead while focused. The
        * Sources chip beside it is already the keyboard route to this exact
        * action, so the text stays a pointer affordance rather than a
        * second, arrow-breaking stop. */}
      <button
        type="button"
        tabIndex={-1}
        className="continue-card__text"
        onClick={(e) => {
          e.stopPropagation();
          if (wasClick()) onSources();
        }}
      >
        <span className="stream-card__name">{entry.title}</span>
        {metaLine && <span className="stream-card__meta">{metaLine}</span>}
      </button>
    </div>
  );
}

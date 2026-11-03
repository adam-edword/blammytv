import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { REDUCED_MOTION } from "../../lib/reducedMotion";
import { formatClock } from "../../lib/time";
import { ChannelLogo } from "../../ui/ChannelLogo";
import { ListShapeIcon, StripShapeIcon } from "../../ui/icons";
import { Segmented, type SegOption } from "../../ui/Segmented";
import { loadClockFormat } from "../settings/clockFormat";
import { progress } from "./epg";
import {
  airing,
  timeLeft,
  windowAround,
  type MiniChannel,
  type MiniGuideData,
  type MiniShape,
} from "./miniGuideModel";

/** The mini-guide's drawing (plan 036): the strip's cards and the list's rows.
 * The state and the keys are useMiniGuide's. */

/** The card and row sizes. JS places the window of a long list by them, so
 * they ride to the stylesheet as custom properties and are set in one place. */
const CARD_W = 236;
const CARD_GAP = 14;
const ROW_H = 68;
const ROW_GAP = 4;
const STEP_X = CARD_W + CARD_GAP;
const STEP_Y = ROW_H + ROW_GAP;
/** Cards or rows the selection sits in from the start of the view. */
const LEAD_X = 2;
const LEAD_Y = 3;

const SHAPES: SegOption<MiniShape>[] = [
  { key: "strip", label: "Strip", icon: <StripShapeIcon /> },
  { key: "list", label: "List", icon: <ListShapeIcon /> },
];

export function MiniGuideView({
  data,
  shape,
  peek,
  sel,
  onPick,
  onShape,
}: {
  data: MiniGuideData;
  shape: MiniShape;
  peek: boolean;
  sel: number;
  onPick: (i: number) => void;
  onShape: (s: MiniShape) => void;
}) {
  // The clock a card's progress and time left are read against.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const [clock] = useState(loadClockFormat);

  const n = data.channels.length;
  const strip = shape === "strip";
  const scroller = useRef<HTMLDivElement>(null);
  // Only what is near the selection is drawn; the rest is a spacer's length,
  // so a folder of thousands costs a screenful. Enough either side to fill the
  // window it is in, however wide or tall, and four more for the glide to land
  // in (a held arrow moves the selection faster than the scroll follows).
  const radius = strip
    ? Math.ceil(window.innerWidth / STEP_X) + 4
    : Math.ceil(window.innerHeight / STEP_Y) + 4;
  const [from, to] = windowAround(n, sel, radius);
  const step = strip ? STEP_X : STEP_Y;
  useScrollTo(scroller, strip ? "left" : "top", Math.max(0, sel - (strip ? LEAD_X : LEAD_Y)) * step);

  const items = data.channels.slice(from, to).map((c, k) => {
    const i = from + k;
    const air = airing(c.programmes, now);
    const playing = c.channel.id === data.playingId;
    const props = {
      c,
      air,
      now,
      clock,
      playing,
      sel: i === sel,
      onClick: () => onPick(i),
    };
    return strip ? <Card key={c.channel.id} {...props} /> : <Row key={c.channel.id} {...props} />;
  });
  const before = from * step;
  const after = (n - to) * step;
  // The flex gap already sits between a spacer and its neighbour, so it is
  // taken off the spacer: item i lands at i * step whatever is drawn.
  const gap = strip ? CARD_GAP : ROW_GAP;
  const spacer = (len: number) =>
    len > 0 ? (
      <span
        className="mg-spacer"
        aria-hidden
        style={strip ? { width: len - gap } : { height: len - gap }}
      />
    ) : null;

  const head = (
    <div className="mg-head">
      <p className="mg-name">
        {data.listName}
        <span>{n === 1 ? "1 channel" : `${n} channels`}</span>
      </p>
      <Segmented
        size="sm"
        label="Layout"
        className="mg-seg"
        options={SHAPES}
        value={shape}
        onChange={onShape}
      />
    </div>
  );
  const sizes = {
    "--mg-card-w": `${CARD_W}px`,
    "--mg-gap": `${CARD_GAP}px`,
    "--mg-row-h": `${ROW_H}px`,
    "--mg-row-gap": `${ROW_GAP}px`,
  } as CSSProperties;

  return (
    <section
      className={strip ? "mg-strip" : "mg-list"}
      aria-label="Mini-Guide"
      data-interactive
      data-peek={peek || undefined}
      style={sizes}
      // A click on it must not park the keyboard on a button: a focused button
      // keeps the arrows and Enter for itself, and these are the guide's.
      onMouseDown={(e) => e.preventDefault()}
    >
      {head}
      <div ref={scroller} className={strip ? "mg-cards" : "mg-rows"}>
        {spacer(before)}
        {items}
        {spacer(after)}
      </div>
    </section>
  );
}

/** Scroll `el` to `pos` along `axis` when it changes: straight there the first
 * time, a glide after, and no glide under reduced motion. */
function useScrollTo(el: RefObject<HTMLElement | null>, axis: "left" | "top", pos: number) {
  const placed = useRef(false);
  useLayoutEffect(() => {
    el.current?.scrollTo({
      [axis]: pos,
      behavior: placed.current && !REDUCED_MOTION ? "smooth" : "auto",
    });
    placed.current = true;
  }, [el, axis, pos]);
}

interface ItemProps {
  c: MiniChannel;
  air: ReturnType<typeof airing>;
  now: Date;
  clock: "12h" | "24h";
  playing: boolean;
  sel: boolean;
  onClick: () => void;
}

/** The mark on the channel playing, in the live dot's colour. */
function Watching() {
  return (
    <span className="mg-watching">
      <span className="mg-watching__dot" />
      Watching
    </span>
  );
}

function Bar({ air, now }: Pick<ItemProps, "air" | "now">) {
  const pct = air.now ? progress(air.now.start, air.now.end, now) : 0;
  return (
    <span className="mg-prog">
      <i style={{ width: `${Math.round(pct * 100)}%` }} />
    </span>
  );
}

function Card({ c, air, now, playing, sel, onClick }: ItemProps) {
  return (
    <button
      type="button"
      className={"mg-card" + (sel ? " is-sel" : "")}
      data-channel={c.channel.id}
      data-sel={sel || undefined}
      aria-current={playing || undefined}
      tabIndex={-1}
      onClick={onClick}
    >
      <span className="mg-card__art">
        <ChannelLogo name={c.channel.name} logo={c.channel.logo} size={72} />
      </span>
      <span className="mg-card__row">
        <span className="mg-card__name">{c.channel.name}</span>
        {playing && <Watching />}
      </span>
      <span className="mg-card__now">{air.now ? air.now.title : "No Information"}</span>
      <Bar air={air} now={now} />
      <span className="mg-card__left">{air.now ? timeLeft(air.now.end.getTime() - now.getTime()) : ""}</span>
    </button>
  );
}

function Row({ c, air, now, clock, playing, sel, onClick }: ItemProps) {
  return (
    <button
      type="button"
      className={"mg-row" + (sel ? " is-sel" : "")}
      data-channel={c.channel.id}
      data-sel={sel || undefined}
      aria-current={playing || undefined}
      tabIndex={-1}
      onClick={onClick}
    >
      <ChannelLogo name={c.channel.name} logo={c.channel.logo} size={48} />
      <span className="mg-row__body">
        <span className="mg-row__line">
          <span className="mg-row__name">{c.channel.name}</span>
          <span className="mg-row__now">{air.now ? air.now.title : "No Information"}</span>
        </span>
        <Bar air={air} now={now} />
        <span className="mg-row__next">
          {playing && <Watching />}
          {air.next && `Next ${formatClock(air.next.start, clock)} · ${air.next.title}`}
        </span>
      </span>
    </button>
  );
}

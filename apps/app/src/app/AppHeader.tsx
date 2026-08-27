import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  Fragment,
  type ComponentType,
} from "react";
import {
  SearchIcon,
  DiscoverIcon,
  GuideIcon,
  LibraryIcon,
  MoviesIcon,
  SeriesIcon,
  SettingsIcon,
  SportsIcon,
  StreamIcon,
} from "../ui/icons";
import {
  getSearchQuery,
  onSearchFocusRequest,
  onSearchQueryChange,
  requestSearchFocus,
  setSearchQuery,
  takeSearchFocus,
} from "../features/discover/searchQuery";
import {
  getTypeFilter,
  onTypeFilterChange,
  requestTypeFilter,
  type TypeFilter,
} from "../features/discover/typeFilter";
import { UpdateChip } from "./UpdateChip";
import { formatClock } from "../lib/time";
import { APP_VERSION } from "../lib/version";
import {
  loadClockFormat,
  onClockFormatChange,
} from "../features/settings/clockFormat";

/** The app's two SIDES. "Stream" in the top nav is a section header,
 * not a page — the pill rail below picks the actual Stream page. */
export type Section = "live" | "stream";
/** The Stream section's pages (the pill rail). Adding one = a new entry
 * here + in RAIL + a screen in App's switch — nothing else. */
export type StreamTab = "home" | "discover" | "mylist";

/** The Live side's pages, mirroring the Stream rail. Sports is plan 010,
 * shipped behind a BETA badge while its data source is still a bet. */
export type LiveTab = "guide" | "sports";

/**
 * THE DESTINATIONS, flat.
 *
 * The header used to show two SIDES (Live TV | Stream) with a sub-rail
 * under each. The capsule shows all five pages at once instead, so the
 * side is no longer something the user navigates — it is just which half
 * of the bar a destination sits in, marked by the app mark between them.
 *
 * The two-level state behind it is UNCHANGED: each entry writes both the
 * section and its tab, so App and every screen carry on as before.
 */
/* The key stays the tab's own id, so App and the screens are untouched.
 * "home" is LABELLED "Stream": it is the VOD landing page, and "Home" was
 * the only name in the bar that described a position rather than content. */
type DestKey = LiveTab | StreamTab;

const DESTS: Array<{
  key: DestKey;
  label: string;
  side: Section;
  Icon: ComponentType<{ size?: number; className?: string; filled?: boolean }>;
  /** Sports is plan 010, still behind a badge while its source is a bet. */
  beta?: boolean;
}> = [
  { key: "guide", label: "Guide", side: "live", Icon: GuideIcon },
  { key: "sports", label: "Sports", side: "live", Icon: SportsIcon, beta: true },
  { key: "home", label: "Stream", side: "stream", Icon: StreamIcon },
  { key: "discover", label: "Discover", side: "stream", Icon: DiscoverIcon },
  { key: "mylist", label: "Library", side: "stream", Icon: LibraryIcon },
];

/**
 * Discover's type filters, in the SECOND row.
 *
 * Same grammar as the destinations above: an icon that collapses, and a
 * label that opens under the thumb when it is the one you are on. "Any"
 * is the exception and always shows its label — there is no honest glyph
 * for "no filter", and an icon nobody can name is worse than a short word.
 */
/**
 * What the field promises to search, per filter. Not decoration:
 * searchDiscover drops every catalog whose type is not the selected one,
 * so with Movies picked a series will never come back.
 */
const SEARCH_SCOPE: Record<TypeFilter, string> = {
  all: "movies & series",
  movie: "movies",
  series: "series",
};

const FILTERS: Array<{
  key: TypeFilter;
  label: string;
  Icon?: ComponentType<{ size?: number; className?: string; filled?: boolean }>;
}> = [
  { key: "all", label: "Any" },
  { key: "movie", label: "Movies", Icon: MoviesIcon },
  { key: "series", label: "Series", Icon: SeriesIcon },
];

/** Live clock, minute-accurate (the header shows no seconds). Follows the
 * 12h/24h preference immediately when it changes in Settings. */
function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  const [format, setFormat] = useState(loadClockFormat);
  useEffect(() => {
    // Tick once per minute, re-aligned to the wall-clock minute boundary (the
    // header shows no seconds) — not 60 re-renders/min for a string that only
    // changes once a minute.
    let id: number;
    const schedule = () =>
      window.setTimeout(() => {
        setNow(new Date());
        id = schedule();
      }, 60_000 - (Date.now() % 60_000) + 50);
    id = schedule();
    const off = onClockFormatChange(setFormat);
    return () => {
      window.clearTimeout(id);
      off();
    };
  }, []);
  return formatClock(now, format);
}

export function AppHeader({
  section,
  showLive,
  streamTab,
  onSection,
  onStreamTab,
  liveTab,
  onLiveTab,
  onOpenSettings,
}: {
  section: Section;
  streamTab: StreamTab;
  liveTab: LiveTab;
  /** Live tab renders only while a live source is configured. */
  showLive: boolean;
  onSection: (s: Section) => void;
  onStreamTab: (t: StreamTab) => void;
  onLiveTab: (t: LiveTab) => void;
  onOpenSettings: () => void;
}) {
  const clock = useClock();
  /* Mirrors, not owners. The filter's truth is a history entry in
   * DiscoverScreen's view stack (Back can change it), and the query's is
   * the shared search store. The header reads both to render the second
   * row and writes to neither directly — it sends requests. */
  const [filter, setFilter] = useState<TypeFilter>(getTypeFilter);
  useEffect(() => onTypeFilterChange(setFilter), []);
  const [query, setQuery] = useState(getSearchQuery);
  useEffect(() => onSearchQueryChange(setQuery), []);
  const searchRef = useRef<HTMLInputElement>(null);
  // `/`, Ctrl+K, Ctrl+F reach the search field — which lives on Discover
  // now, so this GOES there first and asks for focus through the mailbox
  // in searchQuery. Dispatching a bare event would not survive the trip:
  // DiscoverScreen may not be mounted yet, and App holds the swap back by
  // NAV_SETTLE_MS on top of that.
  //
  // Never while typing in another field, and never while a player is up
  // (its own keys win; #inv-chrome existing = playback chrome mounted).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const slash =
        e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey;
      const combo =
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        (e.key.toLowerCase() === "k" || e.key.toLowerCase() === "f");
      if (!slash && !combo) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      if (document.getElementById("inv-chrome")) return;
      e.preventDefault();
      onSection("stream");
      onStreamTab("discover");
      // The row is collapsed (and unfocusable) until Discover is the
      // destination, so the focus waits for it to open — see below.
      requestSearchFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSection, onStreamTab]);


  /* ---------------------------------------------------------- capsule
   * The pill is ONE element that travels; the mark is pinned to the
   * window midline and the capsule grows unevenly around it.
   *
   * Every number here is COMPUTED from measured widths rather than read
   * back off the DOM, because offsetWidth during the transition returns
   * the ANIMATING width: measuring live puts the pill under the label and
   * lets the mark drift off centre. */
  const navRef = useRef<HTMLElement | null>(null);
  const rowNavRef = useRef<HTMLDivElement | null>(null);
  const rowSubRef = useRef<HTMLDivElement | null>(null);
  const pillRef = useRef<HTMLSpanElement | null>(null);
  const subPillRef = useRef<HTMLSpanElement | null>(null);
  const markRef = useRef<HTMLButtonElement | null>(null);
  /* Both rows' buttons in ONE map. Destination keys and filter keys do not
   * collide, and the measuring below does not care which row an item is
   * in — it only ever asks a button how wide it is with its label shut. */
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  /** key -> [icon-only width, label width]. Measured once per layout. */
  const sizes = useRef(new Map<string, [number, number]>());

  const shown = DESTS.filter((d) => showLive || d.side !== "live");
  const active: DestKey = section === "live" ? liveTab : streamTab;
  /* The second row belongs to Discover and nothing else. It is always in
   * the DOM so its widths can be measured and its open/close can animate;
   * `subOpen` decides whether it has any height. */
  const subOpen = section === "stream" && streamTab === "discover";

  /**
   * The header floats over the tabs; publish its height so tabs that
   * shouldn't start underneath can offset themselves (--header-h).
   *
   * ONE ROW'S WORTH, ALWAYS. The second row is deliberately NOT counted.
   *
   * It used to be, and the capsule then pushed every screen down 39px as it
   * unfolded — the nav reaching out and moving the page, which is the one
   * thing a floating bar must never do. The capsule is absolutely
   * positioned precisely so it costs the layout nothing; letting its height
   * back in through --header-h handed that cost straight back.
   *
   * So Discover's content passes UNDER the open second row, which is what
   * the nav is built for: it is glass, the header carries a scrim, and
   * anything scrolled up there goes behind it anyway. The band is ~31px
   * deep and only as wide as the capsule (~430px of a 1600px window), and
   * Discover's own top padding leaves its first row of cards clear of it.
   *
   * The capsule's TARGET height is what goes out, not its measured one.
   * Measuring would republish on every frame of the unfold, and every
   * consumer of --header-h is a screen's top padding — so the whole
   * Discover grid would reflow ~23 times during a 380ms animation, which
   * is precisely the stall this nav spent v0.9.2 through v0.9.6 removing.
   */
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () => {
      const nav = navRef.current;
      let capsuleBottom = 0;
      if (nav) {
        const cs = getComputedStyle(nav);
        const padY =
          (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
        const rowH = rowNavRef.current?.offsetHeight ?? 0;
        capsuleBottom = nav.offsetTop + padY + rowH;
      }
      document.documentElement.style.setProperty(
        "--header-h",
        `${Math.max(el.offsetHeight, capsuleBottom)}px`,
      );
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* `/`, Ctrl+K and Ctrl+F ask for the field. The field is up here now, so
   * this is the header's own business — but it still cannot focus
   * immediately: the second row is collapsed and unfocusable until Discover
   * is the destination, and App holds the screen swap back by
   * NAV_SETTLE_MS. So the request WAITS, and is collected the moment the
   * row opens. Keyed on subOpen for exactly that. */
  useEffect(() => {
    const focus = () => {
      // Check FIRST, take second. The request is dispatched while this row
      // is still shut — React has not re-rendered and Discover is 190ms
      // away — so collecting it here would consume it and drop it on the
      // floor. Leave it in the mailbox until there is something to focus.
      if (!subOpen) return;
      if (!takeSearchFocus()) return;
      searchRef.current?.focus();
    };
    focus();
    return onSearchFocusRequest(focus);
  }, [subOpen]);

  const measure = useCallback(() => {
    for (const [key, el] of itemRefs.current) {
      const box = el.querySelector<HTMLElement>(".navcap__lbl");
      if (!box) continue;
      const prevW = box.style.width;
      const prevT = box.style.transition;
      // Transitions OFF for the duration. The clip box animates its width
      // now, and a transitioning element reports the width it is currently
      // AT, not the one just assigned — so the open item's `base` came back
      // a whole label too wide, and the capsule settled that far off centre.
      box.style.transition = "none";
      box.style.width = "0px";
      const base = el.offsetWidth;
      box.style.width = "auto";
      // The label's width is the DIFFERENCE, not the inner span's own box:
      // both readings are then offsetWidth, which is CSS px. Mixing in a
      // getBoundingClientRect would have mixed in the UI zoom factor too.
      sizes.current.set(key, [base, el.offsetWidth - base]);
      box.style.width = prevW;
      // Land the restored width while transitions are still off, or the
      // measurement animates itself back out.
      void box.offsetWidth;
      box.style.transition = prevT;
    }
  }, []);

  /**
   * Lay out ONE row: park its thumb under the open item, set every label's
   * clip width, and report where the app mark's midpoint landed (row 2 has
   * no mark, so null).
   *
   * THE WALK IS IN ROW COORDINATES, starting at 0. The thumb is absolutely
   * positioned inside the ROW, so that is the box its `left` resolves
   * against, and the row's own padding box already starts past the
   * capsule's padding. Walking from the capsule's padding instead counted
   * it twice and put every thumb exactly 14px right of the item it was
   * supposed to sit under — measured at dLeft: 14 in both rows and every
   * state, with the width dead on. Before the second row the thumb was a
   * direct child of .navcap and capsule coordinates were the right ones;
   * moving it into the row is what changed the containing block.
   *
   * markMid comes back in row coordinates too. place() adds the capsule's
   * padding to it once, on its own line, because THAT one really is a
   * capsule-coordinate number: it positions the capsule itself.
   */
  const layoutRow = useCallback(
    (
      row: HTMLElement | null,
      thumb: HTMLElement | null,
      openKey: string,
    ): number | null => {
    const nav = navRef.current;
    const mark = markRef.current;
    if (!nav || !row || !thumb) return null;
    const cs = getComputedStyle(row);
    const gap = parseFloat(cs.columnGap || cs.gap || "0") || 0;

    let x = 0;
    let pillX: number | null = null;
    let pillW = 0;
    let markMid: number | null = null;
    for (const node of Array.from(row.children) as HTMLElement[]) {
      if (node === thumb) continue;
      let w: number;
      if (node === mark) {
        w = mark.offsetWidth;
        markMid = x + w / 2;
      } else if (node.classList.contains("navcap__search")) {
        // Flexible and last: nothing after it needs a position, and its
        // width is whatever row 1 leaves over.
        continue;
      } else {
        const key = node.dataset.key;
        if (!key) continue;
        const [base, lbl] = sizes.current.get(key) ?? [node.offsetWidth, 0];
        const open = key === openKey;
        w = base + (open ? lbl : 0);
        // The clip box is driven in PIXELS from here, not by a CSS rule
        // on [aria-current]. `width: auto` is not interpolable, so that
        // rule snapped the capsule to its new width in one frame while
        // the travel below still took --nav-dur to catch up: the bar
        // jumped right, then slid back. Same duration, same curve, same
        // frame budget = the mark stays nailed to the midline throughout.
        const box = node.querySelector<HTMLElement>(".navcap__lbl");
        if (box) box.style.width = `${open ? lbl : 0}px`;
        if (open) {
          pillX = x;
          pillW = w;
        }
      }
      x += w + gap;
    }
    if (pillX !== null) {
      thumb.style.left = `${pillX}px`;
      thumb.style.width = `${pillW}px`;
      thumb.style.opacity = "1";
    } else thumb.style.opacity = "0";
    return markMid;
    },
    [],
  );

  const place = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const cs = getComputedStyle(nav);
    const pad = parseFloat(cs.paddingLeft) || 0;
    // Children sit inside the BORDER box, so the walk starts past it too.
    // Leaving it out put the mark exactly one border-width off the midline.
    const border = parseFloat(cs.borderLeftWidth) || 0;
    const from = pad + border;

    const markMid = layoutRow(rowNavRef.current, pillRef.current, active);
    layoutRow(rowSubRef.current, subPillRef.current, filter);
    if (markMid === null) return;
    /* The mark holds the midline; the capsule breathes around it.
     *
     * ONE CLOCK. These used to travel on `transform`, which the browser
     * hands to the COMPOSITOR thread, while the label widths above are
     * layout and stay on the main thread. That is fine until the main
     * thread stalls — which it does on this app's live side, where
     * mounting the guide or the sports grid costs 40-170ms. The compositor
     * kept animating the capsule's position through the stall while its
     * contents stayed frozen at the old width, so the mark left the
     * midline entirely: caught in a screen recording at +72px, +39px and
     * -35px on separate switches, with the capsule's width unchanged in
     * those same frames.
     *
     * margin-left and left are LAYOUT properties, so they are never
     * composited. Everything the capsule animates now runs on one thread
     * off one clock: a stall freezes the whole capsule together and it
     * resumes together, instead of tearing itself apart. It also cannot
     * cost a reflow of anything else — .navcap is absolutely positioned,
     * so its margin moves only itself.
     */
    nav.style.marginLeft = `${-(markMid + from)}px`;
  }, [active, filter, layoutRow]);

  // A button's own width does not change when you click a DIFFERENT one, so
  // measuring is keyed on the destination set alone. It runs first because
  // effects fire in order, and place() reads what it stores.
  useLayoutEffect(() => {
    measure();
  }, [measure, showLive]);

  useLayoutEffect(() => {
    place();
  }, [place, showLive, subOpen]);

  /**
   * One turn of the logo's conic gradient, on click.
   *
   * Decoration, deliberately: the mark is the most colourful thing in the
   * app and was the only part of the bar that did nothing. It navigates
   * nowhere and changes no state.
   *
   * The class is removed and re-added around a forced reflow because a CSS
   * animation does not restart on an element that already has it — without
   * the reflow the second click does nothing at all. The class comes off
   * again on animationend so a re-click always starts from a clean slate.
   */
  const spin = useCallback(() => {
    const el = markRef.current;
    if (!el) return;
    el.classList.remove("is-spinning");
    void el.offsetWidth;
    el.classList.add("is-spinning");
  }, []);
  useEffect(() => {
    const el = markRef.current;
    if (!el) return;
    const done = () => el.classList.remove("is-spinning");
    el.addEventListener("animationend", done);
    return () => el.removeEventListener("animationend", done);
  }, [showLive]);

  /* THE JITTER. `place` is a new function on every destination change, so
   * an effect that lists it re-runs on every click. This one used to, and
   * it calls measure(), which rewrites the clip boxes with transitions off
   * — so the capsule snapped to its new width in one frame while the
   * transform above still took --nav-dur to follow, and the bar visibly
   * lurched right before settling back. The listeners want the LATEST
   * place, not a re-subscription, so it goes through a ref. */
  const placeRef = useRef(place);
  useLayoutEffect(() => {
    placeRef.current = place;
  }, [place]);

  // Label widths move with the font, so re-measure once it lands.
  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => {
      if (!alive) return;
      measure();
      placeRef.current();
    });
    const onResize = () => placeRef.current();
    window.addEventListener("resize", onResize);
    return () => {
      alive = false;
      window.removeEventListener("resize", onResize);
    };
  }, [measure]);

  /** One click sets BOTH levels, which is what keeps App unchanged. */
  const go = (d: (typeof DESTS)[number]) => {
    if (d.side === "live") {
      onSection("live");
      onLiveTab(d.key as LiveTab);
    } else {
      onSection("stream");
      // Pressing the Discover pill means browse, so drop any live query.
      // The store is the only copy now — the header kept a mirror of it
      // while the input lived here.
      if (d.key === "discover") setSearchQuery("");
      onStreamTab(d.key as StreamTab);
    }
  };

  return (
    <header className="header" ref={ref}>
      {/* Progressive blur: stacked backdrop layers with geometrically
       * doubling radii and overlapping mask bands, so the melt decays
       * smoothly with depth (a single blurred layer just fades in opacity,
       * which reads as an abrupt band). */}
      <div className="header__veil" aria-hidden>
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      {/* Clock only. The mark moved into the capsule, where it doubles as
        * the divider between the live half and the rest, and the wordmark
        * went with it: the app does not need to caption itself. */}
      <div className="header__brand">
        <span className="header__clock">{clock}</span>
        <span className="header__version">v{APP_VERSION}</span>
      </div>

      {/* THE CAPSULE. Absolutely positioned rather than sitting in the
        * header's grid: the mark has to land on the WINDOW midline, and a
        * flowed element gets shoved by whichever flank is wider. */}
      <nav
        className={"navcap" + (subOpen ? " navcap--open" : "")}
        aria-label="Sections"
        ref={navRef}
      >
        <div className="navcap__row navcap__row--nav" ref={rowNavRef}>
        <span className="navcap__pill" ref={pillRef} aria-hidden />
        {shown.map((d, i) => {
          const prev = shown[i - 1];
          const on = d.key === active;
          return (
            /* A Fragment, NOT a wrapper element: place() walks
               nav.children, and even a display:contents span would sit in
               that list and hide the buttons from it. */
            <Fragment key={d.key}>
              {prev && prev.side !== d.side && (
                <button
                  type="button"
                  className="navcap__mark"
                  ref={markRef}
                  onClick={spin}
                  aria-label="BlammyTV"
                >
                  <b>
                    <i />
                  </b>
                </button>
              )}
              <button
                type="button"
                data-dest={d.key}
                data-key={d.key}
                className="navcap__item"
                aria-current={on ? "page" : undefined}
                aria-label={d.beta ? `${d.label} (beta)` : d.label}
                title={d.label}
                ref={(el) => {
                  if (el) itemRefs.current.set(d.key, el);
                  else itemRefs.current.delete(d.key);
                }}
                onClick={() => go(d)}
              >
                {/* Regular weight off, filled on: the pill carries the
                  * active state from across the bar, the icon's weight
                  * confirms it up close. Both weights are the same 22px
                  * box, so this cannot shift the capsule. */}
                <d.Icon filled={on} />
                <span className="navcap__lbl">
                  <i>
                    {d.label}
                    {d.beta && <span className="chip-beta">BETA</span>}
                  </i>
                </span>
              </button>
            </Fragment>
          );
        })}
        </div>

        {/* THE SECOND ROW — Discover's, and only Discover's.
          *
          * Always rendered so its widths can be measured and its arrival
          * can animate; `navcap--open` is what gives it height. Kept out
          * of the tab order and the a11y tree while shut, or you could
          * tab into a control with no height on a screen it does not
          * belong to. */}
        {/* The GROUP carries the context, so each button's accessible name
          * can be exactly its visible label. "Show movies" read fine on its
          * own but made "Show any" out of the Any chip, and it put the
          * accessible name out of step with the word on screen. */}
        <div
          className="navcap__row navcap__row--sub"
          ref={rowSubRef}
          role="group"
          aria-label="Filter by type"
          aria-hidden={!subOpen}
          {...(subOpen ? {} : { inert: "" })}
        >
          <span className="navcap__pill" ref={subPillRef} aria-hidden />
          {FILTERS.map((f) => {
            const on = f.key === filter;
            return (
              <button
                key={f.key}
                type="button"
                data-key={f.key}
                className={
                  "navcap__item" + (f.Icon ? "" : " navcap__item--text")
                }
                aria-current={on ? "true" : undefined}
                aria-label={f.label}
                ref={(el) => {
                  if (el) itemRefs.current.set(f.key, el);
                  else itemRefs.current.delete(f.key);
                }}
                onClick={() => requestTypeFilter(f.key)}
              >
                {f.Icon && <f.Icon filled={on} />}
                <span className="navcap__lbl">
                  <i>{f.label}</i>
                </span>
              </button>
            );
          })}
          <span className="navcap__search">
            <SearchIcon size={19} aria-hidden />
            <input
              ref={searchRef}
              className="navcap__searchinput"
              type="search"
              placeholder={`Search ${SEARCH_SCOPE[filter]}…`}
              value={query}
              aria-label={`Search ${SEARCH_SCOPE[filter]}`}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  // Ours alone: without stopPropagation the App-level
                  // listener also exits OS fullscreen on the same press.
                  e.stopPropagation();
                  setSearchQuery("");
                  e.currentTarget.blur();
                }
              }}
            />
          </span>
        </div>
      </nav>

      <div className="header__right">
        {/* Outside the 0.3-opacity icon cluster on purpose: an available
          * update should read at full strength. */}
        <UpdateChip />
        {/* Profile is gone rather than disabled. It was a placeholder for a
          * feature that is not built, and a dimmed control that never does
          * anything is worse than an absent one: it reads as broken. It
          * comes back when there is something behind it. */}
        <div className="header__actions">
          <button
            type="button"
            className="header__action"
            aria-label="Settings"
            onClick={onOpenSettings}
          >
            <SettingsIcon />
          </button>
        </div>
      </div>
    </header>
  );
}

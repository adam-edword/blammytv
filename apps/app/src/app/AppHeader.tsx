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
  AccountIcon,
  DiscoverIcon,
  GuideIcon,
  LibraryIcon,
  SearchIcon,
  SettingsIcon,
  SportsIcon,
  StreamIcon,
} from "../ui/icons";
import { currentZoom } from "../features/settings/uiScale";
import {
  onSearchQueryChange,
  setSearchQuery,
} from "../features/discover/searchQuery";
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
  // Controlled mirror of the shared search store (the store is the truth
  // DiscoverScreen renders from; local state keeps the input snappy).
  const [query, setQuery] = useState("");
  // Mirror store-side clears too (e.g. a genre pill hand-off clears the
  // search) — otherwise the input shows stale text over browse results.
  useEffect(() => onSearchQueryChange(setQuery), []);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // While the search input is focused the rail's thumb parks on the
  // search chip (thumbKey) — the thumb tracks where your INPUT goes;
  // `streamTab` stays the truth of which page is showing.
  const [searchOpen, setSearchOpen] = useState(false);
  // Fit the floating input to the space actually available before the
  // right-side controls — 240px is a ceiling, not a promise. At 125% UI
  // scale on a narrow window the fixed width overran the settings icon
  // by 200+px. gBCR is visual (zoom-included) px; ÷zoom converts back
  // to the CSS px the width style is written in (see uiScale.ts).
  const searchChipRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!searchOpen) return;
    const chip = searchChipRef.current;
    const fit = () => {
      const right = document.querySelector(".header__right");
      if (!chip || !right) return;
      const gap =
        (right.getBoundingClientRect().left -
          chip.getBoundingClientRect().right) /
        currentZoom();
      const w = Math.max(48, Math.min(240, gap - 18));
      chip.style.setProperty("--search-w", `${w}px`);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      // Drop the measured width on blur: the blurred-with-query state
      // keeps the input visible, and a stale wide measure (taken before
      // a window shrink, or mid rail-expansion) overlapped — and stole
      // clicks from — the right-side header controls. The CSS fallback
      // min(240px, 17vw) covers that state instead.
      chip?.style.removeProperty("--search-w");
    };
  }, [searchOpen]);

  // `/`, Ctrl+K, Ctrl+F focus the pill — VOD side only, never while
  // typing in another field, never while a player is up (its own keys
  // win; #inv-chrome existing = playback chrome mounted).
  useEffect(() => {
    if (section === "live") return;
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
      searchInputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [section]);

  // The header floats over the tabs; publish its measured height so tabs
  // that shouldn't start underneath can offset themselves (--header-h).
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty(
        "--header-h",
        `${el.offsetHeight}px`,
      );
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---------------------------------------------------------- capsule
   * The pill is ONE element that travels; the mark is pinned to the
   * window midline and the capsule grows unevenly around it.
   *
   * Every number here is COMPUTED from measured widths rather than read
   * back off the DOM, because offsetWidth during the transition returns
   * the ANIMATING width: measuring live puts the pill under the label and
   * lets the mark drift off centre. */
  const navRef = useRef<HTMLElement | null>(null);
  const pillRef = useRef<HTMLSpanElement | null>(null);
  const markRef = useRef<HTMLSpanElement | null>(null);
  const itemRefs = useRef(new Map<DestKey, HTMLButtonElement>());
  /** key -> [icon-only width, label width]. Measured once per layout. */
  const sizes = useRef(new Map<DestKey, [number, number]>());

  const shown = DESTS.filter((d) => showLive || d.side !== "live");
  const active: DestKey = section === "live" ? liveTab : streamTab;

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

  const place = useCallback(() => {
    const nav = navRef.current;
    const pill = pillRef.current;
    const mark = markRef.current;
    if (!nav || !pill || !mark) return;
    const cs = getComputedStyle(nav);
    const pad = parseFloat(cs.paddingLeft) || 0;
    const gap = parseFloat(cs.columnGap || cs.gap || "0") || 0;
    // Children sit inside the BORDER box, so the walk starts past it too.
    // Leaving it out put the mark exactly one border-width off the midline.
    const border = parseFloat(cs.borderLeftWidth) || 0;

    let x = pad + border;
    let pillX: number | null = null;
    let pillW = 0;
    let markMid = 0;
    for (const node of Array.from(nav.children) as HTMLElement[]) {
      if (node === pill) continue;
      let w: number;
      if (node === mark) {
        w = mark.offsetWidth;
        markMid = x + w / 2;
      } else {
        const key = node.dataset.dest as DestKey | undefined;
        if (!key) continue;
        const [base, lbl] = sizes.current.get(key) ?? [node.offsetWidth, 0];
        const open = key === active;
        w = base + (open ? lbl : 0);
        // The clip box is driven in PIXELS from here, not by a CSS rule
        // on [aria-current]. `width: auto` is not interpolable, so that
        // rule snapped the capsule to its new width in one frame while
        // the transform below still took --nav-dur to catch up: the bar
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
    // The mark holds the midline; the capsule breathes around it.
    nav.style.transform = `translateX(${-markMid}px)`;
    if (pillX !== null) {
      pill.style.transform = `translateX(${pillX}px)`;
      pill.style.width = `${pillW}px`;
    }
  }, [active]);

  // A button's own width does not change when you click a DIFFERENT one, so
  // measuring is keyed on the destination set alone. It runs first because
  // effects fire in order, and place() reads what it stores.
  useLayoutEffect(() => {
    measure();
  }, [measure, showLive]);

  useLayoutEffect(() => {
    place();
  }, [place, showLive]);

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
      // Leaving the Discover pill means browse, so drop any live query.
      if (d.key === "discover") {
        setQuery("");
        setSearchQuery("");
      }
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
      <nav className="navcap" aria-label="Sections" ref={navRef}>
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
                <span className="navcap__mark" ref={markRef} aria-hidden>
                  <b>
                    <i />
                  </b>
                </span>
              )}
              <button
                type="button"
                data-dest={d.key}
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
      </nav>

      <div className="header__right">
        {/* The search field, out of the old Stream rail and standing on its
          * own. Behaviour is untouched: typing writes the shared store and
          * lands on Discover, clearing does not yank you off the page. */}
        <span
          ref={searchChipRef}
          className={
            "header__searchchip" + (section === "live" ? " header__searchchip--off" : "")
          }
          onClick={() => searchInputRef.current?.focus()}
        >
          <SearchIcon aria-hidden />
          <input
            ref={searchInputRef}
            className="header__searchinput"
            type="search"
            placeholder="Search movies & series…"
            value={query}
            tabIndex={section === "live" ? -1 : 0}
            aria-label="Search movies and series"
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setSearchOpen(false)}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchQuery(e.target.value);
              if (e.target.value !== "" && streamTab !== "discover") {
                onSection("stream");
                onStreamTab("discover");
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                // Ours alone: without stopPropagation the App-level
                // listener also exits OS fullscreen on the same press.
                e.stopPropagation();
                setQuery("");
                setSearchQuery("");
                e.currentTarget.blur();
              }
            }}
          />
        </span>
        {/* Outside the 0.3-opacity icon cluster on purpose: an available
          * update should read at full strength. */}
        <UpdateChip />
        <div className="header__actions">
          {/* Future cosmetic feature (README) — disabled until wired so the
            * hover doesn't tease a click that does nothing. */}
          <button
            type="button"
            className="header__action"
            aria-label="Profile"
            disabled
            title="Coming soon"
          >
            <AccountIcon />
          </button>
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

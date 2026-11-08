import { useEffect, useState, type ComponentType } from "react";
import {
  DiscoverIcon,
  GuideIcon,
  LibraryIcon,
  MultiviewIcon,
  SportsIcon,
  StreamIcon,
} from "../ui/icons";
import { isModalOpen } from "../lib/modalOpen";
import { requestSearchFocus, setSearchQuery } from "../features/discover/searchQuery";
import { formatClock } from "../lib/time";
import { loadClockFormat, onClockFormatChange } from "../features/settings/clockFormat";

/* What the app's two headers share: the Default capsule (AppHeader) and
 * Classic's toolbar (features/classic/ClassicHeader). Both are the same
 * navigation over the same callbacks, so the destinations, the clock, the
 * `/` shortcut and what a press does live once, here. */

/** The app's two SIDES, and Home between them. "Stream" in the top nav is a
 * section header, not a page: the pill rail below picks the actual Stream
 * page. "home" is the page behind the logo (plan 033): on no side, so no tab
 * is current while it shows. */
export type Section = "live" | "stream" | "home";
/** The Stream section's pages (the pill rail). Adding one = a new entry
 * here + in RAIL + a screen in App's switch — nothing else. */
export type StreamTab = "home" | "discover" | "mylist";

/** The Live side's pages, mirroring the Stream rail. Sports is plan 010,
 * shipped behind a BETA badge while its data source is still a bet.
 * Multi-view is plan 017: a tab of its own, between the two. */
export type LiveTab = "guide" | "multiview" | "sports";

/** The key stays the tab's own id, so App and the screens are untouched.
 * "home" is LABELLED "Stream": it is the VOD landing page, and "Home" was
 * the only name in the bar that described a position rather than content. */
export type DestKey = LiveTab | StreamTab;

/**
 * THE DESTINATIONS, flat.
 *
 * The two-level state behind the header (a section and its tab) is
 * UNCHANGED: each entry writes both, so App and every screen carry on as
 * before. `side` is which half of the bar a destination sits in, marked by
 * the app mark between them (or first, with no live half).
 */
export const DESTS: Array<{
  key: DestKey;
  label: string;
  side: Section;
  Icon: ComponentType<{ size?: number; className?: string; filled?: boolean }>;
  /** Sports is plan 010, still behind a badge while its source is a bet. */
  beta?: boolean;
}> = [
  { key: "guide", label: "Guide", side: "live", Icon: GuideIcon },
  { key: "multiview", label: "Multi-View", side: "live", Icon: MultiviewIcon },
  { key: "sports", label: "Sports", side: "live", Icon: SportsIcon, beta: true },
  { key: "home", label: "Stream", side: "stream", Icon: StreamIcon },
  { key: "discover", label: "Discover", side: "stream", Icon: DiscoverIcon },
  { key: "mylist", label: "Library", side: "stream", Icon: LibraryIcon },
];

/** Live clock, minute-accurate (the header shows no seconds). Follows the
 * 12h/24h preference immediately when it changes in Settings. */
export function useClock(): string {
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

export interface HeaderProps {
  section: Section;
  streamTab: StreamTab;
  liveTab: LiveTab;
  /** Live tab renders only while a live source is configured. */
  showLive: boolean;
  onSection: (s: Section) => void;
  onStreamTab: (t: StreamTab) => void;
  /** The Stream, Discover or Library pill pressed while it is the one
   * showing: take that tab home (App counts it; the screen goes). */
  onStreamHome: () => void;
  onLiveTab: (t: LiveTab) => void;
  onOpenSettings: () => void;
  /** The app palette (plan 019, K11). */
  onOpenSearch: () => void;
}

/** `/` and Ctrl+F reach the search field, which lives on Discover. Goes there
 * first and asks for focus through the mailbox in searchQuery. (Ctrl+K opens
 * the app palette since plan 019, K11.) Dispatching a bare event would not
 * survive the trip: DiscoverScreen may not be mounted yet, and App holds the
 * swap back by NAV_SETTLE_MS on top of that.
 *
 * Never while typing in another field, and never while a player is up (its
 * own keys win; #inv-chrome existing = playback chrome mounted). */
export function useSearchShortcut(
  onSection: (s: Section) => void,
  onStreamTab: (t: StreamTab) => void,
): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const slash =
        e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey;
      const combo =
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        e.key.toLowerCase() === "f";
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
      // Nor under Settings or the palette: it switched the tab behind the
      // modal, which stayed up over it.
      if (isModalOpen()) return;
      e.preventDefault();
      onSection("stream");
      onStreamTab("discover");
      // The row is collapsed (and unfocusable) until Discover is the
      // destination, so the focus waits for it to open.
      requestSearchFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSection, onStreamTab]);
}

/** One press on a destination sets BOTH levels, which is what keeps App
 * unchanged. */
export function goDest(
  d: (typeof DESTS)[number],
  p: Pick<HeaderProps, "section" | "streamTab" | "onSection" | "onStreamTab" | "onStreamHome" | "onLiveTab">,
): void {
  if (d.side === "live") {
    p.onSection("live");
    p.onLiveTab(d.key as LiveTab);
  } else {
    // The tab you are on, pressed again, goes home: a title's page back to
    // the rows, a genre back to everything, a list back to the lists. It
    // did nothing, because the tab was already the tab (Adam, v0.11.37:
    // "clicking stream should take you back to stream home page"). The
    // Live tabs have no history to go home from.
    if (p.section === "stream" && d.key === p.streamTab) p.onStreamHome();
    p.onSection("stream");
    // Pressing the Discover pill means browse, so drop any live query.
    // The store is the only copy now — the header kept a mirror of it
    // while the input lived here.
    if (d.key === "discover") setSearchQuery("");
    p.onStreamTab(d.key as StreamTab);
  }
}

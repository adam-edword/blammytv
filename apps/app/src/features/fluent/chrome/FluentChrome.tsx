import { useEffect, useState, type ComponentType } from "react";
import {
  BackArrowIcon,
  DiscoverIcon,
  HomeIcon,
  LibraryIcon,
  MultiviewIcon,
  SearchIcon,
  SettingsIcon,
  SportsIcon,
  StreamIcon,
  TvIcon,
} from "../../../ui/icons";
import { UpdateChip } from "../../../app/UpdateChip";
import { isModalOpen } from "../../../lib/modalOpen";
import { requestSearchFocus, setSearchQuery } from "../../discover/searchQuery";
import type { LiveTab, Section, StreamTab } from "../../../app/AppHeader";
import { loadNavRail, saveNavRail } from "./navPrefs";

/**
 * Fluent's frame (plan 035, "Fluent to tier 3"): a 32px title bar and a left
 * NavigationView, in place of the floating header and its capsule. App
 * renders this where it renders AppHeader, with the same props and the same
 * callbacks, so a tab does exactly what the capsule's did.
 *
 * It is a fragment of two grid items of `.app-shell` (fluent-chrome.css), not
 * a wrapper: the page is the third, and sits right of the pane and under the
 * bar.
 *
 * The window keeps its native title bar (tauri.conf has no `decorations:
 * false`), so this band sits under it. A merged title bar needs the window
 * to draw its own.
 */

type DestKey = LiveTab | StreamTab;
type Icon = ComponentType<{ size?: number; className?: string }>;
interface Item {
  /** The capsule's own key, so `[data-dest]` means the same in both. */
  key: DestKey | "hub";
  label: string;
  Icon: Icon;
  side: Section;
}

const HOME: Item = { key: "hub", label: "Home", Icon: HomeIcon, side: "home" };
const LIVE: Item[] = [
  { key: "guide", label: "Live TV", Icon: TvIcon, side: "live" },
  { key: "multiview", label: "Multi-View", Icon: MultiviewIcon, side: "live" },
  { key: "sports", label: "Sports", Icon: SportsIcon, side: "live" },
];
const STREAM: Item[] = [
  { key: "home", label: "Stream", Icon: StreamIcon, side: "stream" },
  { key: "discover", label: "Discover", Icon: DiscoverIcon, side: "stream" },
  { key: "mylist", label: "Library", Icon: LibraryIcon, side: "stream" },
];

export interface FluentChromeProps {
  section: Section;
  streamTab: StreamTab;
  liveTab: LiveTab;
  /** The Live TV group renders only while a live source is configured. */
  showLive: boolean;
  onSection: (s: Section) => void;
  onStreamTab: (t: StreamTab) => void;
  onStreamHome: () => void;
  onLiveTab: (t: LiveTab) => void;
  /** Settings is a page here, not a modal over the tabs: it is showing, and
   * leaving by a tab closes it. */
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onOpenSearch: () => void;
}

/** Back is the mouse's Back button, sent: every screen that keeps a view
 * stack already listens for it (lib/mouseNav), and App closes Settings or the
 * palette on it. One path, so the arrow can never disagree with the mouse. */
function goBack() {
  for (const type of ["mousedown", "mouseup"])
    window.dispatchEvent(new MouseEvent(type, { button: 3, cancelable: true }));
}

function Hamburger() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden>
      <path d="M2 4h12M2 8h12M2 12h12" />
    </svg>
  );
}

export function FluentChrome(p: FluentChromeProps) {
  const [rail, setRail] = useState(loadNavRail);
  const collapse = () => {
    const next = !rail;
    setRail(next);
    saveNavRail(next);
  };

  // The page and the Settings page read the pane's width from the root, and
  // no screen is to clear a floating header: there isn't one.
  useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute("data-fl-rail", rail);
    return () => root.removeAttribute("data-fl-rail");
  }, [rail]);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--header-h", "0px");
    return () => void root.style.removeProperty("--header-h");
  }, []);

  // `/` and Ctrl+F take you to Discover's search, as the capsule's header did
  // (AppHeader): the field is Discover's own now, so this goes there first
  // and asks for focus through the mailbox.
  const { onSection, onStreamTab } = p;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const slash = e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey;
      const combo = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "f";
      if (!slash && !combo) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (document.getElementById("inv-chrome")) return;
      if (isModalOpen()) return;
      e.preventDefault();
      onSection("stream");
      onStreamTab("discover");
      requestSearchFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSection, onStreamTab]);

  const onHome = p.section === "home";
  const active: DestKey | "hub" | null = onHome ? "hub" : p.section === "live" ? p.liveTab : p.streamTab;
  const selected = p.settingsOpen ? "settings" : active;

  /** The capsule's own go(), with Settings in front: leaving by a tab closes
   * it, and the tab you were on is not "pressed again" for that. */
  const go = (d: Item) => {
    const was = p.settingsOpen;
    if (was) p.onCloseSettings();
    if (d.key === "hub") {
      if (onHome && !was) p.onStreamHome();
      p.onSection("home");
    } else if (d.side === "live") {
      p.onSection("live");
      p.onLiveTab(d.key as LiveTab);
    } else {
      // The tab you are on, pressed again, goes home (Adam, v0.11.37).
      if (!was && p.section === "stream" && d.key === p.streamTab) p.onStreamHome();
      p.onSection("stream");
      if (d.key === "discover") setSearchQuery("");
      p.onStreamTab(d.key as StreamTab);
    }
  };

  const item = (d: Item) => {
    const on = d.key === selected;
    return (
      <button
        key={d.key}
        type="button"
        data-dest={d.key}
        className="flc-ni"
        aria-current={on ? "page" : undefined}
        onClick={() => go(d)}
      >
        <d.Icon />
        <span className="flc-ni__lbl">{d.label}</span>
      </button>
    );
  };
  const sep = (k: string) => <div key={k} className="flc-sep" role="separator" />;

  return (
    <>
      <header className="flc-title">
        <button type="button" className="flc-title__back" aria-label="Back" onClick={goBack}>
          <BackArrowIcon size={14} />
        </button>
        <span className="flc-title__mark" aria-hidden />
        <span className="flc-title__name">BlammyTV</span>
        {/* The search IS Ctrl+K: the palette opens over this pill, its field
          * in the pill's place and its results under it. */}
        <button
          type="button"
          className="flc-search"
          aria-label="Search"
          aria-haspopup="dialog"
          aria-keyshortcuts="Control+K"
          onClick={p.onOpenSearch}
        >
          <SearchIcon size={14} aria-hidden />
          <span className="flc-search__ph">Search channels, films and settings</span>
          <kbd className="flc-search__hint">Ctrl+K</kbd>
        </button>
        <div className="flc-title__right">
          <UpdateChip />
        </div>
      </header>

      <nav className={"flc-pane" + (rail ? " flc-pane--rail" : "")} aria-label="Sections">
        <button
          type="button"
          className="flc-burger"
          aria-label={rail ? "Expand Navigation" : "Collapse Navigation"}
          aria-expanded={!rail}
          onClick={collapse}
        >
          <Hamburger />
        </button>
        {item(HOME)}
        {p.showLive && sep("a")}
        {p.showLive && LIVE.map(item)}
        {sep("b")}
        {STREAM.map(item)}
        <button
          type="button"
          data-key="settings"
          className="flc-ni flc-ni--bottom"
          aria-current={selected === "settings" ? "page" : undefined}
          onClick={p.onOpenSettings}
        >
          <SettingsIcon />
          <span className="flc-ni__lbl">Settings</span>
        </button>
      </nav>
    </>
  );
}

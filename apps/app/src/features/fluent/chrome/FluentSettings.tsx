import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SETTINGS_PAGES, loadSettingsTab, saveSettingsTab, type SettingsTab } from "../../settings/settingsTab";
import { findSettings, settingById, type SettingsFind } from "../../settings/settingsIndex";
import { pageIcon } from "../../settings/pageIcons";
import { SourcesPage } from "../../settings/SourcesPage";
import { PlaybackPage } from "../../settings/PlaybackPage";
import { AppearancePage } from "../../settings/AppearancePage";
import { HomePage } from "../../settings/HomePage";
import { AccountsPage } from "../../settings/AccountsPage";
import { AppPage } from "../../settings/AppPage";
import { SearchIcon } from "../../../ui/icons";
import { Rail } from "../../../ui/Rail";
import { returnFocus } from "../../../lib/returnFocus";
import { liftedRow } from "../../../lib/liftedRow";
import { REDUCED_MOTION } from "../../../lib/reducedMotion";

/**
 * Settings as the Windows 11 Settings app (plan 035): a page in the content
 * area, not a sheet over it. A column of the pages with a "Find a setting"
 * box above them, and on the right a breadcrumb title over the page's own
 * rows, drawn as SettingsCards (fluent-chrome.css; the rows are the ones the
 * sheet has, re-laid out and not rewritten).
 *
 * App mounts it where it mounts SettingsModal, with the same props, so the
 * palette's find, the gear's focus return and the Back button all reach it.
 * It is not a modal: the pane stays live, and a tab closes it. It is
 * portalled OUT of .app-shell for the reason the sheet is: the inverted
 * player cuts a clip-path hole through the shell, and a page inside it would
 * have the video showing through its middle.
 */

/** What each page wears in the column. */
const CATS = SETTINGS_PAGES.map((p) => ({ ...p, icon: pageIcon(p.key, 16) }));

/** The class a found row wears (settings.css), and how long it wears it. */
const FOUND = "setting--found";
const FOUND_MS = 1600;
/** How long a find waits for a row that is not there yet. */
const FOUND_WAIT_MS = 2000;
/** The most rows the find box lists. */
const FOUND_ROWS = 8;

/** The first thing in a row you can put focus on. */
function firstControl(row: HTMLElement): HTMLElement | null {
  for (const el of row.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]")) {
    if (el.tabIndex < 0 || el.matches(":disabled")) continue;
    if (el instanceof HTMLInputElement && el.type === "hidden") continue;
    if (el.getClientRects().length === 0) continue;
    return el;
  }
  return null;
}

export function FluentSettings({
  onClose,
  returnTo,
  find,
}: {
  onClose: () => void;
  /** Where focus goes on close, when whatever opened Settings is about to go. */
  returnTo?: HTMLElement | null;
  /** A row the palette found: open on its page, scroll to it, light it. */
  find?: SettingsFind;
}) {
  const [tab, setTab] = useState<SettingsTab>(() => (find && settingById(find.row)?.page) || loadSettingsTab());
  // What to land on: the palette's find, or one picked from the box here. The
  // `world` is the Live TV / Stream pill its page opens on, once.
  const [target, setTarget] = useState<SettingsFind | undefined>(find);
  const [seed, setSeed] = useState(find?.world);
  const found = useRef(0);

  // A find from the palette while this is up: the page is already mounted, so
  // its props change rather than a new one arriving.
  useEffect(() => {
    if (!find) return;
    const page = settingById(find.row)?.page;
    if (page) {
      saveSettingsTab(page);
      setTab(page);
    }
    setSeed(find.world);
    setTarget(find);
  }, [find]);

  const pick = (t: SettingsTab) => {
    saveSettingsTab(t);
    setTab(t);
    setSeed(undefined);
    setTarget(undefined);
  };
  const toStreamSources = () => {
    saveSettingsTab("sources");
    setTab("sources");
    setSeed("stream");
    setTarget(undefined);
  };

  // The box above the pages: today's settings search (settingsIndex), so a
  // result lands on its row the way a palette find does.
  const [query, setQuery] = useState("");
  const results = findSettings(query, FOUND_ROWS);
  const choose = (id: string) => {
    const row = settingById(id);
    if (!row) return;
    setQuery("");
    saveSettingsTab(row.page);
    setTab(row.page);
    setSeed(row.world);
    setTarget({ row: row.id, world: row.world, n: ++found.current + 1_000_000 });
  };

  const page = useRef<HTMLDivElement | null>(null);
  const card = useRef<HTMLElement | null>(null);
  // A new page starts at the top.
  useEffect(() => {
    if (page.current) page.current.scrollTop = 0;
  }, [tab]);

  // Land on the row: scroll it to the middle, light it, focus it. A row that
  // is not there is not an error (Playback with no source shows a note in its
  // place): the page just opens. As SettingsModal does it.
  useEffect(() => {
    const body = page.current;
    if (!body || !target) return;
    let row: HTMLElement | null = null;
    let lit = 0;
    let giveUp = 0;
    let watch: MutationObserver | null = null;
    const land = (): boolean => {
      row = body.querySelector<HTMLElement>(`[data-setting="${CSS.escape(target.row)}"]`);
      if (!row) return false;
      const shown = row;
      shown.scrollIntoView({ block: "center", behavior: REDUCED_MOTION ? "auto" : "smooth" });
      shown.classList.add(FOUND);
      lit = window.setTimeout(() => shown.classList.remove(FOUND), FOUND_MS);
      firstControl(shown)?.focus({ preventScroll: true });
      return true;
    };
    const stop = () => {
      watch?.disconnect();
      window.clearTimeout(giveUp);
    };
    if (!land()) {
      watch = new MutationObserver(() => {
        if (land()) stop();
      });
      watch.observe(body, { childList: true, subtree: true });
      giveUp = window.setTimeout(stop, FOUND_WAIT_MS);
    }
    return () => {
      stop();
      window.clearTimeout(lit);
      row?.classList.remove(FOUND);
    };
  }, [target, tab]);

  // Focus goes in (the pane's Settings button had it), and comes back to where
  // it was when this closes.
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const a = document.activeElement;
    opener.current = a instanceof HTMLElement && a !== document.body ? a : null;
    if (!find) card.current?.focus({ preventScroll: true });
    return () => {
      const back = returnTo?.isConnected ? returnTo : opener.current;
      // Closing by a tab: that tab has focus, and keeps it.
      if (!document.activeElement || document.activeElement === document.body) returnFocus(back);
    };
    // Once: a later `find` is handled above, and focus is not to be pulled
    // back to the card each time one arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape closes, unless it is something inside's: a Combobox's open list or
  // a lifted row, as the sheet; and the palette or a menu that took it first
  // has marked it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (liftedRow() || document.querySelector("[data-slot=combobox-content][data-open]")) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const label = SETTINGS_PAGES.find((p) => p.key === tab)?.label;

  return createPortal(
    <section
      ref={card}
      className="flc-sx"
      aria-label="Settings"
      tabIndex={-1}
      // The kit's name for an open dialog: Multi-view's keys stand down while
      // one is up (mvKeys.forMultiview).
      data-slot="dialog-content"
    >
      <div className="flc-sx__cats">
        <div className="flc-find">
          <input
            type="search"
            className="flc-find__input"
            placeholder="Find a setting"
            aria-label="Find a setting"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) choose(results[0].id);
              // Clears the box first; a second Escape is the page's.
              else if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              }
            }}
          />
          <SearchIcon size={14} aria-hidden />
        </div>
        {query.trim() ? (
          <ul className="flc-found" aria-label="Settings found">
            {results.map((r) => (
              <li key={r.id}>
                <button type="button" className="flc-found__row" onClick={() => choose(r.id)}>
                  <span>{r.label}</span>
                  <small>{SETTINGS_PAGES.find((p) => p.key === r.page)?.label}</small>
                </button>
              </li>
            ))}
            {results.length === 0 && <li className="flc-found__none">Nothing matches that.</li>}
          </ul>
        ) : (
          <Rail className="flc-rail" label="Settings" items={CATS} value={tab} onChange={pick} />
        )}
      </div>
      <div className="flc-sx__main">
        <h1 className="flc-sx__title">
          <span>Settings</span>
          <span aria-hidden>›</span>
          <span>{label}</span>
        </h1>
        <div className="flc-sx__page" role="tabpanel" aria-label={label} ref={page}>
          {tab === "sources" && <SourcesPage key={`s${seed ?? ""}`} initialWorld={seed} />}
          {tab === "playback" && <PlaybackPage onSignIn={toStreamSources} />}
          {tab === "appearance" && <AppearancePage key={`a${seed ?? ""}`} initialWorld={seed} onSignIn={toStreamSources} />}
          {tab === "home" && <HomePage />}
          {tab === "accounts" && <AccountsPage />}
          {tab === "app" && <AppPage />}
        </div>
      </div>
    </section>,
    document.body,
  );
}

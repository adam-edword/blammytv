import { Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { UpdateChip } from "../../app/UpdateChip";
import {
  DESTS,
  goDest,
  useClock,
  useSearchShortcut,
  type HeaderProps,
} from "../../app/headerShared";
import { useAddress, type Address } from "../../lib/address";
import { requestNav } from "../../lib/mouseNav";
import { BrandMark } from "../../ui/BrandMark";
import { SearchIcon, SettingsIcon, SparkleIcon } from "../../ui/icons";
import { getGenreChoice, onGenreChoiceChange, requestGenreChoice } from "../discover/genreChoice";
import { isRecommendOpen, onRecommendChange, requestRecommend } from "../discover/recommend";
import {
  getSearchQuery,
  onSearchFocusRequest,
  onSearchQueryChange,
  setSearchQuery,
  takeSearchFocus,
} from "../discover/searchQuery";
import { tmdbEnabled } from "../discover/tmdb";
import { getTypeFilter, onTypeFilterChange, requestTypeFilter, type TypeFilter } from "../discover/typeFilter";
import { lookupLive, onLiveRefreshed } from "../live/source";
import { onGamesToday, peekGamesToday } from "../home/liveData";

/**
 * Classic's header (plan 035, tier 3: layout may change here and in the
 * dialogs). A thin top bar, one toolbar row of flat buttons, an address bar
 * and, along the bottom, a status bar. Discover adds a band under the toolbar
 * and turns the address bar into its search field.
 *
 * THE SAME NAVIGATION as the capsule: the props are AppHeader's, a press goes
 * through goDest, and Home, Back and the `/` shortcut do what they do there.
 * The buttons carry the capsule's `data-dest` keys, so a harness's goTo
 * finds them in either header.
 *
 * The chrome is solid grey, so a page scrolls behind it. --header-h is the
 * chrome's height, published as AppHeader does, and every screen already
 * starts below that. Discover's band is not in it (it would move the page the
 * way the capsule's second row once did); classic.css clears it on Discover.
 */

function Arrow({ dir }: { dir: "back" | "forward" }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      {dir === "back" ? <path d="M13 8l-4 4 4 4M9 12h7" /> : <path d="M11 8l4 4-4 4M15 12H8" />}
    </svg>
  );
}
/** Where you are, as the address bar says it. */
function addressOf(p: Pick<HeaderProps, "section" | "liveTab" | "streamTab"> & Address): string {
  if (p.settings) return `BlammyTV › Settings › ${p.settings}`;
  if (p.section === "home") return "BlammyTV › Home";
  if (p.title && p.section === "stream" && p.streamTab === "home") return `BlammyTV › Stream › ${p.title}`;
  const d = DESTS.find((x) => x.key === (p.section === "live" ? p.liveTab : p.streamTab));
  const label = d?.key === "home" ? "Home" : (d?.label ?? "");
  return `BlammyTV › ${p.section === "live" ? "Live TV" : "Stream"} › ${label}`;
}

const SCOPE: Record<TypeFilter, string> = { all: "Movies & Series", movie: "Movies", series: "Series" };

function useStatus(showLive: boolean) {
  const channels = useSyncExternalStore(onLiveRefreshed, () => lookupLive()?.channels.length ?? 0);
  const games = useSyncExternalStore(onGamesToday, peekGamesToday);
  return [
    showLive && channels > 0 ? `${channels} channels` : null,
    games !== null ? `${games} ${games === 1 ? "game" : "games"} today` : null,
  ].filter((x): x is string => x !== null);
}

export function ClassicHeader(props: HeaderProps) {
  const { section, streamTab, liveTab, showLive, onSection, onStreamTab, onOpenSettings, onOpenSearch } = props;
  const clock = useClock();
  const { title, settings } = useAddress();
  const status = useStatus(showLive);
  useSearchShortcut(onSection, onStreamTab);

  const onHome = section === "home";
  const active = onHome ? null : section === "live" ? liveTab : streamTab;
  const onDiscover = section === "stream" && streamTab === "discover";

  // The chrome's height, for --header-h.
  const ref = useRef<HTMLElement>(null);
  const toolsRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const tools = toolsRef.current;
    if (!el || !tools) return;
    // Labels never wrap. When the row does not fit with them, the buttons
    // drop to their icons (data-compact; the name stays as aria-label and
    // tooltip), as Windows' "No text labels" did. Measured with the labels
    // back on, in the same task, so nothing paints in between.
    const publish = () => {
      el.removeAttribute("data-compact");
      if (tools.scrollWidth > tools.clientWidth) el.setAttribute("data-compact", "");
      document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`);
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showLive]);

  const shown = DESTS.filter((d) => showLive || d.side !== "live");
  const goHub = () => {
    if (onHome) props.onStreamHome();
    onSection("home");
  };

  return (
    <>
      <header className="header cl-header" ref={ref}>
        <div className="cl-menu">
          <BrandMark size={16} />
          <b>BlammyTV</b>
        </div>
        <nav className="cl-tools" aria-label="Sections" ref={toolsRef}>
          <button type="button" className="cl-tb" data-cl="back" aria-label="Back" title="Back" onClick={() => requestNav("back")}>
            <Arrow dir="back" />
            <span className="cl-tb__t">Back</span>
          </button>
          <button type="button" className="cl-tb" data-cl="forward" aria-label="Forward" title="Forward" onClick={() => requestNav("forward")}>
            <Arrow dir="forward" />
          </button>
          <span className="cl-sep" aria-hidden />
          {shown.map((d, i) => {
            const prev = shown[i - 1];
            const on = d.key === active;
            return (
              <Fragment key={d.key}>
                {/* Home sits between the halves, or first with no live half. */}
                {(prev ? prev.side !== d.side : !showLive) && (
                  <>
                    {prev && <span className="cl-sep" aria-hidden />}
                    <button
                      type="button"
                      className={"cl-tb" + (onHome ? " cl-tb--on" : "")}
                      data-dest="hub"
                      aria-current={onHome ? "page" : undefined}
                      aria-label="Home"
                      title="Home"
                      onClick={goHub}
                    >
                      <BrandMark size={22} />
                      <span className="cl-tb__t">Home</span>
                    </button>
                    <span className="cl-sep" aria-hidden />
                  </>
                )}
                <button
                  type="button"
                  className={"cl-tb" + (on ? " cl-tb--on" : "")}
                  data-dest={d.key}
                  aria-current={on ? "page" : undefined}
                  aria-label={d.key === "guide" ? "Live TV" : d.beta ? `${d.label} (beta)` : d.label}
                  title={d.key === "guide" ? "Live TV" : d.label}
                  onClick={() => goDest(d, props)}
                >
                  <d.Icon size={22} filled={on} />
                  <span className="cl-tb__t">{d.key === "guide" ? "Live TV" : d.label}</span>
                </button>
              </Fragment>
            );
          })}
          <span className="cl-grow" />
          <UpdateChip />
          <button
            type="button"
            className="cl-tb"
            data-cl="goto"
            aria-keyshortcuts="Control+K"
            aria-label="Go To"
            title="Go To (Ctrl+K)"
            onClick={onOpenSearch}
          >
            <SearchIcon size={22} />
            <span className="cl-tb__t">
              Go To <span className="cl-keys">(Ctrl+K)</span>
            </span>
          </button>
          <button type="button" className="cl-tb" data-cl="settings" aria-label="Settings" title="Settings" onClick={onOpenSettings}>
            <SettingsIcon size={22} />
            <span className="cl-tb__t">Settings</span>
          </button>
        </nav>
        <ClassicAddress onDiscover={onDiscover} address={addressOf({ section, liveTab, streamTab, title, settings })} />
        {onDiscover && <ClassicBand />}
      </header>
      <footer className="cl-status" aria-label="Status">
        <span className="cl-status__grow">Ready</span>
        {status.map((s) => (
          <span key={s}>{s}</span>
        ))}
        <span data-cl="clock">{clock}</span>
      </footer>
    </>
  );
}

/** The address bar: where you are, and on Discover its search field. */
function ClassicAddress({ onDiscover, address }: { onDiscover: boolean; address: string }) {
  const [query, setQuery] = useState(getSearchQuery);
  useEffect(() => onSearchQueryChange(setQuery), []);
  const [filter, setFilter] = useState<TypeFilter>(getTypeFilter);
  useEffect(() => onTypeFilterChange(setFilter), []);
  const inputRef = useRef<HTMLInputElement>(null);
  // `/` and Ctrl+F ask for the field before it exists (see
  // useSearchShortcut), so the request waits until Discover is up.
  useEffect(() => {
    const focus = () => {
      if (!onDiscover) return;
      if (!takeSearchFocus()) return;
      inputRef.current?.focus();
    };
    focus();
    return onSearchFocusRequest(focus);
  }, [onDiscover]);

  if (!onDiscover)
    return (
      <div className="cl-addr">
        <span className="cl-label">Address</span>
        <div className="cl-field" role="status" aria-label="Address" data-cl="address">
          <BrandMark size={16} />
          <span>{address}</span>
        </div>
      </div>
    );
  return (
    <form className="cl-addr" role="search" onSubmit={(e) => e.preventDefault()}>
      <label className="cl-label" htmlFor="cl-search">
        Search
      </label>
      <div className="cl-field">
        <input
          id="cl-search"
          ref={inputRef}
          type="search"
          placeholder={`Search ${SCOPE[filter]}…`}
          value={query}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              // Ours alone: without stopPropagation the App-level listener
              // also exits OS fullscreen on the same press.
              e.stopPropagation();
              setSearchQuery("");
              e.currentTarget.blur();
            }
          }}
        />
      </div>
      <button type="submit" className="cl-go">
        Go
      </button>
    </form>
  );
}

/** Discover's band: Show, Movies and Series, and REC at the right. */
function ClassicBand() {
  const [filter, setFilter] = useState<TypeFilter>(getTypeFilter);
  useEffect(() => onTypeFilterChange(setFilter), []);
  const genre = useSyncExternalStore(onGenreChoiceChange, getGenreChoice);
  const [recOpen, setRecOpen] = useState(isRecommendOpen);
  useEffect(() => onRecommendChange(setRecOpen), []);
  // REC needs a TMDB key. Read once, as the capsule's chip does.
  const [recAvailable] = useState(tmdbEnabled);
  // Neither toggle pressed is Any; pressing the pressed one goes back to it.
  const toggle = (f: "movie" | "series") => requestTypeFilter(filter === f && !recOpen ? "all" : f);
  return (
    <div className="cl-band" role="group" aria-label="Discover">
      <label className="cl-label" htmlFor="cl-genre">
        Show:
      </label>
      <span className="cl-combo">
        <select
          id="cl-genre"
          value={genre.current ?? ""}
          onChange={(e) => requestGenreChoice(e.target.value || null)}
        >
          <option value="">Any Genre</option>
          {genre.genres.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <b aria-hidden>▼</b>
      </span>
      <button type="button" className="cl-tog" aria-pressed={!recOpen && filter === "movie"} onClick={() => toggle("movie")}>
        Movies
      </button>
      <button type="button" className="cl-tog" aria-pressed={!recOpen && filter === "series"} onClick={() => toggle("series")}>
        Series
      </button>
      <span className="cl-grow" />
      {recAvailable && (
        <button type="button" className="cl-tog cl-rec" aria-pressed={recOpen} onClick={() => requestRecommend()}>
          <SparkleIcon size={18} />
          Find Something to Watch…
        </button>
      )}
    </div>
  );
}

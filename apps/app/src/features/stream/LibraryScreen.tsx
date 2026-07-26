import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Tilt from "react-parallax-tilt";
import { Card, ContinueCard, RowScroller } from "./StreamScreen";
import { REDUCED_MOTION } from "../../lib/reducedMotion";
import { useMouseNav } from "../../lib/mouseNav";
import { useViewStack } from "../../lib/viewStack";
import { NameField } from "../../ui/NameField";
import {
  createList,
  deleteList,
  listArt,
  loadLists,
  removeFromList,
  renameList,
  setCover,
  type UserList,
} from "./lists";
import type { ListEntry } from "./myList";
import { requestOpenInStream, requestResumeInStream } from "./openRequest";
import type { VodItem } from "./model";
import {
  clearAllWatching,
  clearWatching,
  loadWatching,
  retiredFromContinue,
  type WatchEntry,
} from "./watching";
import {
  loadCardMeta,
  onCardMetaChange,
  type CardMetaField,
} from "../settings/cardMeta";

/**
 * Library (plan 009): Discover's shape, with Continue Watching where the
 * genre row sits and the user's LISTS where the title grid sits.
 *
 * Two views, no router: the root (row + grid of lists) and a drill-down
 * (one list's contents, or the whole watch history). The built-in Library
 * card is the uncapped view of everything started, which is the part the
 * row itself cannot show because the row obeys the row-cap setting.
 *
 * Playback lives in StreamScreen, so both card kinds ask rather than play:
 * titles through the item mailbox, resumes through the resume mailbox.
 */

/** A stored snapshot re-shaped for the shared Card. Opening resolves fresh
 * full meta exactly like a Discover pick. */
const toItem = (e: ListEntry): VodItem => ({
  id: e.id,
  title: e.title,
  kind: e.kind,
  ...(e.poster ? { poster: e.poster } : {}),
  ...(e.backdrop ? { backdrop: e.backdrop } : {}),
  ...(e.logo ? { logo: e.logo } : {}),
  ...(e.year != null ? { year: e.year } : {}),
  ...(e.rating != null ? { rating: e.rating } : {}),
  ...(e.runtimeMin != null ? { runtimeMin: e.runtimeMin } : {}),
  genres: [],
  cast: [],
  seasons: [],
});

/** The built-in card's id. Not a real list, so it can never be renamed,
 * deleted, or collide with a generated list id (which are `l`-prefixed). */
const HISTORY = "__history";

type View = { at: "root" } | { at: "list"; id: string };

/** Downscale an uploaded cover before it is stored. A phone photo is
 * multiple MB and these live in localStorage next to the app's other
 * config; bounded, a cover is tens of KB. See plan 009 for why not IDB. */
const COVER_MAX = 320;
function toCover(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, COVER_MAX / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      const ctx = c.getContext("2d");
      if (!ctx) return reject(new Error("no 2d context"));
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("not an image"));
    };
    img.src = url;
  });
}

export function LibraryScreen() {
  const [lists, setLists] = useState<UserList[]>(loadLists);
  const [watching, setWatching] = useState<WatchEntry[]>(loadWatching);
  const {
    view,
    scrollRef,
    navigate,
    goBack,
    goForward,
    replace: replaceView,
    reset: resetHistory,
  } = useViewStack<View>({ at: "root" });
  const [metaFields, setMetaFields] = useState<CardMetaField[]>(loadCardMeta);
  useEffect(() => onCardMetaChange(setMetaFields), []);

  // Movies and series mix in every grid here, so always say which is which
  // (same rule as Discover's All Content).
  const gridMetaFields = useMemo(
    () =>
      metaFields.includes("kind") ? metaFields : [...metaFields, "kind" as const],
    [metaFields],
  );

  // Finished movies retire from the ROW (display-only, the entry survives
  // for resume bookkeeping) but stay in the history view, which is the
  // point of having a history view.
  const active = useMemo(
    () => watching.filter((e) => !retiredFromContinue(e)),
    [watching],
  );

  useMouseNav(goBack, goForward);

  const openItem = useCallback(
    (item: VodItem) => requestOpenInStream(item, "mylist"),
    [],
  );
  const refresh = useCallback(() => setLists(loadLists()), []);

  // Naming happens IN the grid, not in a Chromium dialog: a native prompt
  // is the one thing on screen the app cannot style, and it breaks the
  // frame at exactly the moment the user is making something.
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const commitNew = useCallback(
    (name: string) => {
      setCreating(false);
      if (name.trim()) {
        createList(name);
        refresh();
      }
    },
    [refresh],
  );

  const commitRename = useCallback(
    (id: string, name: string) => {
      setRenaming(false);
      if (name.trim()) {
        renameList(id, name);
        refresh();
      }
    },
    [refresh],
  );

  // Destructive actions take two clicks and self-disarm, the same shape as
  // Settings' Clear All Login Info. One pattern, no native confirm. `armed`
  // holds WHICH action is armed, so arming one disarms the other rather
  // than leaving two live triggers on the same bar.
  const [armed, setArmed] = useState<"delete" | "history" | null>(null);
  const delTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(delTimer.current), []);
  const arm = useCallback((which: "delete" | "history") => {
    setArmed(which);
    window.clearTimeout(delTimer.current);
    delTimer.current = window.setTimeout(() => setArmed(null), 4000);
  }, []);
  const disarm = useCallback(() => {
    window.clearTimeout(delTimer.current);
    setArmed(null);
  }, []);

  const clearHistory = useCallback(() => {
    if (armed !== "history") return arm("history");
    disarm();
    setWatching(clearAllWatching());
  }, [armed, arm, disarm]);

  const remove = useCallback(
    (l: UserList) => {
      if (armed !== "delete") return arm("delete");
      disarm();
      deleteList(l.id);
      // History would point at a list that no longer exists, so it goes
      // with it: back and forward both land on the root.
      resetHistory();
      replaceView({ at: "root" });
      refresh();
    },
    [armed, arm, disarm, refresh, resetHistory, replaceView],
  );

  const pickCover = useCallback(
    (l: UserList) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        void toCover(file)
          .then((data) => {
            setCover(l.id, data);
            refresh();
          })
          .catch(() => {});
      };
      input.click();
    },
    [refresh],
  );

  // ---- drill-down ----
  if (view.at === "list") {
    const isHistory = view.id === HISTORY;
    const list = lists.find((l) => l.id === view.id);
    if (!isHistory && !list) {
      // Deleted from under us; the root is always a valid place to be.
      replaceView({ at: "root" });
      return null;
    }
    return (
      <div ref={scrollRef} className="discover library">
        <div className="library__bar">
          <button type="button" className="vod-back" onClick={goBack}>
            ← Back
          </button>
          {!isHistory && list && renaming ? (
            <NameField
              initial={list.name}
              onCommit={(v) => commitRename(list.id, v)}
              onCancel={() => setRenaming(false)}
              className="library__heading-input"
            />
          ) : (
            <h2 className="library__heading">
              {isHistory ? "Library" : list?.name}
            </h2>
          )}
          {isHistory && watching.length > 0 && (
            <div className="library__bar-actions">
              <button
                type="button"
                className={
                  "library__action library__action--danger" +
                  (armed === "history" ? " library__action--armed" : "")
                }
                onClick={clearHistory}
              >
                {armed === "history"
                  ? "Click again to confirm"
                  : "Clear history"}
              </button>
            </div>
          )}
          {!isHistory && list && (
            <div className="library__bar-actions">
              <button
                type="button"
                className="library__action"
                onClick={() => pickCover(list)}
              >
                Set cover
              </button>
              <button
                type="button"
                className="library__action"
                onClick={() => setRenaming(true)}
              >
                Rename
              </button>
              <button
                type="button"
                className={
                  "library__action library__action--danger" +
                  (armed === "delete" ? " library__action--armed" : "")
                }
                onClick={() => remove(list)}
              >
                {armed === "delete" ? "Click again to confirm" : "Delete"}
              </button>
            </div>
          )}
        </div>
        {(isHistory ? watching.length : (list?.entries.length ?? 0)) === 0 ? (
          <p className="discover__note">
            {isHistory
              ? "Nothing watched yet. Anything you start shows up here."
              : "This list is empty. Open a title and use Add to Library to put it here."}
          </p>
        ) : (
          <div className="disc-grid">
            {isHistory
              ? watching.map((e) => (
                  <ContinueCard
                    key={`${e.id}:${e.episodeId ?? ""}`}
                    entry={e}
                    metaFields={gridMetaFields}
                    onOpen={() => requestResumeInStream(e)}
                    onSources={() => requestResumeInStream(e)}
                    onClear={() => setWatching(clearWatching(e.id))}
                  />
                ))
              : (list?.entries ?? []).map((e) => (
                  <div key={e.id} className="library__item">
                    <Card
                      item={toItem(e)}
                      metaFields={gridMetaFields}
                      onOpen={openItem}
                    />
                    <button
                      type="button"
                      className="library__remove"
                      aria-label={`Remove ${e.title} from ${list?.name ?? "list"}`}
                      onClick={() => {
                        if (list) removeFromList(list.id, e.id);
                        refresh();
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
          </div>
        )}
      </div>
    );
  }

  // ---- root ----
  return (
    <div ref={scrollRef} className="discover library">
      {active.length > 0 && (
        <section className="media-row">
          <h3 className="media-row__title">Continue Watching</h3>
          <RowScroller>
            {active.map((e) => (
              <ContinueCard
                key={`${e.id}:${e.episodeId ?? ""}`}
                entry={e}
                metaFields={metaFields}
                onOpen={() => requestResumeInStream(e)}
                onSources={() => requestResumeInStream(e)}
                onClear={() => setWatching(clearWatching(e.id))}
              />
            ))}
          </RowScroller>
        </section>
      )}

      <section className="library__lists">
        <h3 className="media-row__title">Your lists</h3>
        {/* Nothing watched and nothing saved: say what this page is FOR.
          * The "+" card stays, so the empty state is still a place you can
          * act from rather than a dead end. */}
        {watching.length === 0 && lists.length === 0 && (
          <p className="discover__note library__empty">
            Anything you start watching lands in your Library on its own. Make
            a list to keep the things you want to come back to.
          </p>
        )}
        <div className="disc-grid">
          {/* Only once there IS history: a built-in card reading "0 titles"
            * is a dead end, and the note above already explains it. */}
          {watching.length > 0 && (
            <ListCard
              name="Library"
              count={watching.length}
              art={watching.find((e) => e.art)?.art}
              onOpen={() => navigate({ at: "list", id: HISTORY })}
            />
          )}
          {lists.map((l) => (
            <ListCard
              key={l.id}
              name={l.name}
              count={l.entries.length}
              art={listArt(l)}
              onOpen={() => navigate({ at: "list", id: l.id })}
            />
          ))}
          {creating ? (
            <div className="library__new library__new--editing">
              <NameField
                initial=""
                placeholder="List name"
                onCommit={commitNew}
                onCancel={() => setCreating(false)}
                className="library__new-input"
              />
            </div>
          ) : (
            <button
              type="button"
              className="library__new"
              onClick={() => setCreating(true)}
            >
              <span className="library__new-plus" aria-hidden>
                +
              </span>
              New list
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

/** A list, shaped like a poster card (Adam's call: the grid should read as
 * the same object language as the rest of the app). Art is the uploaded
 * cover, else the newest entry's poster, else a lettermark. */
function ListCard({
  name,
  count,
  art,
  onOpen,
}: {
  name: string;
  count: number;
  art?: string;
  onOpen: () => void;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [art]);
  return (
    <button
      type="button"
      className="stream-card library__card"
      title={name}
      onClick={onOpen}
    >
      {/* A poster card in every respect, lean and glare included: the grid
        * reads as one object language, so a list should not feel like a
        * different KIND of thing from the titles inside it. Props match
        * Card exactly rather than being re-tuned here. */}
      <Tilt
        className="stream-card__tilt library__cover"
        tiltEnable={!REDUCED_MOTION}
        tiltMaxAngleX={5}
        tiltMaxAngleY={5}
        scale={REDUCED_MOTION ? 1 : 1.03}
        transitionSpeed={650}
        glareEnable={!REDUCED_MOTION}
        glareMaxOpacity={0.12}
        glarePosition="all"
        glareBorderRadius="25px"
      >
        {art && !broken ? (
          <img
            className="stream-card__poster"
            src={art}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setBroken(true)}
          />
        ) : (
          <span className="stream-card__mono">{name.slice(0, 1)}</span>
        )}
      </Tilt>
      <span className="stream-card__name">{name}</span>
      <span className="stream-card__meta">
        {count} {count === 1 ? "title" : "titles"}
      </span>
    </button>
  );
}

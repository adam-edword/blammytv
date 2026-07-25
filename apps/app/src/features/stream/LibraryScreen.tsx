import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, ContinueCard, RowScroller } from "./StreamScreen";
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
  const [view, setView] = useState<View>({ at: "root" });
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

  const openItem = useCallback(
    (item: VodItem) => requestOpenInStream(item, "mylist"),
    [],
  );
  const refresh = useCallback(() => setLists(loadLists()), []);

  const newList = useCallback(() => {
    const name = window.prompt("Name this list");
    if (name?.trim()) {
      createList(name);
      refresh();
    }
  }, [refresh]);

  const rename = useCallback(
    (l: UserList) => {
      const name = window.prompt("Rename list", l.name);
      if (name?.trim()) {
        renameList(l.id, name);
        refresh();
      }
    },
    [refresh],
  );

  const remove = useCallback(
    (l: UserList) => {
      if (!window.confirm(`Delete “${l.name}”? The titles in it are not
deleted from anywhere else.`))
        return;
      deleteList(l.id);
      setView({ at: "root" });
      refresh();
    },
    [refresh],
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
      setView({ at: "root" });
      return null;
    }
    return (
      <div className="discover library">
        <div className="library__bar">
          <button
            type="button"
            className="vod-back"
            onClick={() => setView({ at: "root" })}
          >
            ← Back
          </button>
          <h2 className="library__heading">
            {isHistory ? "Library" : list?.name}
          </h2>
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
                onClick={() => rename(list)}
              >
                Rename
              </button>
              <button
                type="button"
                className="library__action library__action--danger"
                onClick={() => remove(list)}
              >
                Delete
              </button>
            </div>
          )}
        </div>
        {(isHistory ? watching.length : (list?.entries.length ?? 0)) === 0 ? (
          <p className="discover__note">
            {isHistory
              ? "Nothing watched yet. Anything you start shows up here."
              : "This list is empty. Save a title from its page to add it."}
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
    <div className="discover library">
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
        <div className="disc-grid">
          <ListCard
            name="Library"
            count={watching.length}
            art={watching.find((e) => e.art)?.art}
            onOpen={() => setView({ at: "list", id: HISTORY })}
          />
          {lists.map((l) => (
            <ListCard
              key={l.id}
              name={l.name}
              count={l.entries.length}
              art={listArt(l)}
              onOpen={() => setView({ at: "list", id: l.id })}
            />
          ))}
          <button type="button" className="library__new" onClick={newList}>
            <span className="library__new-plus" aria-hidden>
              +
            </span>
            New list
          </button>
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
      {/* Same structure as a poster card so the grid reads as one object
        * language. No Tilt: these are destinations, not titles, and the
        * lean belongs to the thing you actually play. */}
      <span className="stream-card__tilt library__cover">
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
      </span>
      <span className="stream-card__name">{name}</span>
      <span className="stream-card__meta">
        {count} {count === 1 ? "title" : "titles"}
      </span>
    </button>
  );
}

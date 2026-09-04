import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pick, remember } from "./pick";
import { findByWords, imdbIdFor, tmdbEnabled } from "./tmdb";
import { resolveVodItem } from "../stream/source";
import type { VodItem } from "../stream/model";
import { CloseIcon, SparkleIcon } from "../../ui/icons";

/**
 * "Give me something to watch."
 *
 * Type a word, press Enter, it becomes a chip. Add a few. Press Find and it
 * picks ONE thing and offers it.
 *
 * WHY ONE AND NOT A GRID. A grid of forty results is the problem this
 * feature exists to escape — the app already has three of those. The answer
 * to "I don't know what to watch" is a title, not more browsing. Find again
 * rerolls, and `remember` keeps the last dozen out of the running so the
 * second press is a different film.
 *
 * THE CHAIN, and why it is this shape:
 *
 *   words -> TMDB keyword ids -> candidate titles -> pick ONE
 *         -> that one's IMDb id -> the user's own addons -> a real item
 *
 * Only the picked candidate is converted and resolved. Doing it for the
 * whole list would be one request per title for an answer that discards all
 * but one of them.
 */

/** How many candidates to try before giving up on a roll. A TMDB title can
 * have no IMDb id, and an addon can fail to resolve one that does; both are
 * per-title accidents rather than a failed search, so the roll walks on
 * instead of reporting nothing. Bounded because each step is a request. */
const TRIES = 4;

type State =
  | { at: "idle" }
  | { at: "finding" }
  | { at: "result"; item: VodItem; note: string }
  | { at: "empty"; note: string }
  | { at: "error"; message: string };

export function Recommender({
  kind,
  posters,
  onOpen,
}: {
  /** Follows the header's type filter: "Any" searches films. */
  kind: "movie" | "series";
  /** Artwork for the drifting wall behind. Passed in rather than fetched:
   * the screen that renders this already has a page of the catalog, and a
   * decorative backdrop must not cost a request of its own. */
  posters: string[];
  onOpen: (item: VodItem) => void;
}) {
  const [words, setWords] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<State>({ at: "idle" });
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** Ids offered recently, so a reroll is a different film. */
  const recent = useRef<string[]>([]);
  /** Bumped on every new roll; a stale one must not land its result. */
  const gen = useRef(0);

  useEffect(() => inputRef.current?.focus(), []);

  const addWord = useCallback(() => {
    const w = draft.trim().toLowerCase();
    setDraft("");
    if (!w) return;
    // Deduped: two identical chips would ask TMDB the same question twice
    // and narrow nothing.
    setWords((prev) => (prev.includes(w) ? prev : [...prev, w]));
  }, [draft]);

  const drop = useCallback(
    (w: string) => setWords((prev) => prev.filter((x) => x !== w)),
    [],
  );

  const find = useCallback(async () => {
    if (words.length === 0) return;
    const mine = ++gen.current;
    setState({ at: "finding" });
    try {
      const found = await findByWords(words, kind);
      if (mine !== gen.current) return;
      const notes: string[] = [];
      if (found.relaxed)
        notes.push("nothing had all of those, so this has one of them");
      // Named because the two vocabularies behave differently and it is
      // not guessable which one a word landed in: "horror" is a genre
      // there, "space" is a keyword.
      if (found.genres.length)
        notes.push(`${found.genres.join(", ")} as a genre`);
      if (found.unknown.length)
        notes.push(`no tag for ${found.unknown.join(", ")}`);
      const note = notes.join(" · ");
      if (found.candidates.length === 0)
        return setState({ at: "empty", note });

      // Walk the shortlist until one actually resolves. Each miss is a
      // per-title accident, not a failed search.
      let pool = found.candidates;
      for (let i = 0; i < TRIES && pool.length > 0; i++) {
        const chosen = pick(pool, recent.current);
        if (!chosen) break;
        pool = pool.filter((c) => c.id !== chosen.id);
        const imdb = await imdbIdFor(chosen);
        if (mine !== gen.current) return;
        if (!imdb) continue;
        const item = await resolveVodItem(kind, imdb);
        if (mine !== gen.current) return;
        if (!item) continue;
        recent.current = remember(recent.current, chosen.id);
        return setState({ at: "result", item, note });
      }
      setState({ at: "empty", note });
    } catch (e) {
      if (mine !== gen.current) return;
      setState({
        at: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [words, kind]);

  /** A stable, non-repeating shuffle of whatever art was passed in, so the
   * wall is not four copies of the same poster in a row. */
  const wall = useMemo(() => {
    const src = posters.filter(Boolean);
    if (src.length === 0) return [];
    const out: string[] = [];
    // Three rows of twelve reads as a wall without asking the compositor
    // for hundreds of layers.
    for (let i = 0; i < 36; i++) out.push(src[i % src.length]);
    return out;
  }, [posters]);

  const ready = tmdbEnabled();

  return (
    <div className="rec">
      {/* THE WALL. aria-hidden and pointer-events:none in CSS — it is
        * wallpaper, and every poster in it is a link to nothing. */}
      <div className="rec__wall" aria-hidden>
        {[0, 1, 2].map((row) => {
          const twelve = wall.slice(row * 12, row * 12 + 12);
          // TWICE, and the CSS depends on it: the drift ends at
          // translateX(-50%), where the second copy sits exactly where the
          // first began. One copy would slide off and leave a gap.
          return (
            <div key={row} className={`rec__wallrow rec__wallrow--${row}`}>
              {[...twelve, ...twelve].map((src, i) => (
                <span key={i} className="rec__wallcard">
                  <img src={src} alt="" loading="lazy" draggable={false} />
                </span>
              ))}
            </div>
          );
        })}
      </div>

      <div className="rec__stage">
        {words.length > 0 && (
          <div className="rec__chips">
            {words.map((w) => (
              <button
                key={w}
                type="button"
                className="rec__chip"
                onClick={() => drop(w)}
                aria-label={`Remove ${w}`}
              >
                {w}
                <CloseIcon size={14} />
              </button>
            ))}
          </div>
        )}

        <div className="rec__bar">
          <input
            ref={inputRef}
            className="rec__input"
            type="text"
            placeholder="What do you want to watch?"
            aria-label="Add a keyword"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addWord();
              }
              // Backspace on an empty field takes the last chip back, the
              // way every tag input does.
              if (e.key === "Backspace" && !draft && words.length)
                setWords((prev) => prev.slice(0, -1));
              if (e.key === "Escape") e.stopPropagation();
            }}
          />
          <button
            type="button"
            className="rec__go"
            aria-label="Find something to watch"
            disabled={words.length === 0 || state.at === "finding"}
            onClick={() => void find()}
          >
            <SparkleIcon size={20} />
          </button>
        </div>

        {!ready && (
          <p className="rec__note">
            Add a TMDB key in the console with <code>btvTmdb("your-key")</code>{" "}
            to switch this on.
          </p>
        )}

        {state.at === "finding" && <p className="rec__note">Looking…</p>}

        {state.at === "empty" && (
          <p className="rec__note">
            Nothing came back{state.note ? ` (${state.note})` : ""}. Try fewer
            words.
          </p>
        )}

        {state.at === "error" && (
          <p className="rec__note rec__note--bad">{state.message}</p>
        )}

        {state.at === "result" && (
          <div className="rec__pick">
            <button
              type="button"
              className="rec__card"
              onClick={() => onOpen(state.item)}
            >
              {state.item.poster && (
                <img src={state.item.poster} alt="" draggable={false} />
              )}
              <span className="rec__cardname">
                {state.item.title}
                {state.item.year ? ` (${state.item.year})` : ""}
              </span>
            </button>
            {state.note && <p className="rec__note">{state.note}</p>}
            <button
              type="button"
              className="rec__again"
              onClick={() => void find()}
            >
              Something else
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

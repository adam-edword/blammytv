import type { Ref } from "react";
import type { VodItem } from "../../stream/model";

/** Classic's REC page: the Windows wizard. Presentation only: the words,
 * the roll and the result all stay in Recommender, which hands them in. */

export type ClassicRecState =
  | { at: "idle" }
  | { at: "finding" }
  | { at: "result"; item: VodItem; note: string }
  | { at: "empty"; note: string }
  | { at: "error"; message: string };

export function ClassicRecommender({
  words,
  draft,
  setDraft,
  inputRef,
  state,
  ready,
  posters,
  onAdd,
  onBackspace,
  onDrop,
  onFind,
  onOpen,
  onClose,
}: {
  words: string[];
  draft: string;
  setDraft: (v: string) => void;
  inputRef: Ref<HTMLInputElement>;
  state: ClassicRecState;
  ready: boolean;
  /** The page's own catalog art: three of these fill the side panel. */
  posters: string[];
  onAdd: () => void;
  onBackspace: () => void;
  onDrop: (w: string) => void;
  onFind: () => void;
  onOpen: (item: VodItem) => void;
  onClose?: () => void;
}) {
  const side = posters.filter(Boolean).slice(0, 3);
  const finding = state.at === "finding";
  const item = state.at === "result" ? state.item : null;
  const sub = item
    ? [
        item.year,
        item.runtimeMin ? `${item.runtimeMin} min` : "",
        item.rating ? `★ ${item.rating.toFixed(1)}/10` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  return (
    <div className="rec cl-rec-page">
      <div className="cl-rec-wiz" role="dialog" aria-label="Find Something to Watch">
        <div className="cl-rec-title">
          <span>Find Something to Watch</span>
          <button type="button" className="cl-rec-x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="cl-rec-main">
          <div className="cl-rec-side" aria-hidden>
            {side.map((src, i) => (
              <img key={i} src={src} alt="" draggable={false} />
            ))}
          </div>
          <div className="cl-rec-pane">
            <h3>What are you in the mood for?</h3>
            <p>Type a few words, press Enter after each, then click Find. BlammyTV picks one for you.</p>
            <div className="cl-rec-row">
              <input
                ref={inputRef}
                className="cl-rec-field"
                type="text"
                aria-label="Add a keyword"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onAdd();
                  }
                  if (e.key === "Backspace" && !draft) onBackspace();
                  if (e.key === "Escape") e.stopPropagation();
                }}
              />
              <button type="button" className="cl-rec-btn" disabled={!draft.trim()} onClick={onAdd}>
                Add
              </button>
            </div>
            {words.length > 0 && (
              <div className="cl-rec-tags">
                {words.map((w) => (
                  <button
                    key={w}
                    type="button"
                    className="cl-rec-tag"
                    aria-label={`Remove ${w}`}
                    onClick={() => onDrop(w)}
                  >
                    {w} ✕
                  </button>
                ))}
              </div>
            )}
            {!ready && (
              <p className="cl-rec-note">
                Add a TMDB key in the console with <code>btvTmdb("your-key")</code> to switch this on.
              </p>
            )}
            {finding && (
              <p className="cl-rec-note" role="status">
                Looking…
              </p>
            )}
            {state.at === "empty" && (
              <p className="cl-rec-note" role="status">
                Nothing came back{state.note ? ` (${state.note})` : ""}. Try fewer words.
              </p>
            )}
            {state.at === "error" && (
              <p className="cl-rec-note cl-rec-note--bad" role="alert">
                {state.message}
              </p>
            )}
            {state.at === "result" && (
              <div className="cl-rec-pick">
                {state.item.poster && <img src={state.item.poster} alt="" draggable={false} />}
                <div>
                  <span className="cl-rec-label">Your pick</span>
                  <b>{state.item.title}</b>
                  {sub && <span>{sub}</span>}
                  {state.item.synopsis && <span>{state.item.synopsis}</span>}
                  {state.note && <span className="cl-rec-label">{state.note}</span>}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="cl-rec-foot">
          <button type="button" className="cl-rec-btn" disabled={words.length === 0 || finding} onClick={onFind}>
            {item ? "Find Again" : "Find"}
          </button>
          <button
            type="button"
            className="cl-rec-btn cl-rec-btn--def"
            disabled={!item}
            onClick={() => item && onOpen(item)}
          >
            Watch Now
          </button>
          <button type="button" className="cl-rec-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <p className="cl-rec-credit">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
    </div>
  );
}

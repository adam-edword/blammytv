/** Classic's "By Genre": an etched group box with a row of raised buttons,
 * each with a small colour block. Same picking as the normal rail: the
 * caller's setGenre, a second press clears. */

/** A genre keeps its block across visits: it is picked by the name's
 * characters, not by position. */
const BLOCKS = [
  "#c0392b", "#d6457f", "#e8a02a", "#3b4a5e", "#8a5a2b", "#5a4fd6",
  "#2e9e48", "#a548c2", "#2a8ad6", "#008080", "#808000", "#800000",
];

const blockFor = (name: string): string => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BLOCKS[h % BLOCKS.length];
};

export function ClassicGenres({
  genres,
  genre,
  onPick,
}: {
  genres: string[];
  genre: string | null;
  onPick: (g: string | null) => void;
}) {
  return (
    <fieldset className="cl-disc-gb discover__genres">
      <legend>By Genre</legend>
      <div className="cl-disc-genres">
        {genres.map((g) => {
          const on = genre === g;
          return (
            <button
              key={g}
              type="button"
              className={"cl-disc-gbtn" + (on ? " cl-disc-gbtn--on" : "")}
              aria-pressed={on}
              onClick={() => onPick(on ? null : g)}
            >
              <i style={{ background: blockFor(g) }} aria-hidden />
              {g}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

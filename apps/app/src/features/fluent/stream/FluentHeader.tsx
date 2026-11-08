import type { ReactNode } from "react";
import { BackArrowIcon } from "../../../ui/icons";
import { requestDiscoverGenre } from "../../stream/openRequest";
import type { VodItem } from "../../stream/model";

/**
 * The header a film's page and a series' page share in Fluent (plan 035,
 * "Fluent to tier 3"): the backdrop fading into the page, the poster, the
 * title, the meta line, the genre pills, the synopsis and the actions the
 * page puts under them. The genre pills do what they always did: they open
 * Discover on that genre.
 */
export function FluentHeader({
  item,
  meta,
  episodeLabel,
  onBack,
  actions,
}: {
  item: VodItem;
  /** The meta line, already joined: the two pages say different things. */
  meta: string;
  /** An episode's own label, under the title, on its sources page. */
  episodeLabel?: string;
  onBack: () => void;
  actions: ReactNode;
}) {
  return (
    <header className="fls-head">
      {item.backdrop && <img className="fls-head__bg" src={item.backdrop} alt="" />}
      <div className="fls-head__fade" aria-hidden />
      <button type="button" className="fls-back" aria-label="Back" onClick={onBack}>
        <BackArrowIcon size={16} />
      </button>
      <div className="fls-head__row">
        {item.poster && <img className="fls-head__poster" src={item.poster} alt="" draggable={false} />}
        <div className="fls-head__info">
          <h1 className="fls-head__title">{item.title}</h1>
          {episodeLabel && <p className="fls-head__episode">{episodeLabel}</p>}
          {meta && <p className="fls-head__meta">{meta}</p>}
          {item.genres.length > 0 && (
            <div className="fls-genres">
              {item.genres.slice(0, 5).map((g) => (
                <button
                  key={g}
                  type="button"
                  className="fls-chip"
                  data-hint={`Browse ${g} in Discover`}
                  onClick={() => requestDiscoverGenre(g)}
                >
                  {g}
                </button>
              ))}
            </div>
          )}
          {item.synopsis && <p className="fls-head__synopsis">{item.synopsis}</p>}
          <div className="fls-actions">{actions}</div>
        </div>
      </div>
    </header>
  );
}

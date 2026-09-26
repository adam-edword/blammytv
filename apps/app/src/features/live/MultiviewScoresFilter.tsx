import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { Toggle } from "../../ui/Toggle";
import { setSport, type filterSports } from "./mvScores";

/**
 * Which sports the Live Scores row carries (Adam, v0.10.6: "a filter modal
 * to pick what sports are shown"). A sport's switch covers all its leagues,
 * and each league has its own under it: "football" is the NFL and college,
 * which are often wanted apart. Every change applies at once; there is no
 * Save.
 */
export function MvScoresFilter({
  open,
  onOpenChange,
  sports,
  hidden,
  onHidden,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sports: ReturnType<typeof filterSports>;
  hidden: string[];
  onHidden: (hidden: string[]) => void;
}) {
  const shown = (path: string) => !hidden.includes(path);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mvfilter gap-0 p-0 sm:max-w-[420px]">
        <div className="mvfilter__head">
          <DialogTitle className="text-[17px] font-semibold">Scores row</DialogTitle>
          <DialogDescription className="text-[13px] text-(--text-muted)">
            The sports it shows. Changes apply as you make them.
          </DialogDescription>
        </div>
        <div className="mvfilter__list">
          {sports.length === 0 && <p className="mvfilter__empty">No sports to choose from yet.</p>}
          {sports.map(({ sport, leagues }) => {
            const one = leagues.length === 1;
            const any = leagues.some((l) => shown(l.path));
            return (
              <section key={sport.key} className="mvfilter__sport">
                <div className="mvfilter__row mvfilter__row--sport">
                  <span>
                    {sport.name}
                    {one && <span className="mvfilter__only"> · {leagues[0].label}</span>}
                  </span>
                  <Toggle on={any} label={sport.name} onChange={(v) => onHidden(setSport(hidden, leagues, v))} />
                </div>
                {!one &&
                  leagues.map((l) => (
                    <div key={l.path} className="mvfilter__row">
                      <span>{l.label}</span>
                      <Toggle
                        small
                        on={shown(l.path)}
                        label={l.label}
                        onChange={(v) => onHidden(v ? hidden.filter((h) => h !== l.path) : [...hidden, l.path])}
                      />
                    </div>
                  ))}
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

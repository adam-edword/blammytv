import { Fragment, useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { EYEBROW } from "../../ui/eyebrow";
import { Kbd } from "../../ui/Kbd";
import { SHORTCUT_GROUPS, type Shortcut } from "./shortcuts";

/**
 * Settings → App → Keyboard Shortcuts (plan 025, P4a, D8): a list of what the
 * keys do, opened inline under the row by Show and shut by Hide. Not a second
 * dialog over Settings, which already is one.
 *
 * The list is shortcuts.ts, written from the handlers. Keys are the app's own
 * Kbd chip, the one multi-view's picker and the source list wear. Several ways
 * of doing the same thing are drawn with "or" between, and keys held together
 * with "+".
 */
export function ShortcutsSection() {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    // Stacked: the row, and the list under it when it is open. One
    // data-setting for both, so a find lands on the row and the list is part
    // of it.
    <div className="customize-stack" data-setting="shortcuts">
      <div className="customize-row">
        <div>
          <h4 className="customize-row__title">Keyboard Shortcuts</h4>
          <p className="settings__section-note settings__section-note--dim">
            Every key the app answers to, by where it works.
          </p>
        </div>
        <Button
          variant="secondary"
          type="button"
          className="settings-button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Hide" : "Show"}
        </Button>
      </div>
      {open && (
        <div className="shortcuts" id={listId}>
          {SHORTCUT_GROUPS.map((g) => (
            <section className="shortcuts__group" key={g.title}>
              <h5 className={`shortcuts__title ${EYEBROW}`}>{g.title}</h5>
              {g.note && <p className="shortcuts__note">{g.note}</p>}
              <dl className="shortcuts__list">
                {g.shortcuts.map((s) => (
                  <div className="shortcuts__row" key={s.keys.map((c) => c.join("+")).join("|")}>
                    <dt className="shortcuts__keys">
                      <Keys keys={s.keys} />
                    </dt>
                    <dd className="shortcuts__what">{s.what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** The ways to press it: chords drawn as chips joined by "+", ways joined by "or". */
function Keys({ keys }: { keys: Shortcut["keys"] }) {
  return (
    <>
      {keys.map((chord, i) => (
        <Fragment key={chord.join("+")}>
          {i > 0 && <span className="shortcuts__or">or</span>}
          {chord.map((k, j) => (
            <Fragment key={k}>
              {j > 0 && <span className="shortcuts__plus">+</span>}
              <Kbd>{k}</Kbd>
            </Fragment>
          ))}
        </Fragment>
      ))}
    </>
  );
}

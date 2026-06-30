import {
  FocusContext,
  useFocusable,
} from "@noriginmedia/norigin-spatial-navigation";
import { FocusButton } from "./FocusButton";

/** A D-pad-navigable on-screen keyboard for remote text entry (no system IME).
 * Emits characters (incl. space) via `onChar`; backspace/clear are their own
 * callbacks. The whole grid is one focus context so ◀▶▲▼ move between keys and
 * Right out of the rightmost column hands off to the results (the parent owns
 * that boundary via norigin geometry). */

type Key =
  | { ch: string; label?: string }
  | { action: "backspace" | "clear"; label: string; wide?: boolean };

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const DIGITS = "0123456789".split("");

// 6-wide alphabetical grid then digits — 26 letters + 10 digits = 36 = six even
// rows of six, no stretched leftovers — and a control row. Alphabetical (not
// QWERTY) is the easier target with a D-pad: predictable rows.
const ROWS: Key[][] = [
  ...chunk([...LETTERS, ...DIGITS], 6).map((r) => r.map((ch): Key => ({ ch }))),
  [
    { ch: " ", label: "Space" },
    { action: "backspace", label: "⌫" },
    { action: "clear", label: "Clear" },
  ],
];

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export function OnScreenKeyboard({
  focusKey,
  onChar,
  onBackspace,
  onClear,
}: {
  focusKey?: string;
  onChar: (ch: string) => void;
  onBackspace: () => void;
  onClear: () => void;
}) {
  const { ref, focusKey: fk } = useFocusable<HTMLDivElement>({
    focusKey,
    saveLastFocusedChild: true,
    trackChildren: true,
  });

  return (
    <FocusContext.Provider value={fk}>
      <div ref={ref} className="osk" role="group" aria-label="On-screen keyboard">
        {ROWS.map((row, ri) => (
          <div className="osk__row" key={ri}>
            {row.map((key, ki) => {
              const isAction = "action" in key;
              const label = "label" in key && key.label ? key.label : ("ch" in key ? key.ch : "");
              return (
                <FocusButton
                  key={ki}
                  focusKey={`osk-${ri}-${ki}`}
                  autoFocus={ri === 0 && ki === 0}
                  ariaLabel={
                    isAction
                      ? key.action
                      : key.ch === " "
                        ? "Space"
                        : key.ch
                  }
                  className={
                    "osk__key" +
                    (isAction ? " osk__key--action" : "") +
                    ("wide" in key && key.wide ? " osk__key--wide" : "") +
                    (!isAction && key.ch === " " ? " osk__key--space" : "")
                  }
                  onPress={() => {
                    if (!isAction) onChar(key.ch);
                    else if (key.action === "backspace") onBackspace();
                    else onClear();
                  }}
                >
                  {label}
                </FocusButton>
              );
            })}
          </div>
        ))}
      </div>
    </FocusContext.Provider>
  );
}

import {
  FocusContext,
  useFocusable,
} from "@noriginmedia/norigin-spatial-navigation";
import { FocusButton } from "./FocusButton";

/** A D-pad-navigable on-screen QWERTY keyboard for remote text entry (no system
 * IME). Emits characters (incl. space) via `onChar`; backspace/clear are their
 * own callbacks. The whole grid is one focus context so ◀▶▲▼ move between keys;
 * Right out of the rightmost column hands off to the results via norigin
 * geometry (the parent lays the results out to the right). */

type Key =
  | { ch: string; label?: string }
  | { action: "backspace" | "clear"; label: string };

// QWERTY: a number row, three staggered letter rows, then a control row. Rows
// are centered (fixed-width keys) so the columns line up like a real keyboard,
// which makes ▲▼ between rows predictable.
const ROWS: Key[][] = [
  row("1234567890"),
  row("QWERTYUIOP"),
  row("ASDFGHJKL"),
  row("ZXCVBNM"),
  [
    { ch: " ", label: "Space" },
    { action: "backspace", label: "⌫" },
    { action: "clear", label: "Clear" },
  ],
];

function row(chars: string): Key[] {
  return chars.split("").map((ch) => ({ ch }));
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
        {ROWS.map((keys, ri) => {
          const isControls = ri === ROWS.length - 1;
          return (
            <div
              className={"osk__row" + (isControls ? " osk__row--controls" : "")}
              key={ri}
            >
              {keys.map((key, ki) => {
                const isAction = "action" in key;
                const ch = "ch" in key ? key.ch : "";
                const label = key.label ?? ch;
                return (
                  <FocusButton
                    key={ki}
                    focusKey={`osk-${ri}-${ki}`}
                    autoFocus={ch === "Q"}
                    ariaLabel={
                      isAction ? key.action : ch === " " ? "Space" : ch
                    }
                    className={
                      "osk__key" +
                      (isAction ? " osk__key--action" : "") +
                      (!isAction && ch === " " ? " osk__key--space" : "")
                    }
                    onPress={() => {
                      if (!isAction) onChar(ch);
                      else if (key.action === "backspace") onBackspace();
                      else onClear();
                    }}
                  >
                    {label}
                  </FocusButton>
                );
              })}
            </div>
          );
        })}
      </div>
    </FocusContext.Provider>
  );
}

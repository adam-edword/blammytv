import { useEffect } from "react";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { isTv } from "../lib/tv";

/** The on/off toggle switch, wired into spatial navigation: arrow keys move to
 * it and Enter (D-pad center) flips it. Mirrors the markup of the plain
 * `.toggle` used elsewhere so it looks identical. */
export function FocusToggle({
  checked,
  onChange,
  ariaLabel,
  focusKey,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
  focusKey?: string;
}) {
  const { ref, focused } = useFocusable<HTMLButtonElement>({
    focusKey,
    onEnterPress: () => onChange(!checked),
  });
  useEffect(() => {
    if (!focused) return;
    ref.current?.scrollIntoView({ block: "nearest" });
    if (!isTv) ref.current?.focus({ preventScroll: true });
  }, [focused, ref]);
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={"toggle toggle--btn" + (focused ? " is-focused" : "")}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__track">
        <span className="toggle__thumb" />
      </span>
    </button>
  );
}

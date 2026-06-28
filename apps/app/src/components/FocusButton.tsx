import { useEffect, type ReactNode } from "react";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation";

/** A button wired into spatial navigation: arrow keys move focus to it, Enter
 * (D-pad center) activates it, and it gets the `is-focused` highlight. Falls
 * back to a normal click for mouse/touch. */
export function FocusButton({
  className = "",
  onPress,
  children,
  ariaLabel,
  focusKey,
  autoFocus = false,
  disabled = false,
}: {
  className?: string;
  onPress?: () => void;
  children: ReactNode;
  ariaLabel?: string;
  focusKey?: string;
  /** Grab focus on mount (e.g. the active tab on first paint). */
  autoFocus?: boolean;
  /** Dim + skip in spatial navigation (e.g. season prev/next at the ends). */
  disabled?: boolean;
}) {
  const { ref, focused, focusSelf } = useFocusable<HTMLButtonElement>({
    focusKey,
    focusable: !disabled,
    onEnterPress: () => {
      if (!disabled) onPress?.();
    },
  });
  useEffect(() => {
    if (autoFocus && !disabled) focusSelf();
  }, [autoFocus, disabled, focusSelf]);
  useEffect(() => {
    if (focused) ref.current?.focus({ preventScroll: true });
  }, [focused, ref]);
  return (
    <button
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      className={className + (focused ? " is-focused" : "")}
      onClick={() => onPress?.()}
    >
      {children}
    </button>
  );
}

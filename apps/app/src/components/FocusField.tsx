import { useEffect } from "react";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { isTv } from "../lib/tv";

/** A labelled text field wired into spatial navigation. Arrow keys move to it
 * and Enter (D-pad center) focuses the native input — which on Android TV opens
 * the system IME (a modal overlay that captures typing), so remote text entry
 * works without the arrow keys fighting spatial nav. With a hardware keyboard
 * it's just a normal focused input. */
export function FocusField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  focusKey,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "url" | "password";
  focusKey?: string;
  inputMode?: "url" | "text";
}) {
  const { ref, focused } = useFocusable<HTMLInputElement>({
    focusKey,
    // Center/Enter drops into the native field (opens the IME on TV).
    onEnterPress: () => ref.current?.focus(),
  });
  useEffect(() => {
    if (focused && !isTv) ref.current?.focus({ preventScroll: true });
  }, [focused, ref]);
  return (
    <label className={"field" + (focused ? " field--focused" : "")}>
      <span className="field__label">{label}</span>
      <input
        ref={ref}
        className="field__input"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
    </label>
  );
}

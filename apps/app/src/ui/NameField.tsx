import { useEffect, useRef } from "react";

/**
 * A single-line name field that behaves the way people expect one to:
 * focused and selected on appear, Enter commits, Escape cancels, and
 * clicking away commits rather than silently discarding what was typed.
 *
 * Replaces window.prompt, which is the one surface in the app that cannot
 * be styled and which breaks the frame at precisely the moment the user is
 * making something. Shared, because naming a list happens in three places
 * now (create in the grid, rename in the bar, create from the save picker)
 * and three copies would drift.
 */
export function NameField({
  initial,
  placeholder,
  onCommit,
  onCancel,
  className,
  ariaLabel,
}: {
  initial: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  className?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      type="text"
      className={className}
      aria-label={ariaLabel}
      defaultValue={initial}
      placeholder={placeholder}
      maxLength={60}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(e.currentTarget.value);
        // Escape must not also close the modal/menu/tab behind this field.
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
      onBlur={(e) => onCommit(e.currentTarget.value)}
    />
  );
}

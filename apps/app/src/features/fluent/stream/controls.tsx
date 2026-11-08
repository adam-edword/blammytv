import type { ReactNode } from "react";
import { ChevronIcon } from "../../../ui/icons";

/**
 * The few WinUI controls Fluent's Stream screens share (plan 035, "Fluent to
 * tier 3"). Paint is styles/fluent-stream.css. They hold no state of their
 * own: every value and callback comes from the screen that draws them.
 */

/** A WinUI ComboBox: "Label: Value" and a chevron. A native select
 * underneath, so the keys, the typeahead and the screen reader's name come
 * with it; the drawn parts are the label and the chevron over it. */
export function FlCombo({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={"fls-combo" + (className ? ` ${className}` : "")}>
      <span className="fls-combo__label" aria-hidden>
        {label}:
      </span>
      <select
        className="fls-combo__select"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronIcon size={12} className="fls-combo__chev" />
    </label>
  );
}

/** A page's title, in Fluent's title type. */
export function FlPageTitle({ children }: { children: ReactNode }) {
  return <h1 className="fls-page-title">{children}</h1>;
}

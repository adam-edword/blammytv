import * as React from "react";
import {
  Combobox as ComboboxRoot,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "../components/ui/combobox";

/**
 * shadcn's Combobox in the `#basic` composition, wrapped once so a call site
 * can hand it a list and a value.
 *
 * WHAT CHANGED IN v0.9.68, AND WHY IT IS A DIFFERENT COMPONENT. The first
 * pass built the Radix-era Combobox: a Popover, a Command list and a Button
 * trigger showing the current label. Adam, looking at it: "the combobox does
 * not look or act like shadcns. components/base/combobox#basic should be for
 * combo, exact same styling." He is right, and it is not a styling gap —
 * shadcn now ships a REAL `combobox` component, built on Base UI, and its
 * basic shape is a text input with a chevron in an InputGroup. You type into
 * the control itself; there is no separate search box inside the popup and
 * no button standing in for the field. The Popover + Command version is a
 * pattern the docs kept while Radix had no combobox primitive.
 *
 * So the trigger IS the input. `ComboboxInput` renders the InputGroup, the
 * `<input role="combobox">` and the chevron addon; `ComboboxContent` renders
 * the positioned popup; `ComboboxList` renders the items. All the styling is
 * the registry's, and this file adds none.
 *
 * ITEMS ARE OBJECTS, so the root takes `itemToStringValue`. Base UI filters
 * on the string it gets back, which is how "es" finds Spanish as well as
 * "Spanish" does — the same search behaviour the native <select>'s
 * type-ahead used to give, only over the whole label rather than its first
 * letter.
 */

export interface ComboboxOption {
  value: string;
  label: string;
  /** Extra words the filter should match, e.g. a language code. */
  keywords?: string[];
}

const searchText = (o: ComboboxOption) =>
  [o.label, ...(o.keywords ?? [])].join(" ");

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  emptyText = "Nothing found.",
  className,
  ariaLabel,
}: {
  options: readonly ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const items = React.useMemo(() => [...options], [options]);
  const selected = options.find((o) => o.value === value) ?? null;

  return (
    <ComboboxRoot
      items={items}
      value={selected}
      // `?? value` keeps a cleared field from reading as a change: Base UI
      // hands back null while you are typing, and treating that as "the
      // user picked nothing" would wipe a stored language the moment
      // someone clicked into the box.
      onValueChange={(next: ComboboxOption | null) =>
        onChange(next ? next.value : value)
      }
      itemToStringValue={searchText}
      itemToStringLabel={(o: ComboboxOption) => o.label}
    >
      <ComboboxInput
        aria-label={ariaLabel}
        placeholder={placeholder}
        className={className}
        // Select the text on focus. The registry does not do this and the
        // docs demo does not need to: its example starts empty, so nobody
        // ever clicks INTO a filled field there. Ours is a picker that
        // always shows the current language, and a click was landing a
        // caret in the middle of "No preference" — typing "span" made the
        // query "No preferspanence", which matches nothing, so the list
        // just went empty and the control read as broken. Selecting means
        // the first keystroke replaces the label, which is what typing into
        // a picker is for. Behaviour only; no styling changes.
        onFocus={(e) => e.currentTarget.select()}
      />
      <ComboboxContent>
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        <ComboboxList>
          {(item: ComboboxOption) => (
            <ComboboxItem key={item.value} value={item}>
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </ComboboxRoot>
  );
}

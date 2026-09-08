import * as React from "react";
import { cn } from "cn";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "../components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover";

/**
 * shadcn's Combobox, as one component instead of a copy-pasted block.
 *
 * The Combobox is a PATTERN in shadcn, not a registry component: Popover +
 * Command + a Button trigger, assembled at the call site. Every call site
 * would then repeat the same forty lines, so this wraps the pattern once
 * and takes a list. The markup below is `combobox-demo` from the registry,
 * unchanged apart from being handed its options.
 *
 * WHY IT REPLACED THE NATIVE <select>. settings.css used to argue for the
 * platform control: 28 languages is past what a chip group carries, and the
 * native picker already has type-ahead. That was right about the problem
 * and wrong about the fix. The native picker paints from the OS, so it is
 * the one surface in the app that cannot be made to look like the rest of
 * it, and Adam asked for the searchable one: "maybe we just change it to be
 * the 'combobox' component so people could search their language."
 *
 * cmdk gives the search for free, and Command's own keyboard handling is
 * the type-ahead the native control was being kept for.
 */

export interface ComboboxOption {
  value: string;
  label: string;
  /** Extra words the search should match, e.g. a language code. */
  keywords?: string[];
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "Nothing found.",
  className,
  contentClassName,
  ariaLabel,
}: {
  options: readonly ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  contentClassName?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const current = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={cn("justify-between font-normal", className)}
        >
          <span className="truncate">{current ? current.label : placeholder}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      {/* z-[70], not PopoverContent's own z-50. The Settings sheet is z 60,
        * and a popover opened from inside it at z 50 paints BEHIND the panel
        * — which is the trap settings.css already documents for the source
        * menu, and which looks exactly like the control being dead. 70 is
        * the app's "floating above a modal" tier; nothing sits above it. */}
      <PopoverContent
        className={cn("z-[70] p-0", contentClassName)}
        align="end"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="h-9" />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  // What cmdk SEARCHES, which is not what we select by. The
                  // demo passes the option's value and reads it back out of
                  // `onSelect`, and that only works there because every
                  // framework in it is already lowercase — cmdk lowercases
                  // what it stores, so a code like `pt-BR` would come back
                  // wrong. Closing over the option instead means the value
                  // never makes the round trip, which frees this prop up to
                  // be the search text: the label plus the code, so both
                  // "Spanish" and "es" find Spanish.
                  value={[o.label, ...(o.keywords ?? [])].join(" ")}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  {o.label}
                  <Check
                    className={cn(
                      "ml-auto",
                      value === o.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

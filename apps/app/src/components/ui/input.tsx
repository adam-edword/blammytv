import * as React from "react"
import { cn } from "cn"

/**
 * forwardRef, for the same React-18 reason button.tsx spells out: the
 * registry writes these as plain functions that take `ref` in props, which
 * works on React 19 only, and Base UI's `render={<X />}` composition hands
 * every one of them a ref. Without it Base UI cannot read or focus the
 * control, and the visible symptom is not an error — the combobox simply
 * would not accept typing, so its filter listed all 29 languages no matter
 * what you typed. `scripts/verify-tailwind.mjs` (9e) guards it.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  function Input({ className, type, ...props }, ref) {
  return (
    <input
      ref={ref}
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
})

export { Input }

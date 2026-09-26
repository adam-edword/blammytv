import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

/**
 * MULTI-VIEW'S SHAPES, on shadcn's Button (plan 019, K3). Changed here, in
 * the variants, rather than at 27 call sites, so every button in the app
 * moved together and a new one is born right.
 *
 * - Round ends and 40px, the capsule's and multi-view's bar's.
 * - `default` is THE bright thing: the text colour as a fill, the page as
 *   ink, one per screen (multi-view's Add). It is --text, not the accent:
 *   the accent is a signal (live, the sound), not a highlight. Quiet at its
 *   limit (`aria-disabled`), not gone, so its tooltip can still say why.
 * - `secondary` and `outline` are the capsule's glass. A toggle wears the
 *   16% tint when pressed and says it with its ink when it isn't, like an
 *   option of the segmented control.
 * - `chip` is for a button drawn ON a picture: darker glass with a hairline,
 *   because what is behind it is video, not the page.
 *
 * `transition-all` stays, on the app's duration and curve (`ease-out` is the
 * app's, theme.css): entrances ride it (the skip chip's @starting-style, a
 * reveal's fade), and an app rule cannot set `transition` on a Button.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full text-[13px] font-semibold whitespace-nowrap transition-all duration-(--dur-hover) ease-out outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-foreground text-background font-[650] hover:bg-foreground/90 aria-disabled:cursor-not-allowed aria-disabled:bg-glass aria-disabled:text-muted-foreground aria-disabled:hover:bg-glass",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          "bg-glass text-foreground [backdrop-filter:var(--glass-fx)] hover:bg-tint-on aria-pressed:bg-tint-on aria-[pressed=false]:text-muted-foreground aria-[pressed=false]:hover:text-foreground",
        secondary:
          "bg-glass text-foreground [backdrop-filter:var(--glass-fx)] hover:bg-tint-on aria-pressed:bg-tint-on aria-[pressed=false]:text-muted-foreground aria-[pressed=false]:hover:text-foreground",
        ghost: "hover:bg-tint-hover",
        chip:
          "border border-chip-edge bg-chip text-on-image text-xs [backdrop-filter:var(--chip-fx)] hover:bg-chip-hover",
        link: "rounded-none text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 has-[>svg]:pl-[13px]",
        xs: "h-6 gap-1 px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-[12.5px] has-[>svg]:px-2.5",
        lg: "h-11 px-6 text-sm has-[>svg]:px-4",
        chip: "h-[30px] min-w-[30px] gap-1.5 px-[11px]",
        icon: "size-10",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-11",
        "icon-chip": "size-[30px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }

/**
 * forwardRef, and it has to be. The registry ships this as a plain function
 * that takes `ref` in its props, which works on React 19 only. This app is
 * on React 18, where React strips `ref` off a function component's props and
 * logs "Function components cannot be given refs" — so `ref={x}` on a Button
 * left `x.current` null and the code reading it silently did nothing.
 *
 * It cost two real regressions from v0.9.54's conversion, both invisible
 * until someone clicked: Settings' "add sources" measured a null rect, never
 * set its menu position and so never opened the menu at all, and the
 * tournament draw stopped focusing its back button on open.
 *
 * shadcn's own pre-19 registry wrote it exactly this way. When this repo
 * moves to React 19 the wrapper becomes redundant, not wrong.
 * `scripts/verify-tailwind.mjs` guards it: any ref handed to a primitive in
 * `components/ui/` must land on a component that forwards it.
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = "default", size = "default", asChild = false, ...props },
    ref,
  ) {
    const Comp = asChild ? Slot.Root : "button"

    return (
      <Comp
        ref={ref}
        data-slot="button"
        data-variant={variant}
        data-size={size}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    )
  },
)

export { Button, buttonVariants }

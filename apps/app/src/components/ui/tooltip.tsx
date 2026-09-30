"use client"

import * as React from "react"
import { cn } from "cn"
import { Tooltip as TooltipPrimitive } from "radix-ui"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          // EDITED FROM THE GENERATED DEFAULT, which was `bg-foreground
          // text-background`: an inverted near-white chip. That is shadcn's
          // look and it is not this app's. Everything that floats over
          // content here is the thin glass tier in tokens.css (--float-*,
          // plan 022), so the tooltip is too, down to the bright top edge
          // that makes it read as material rather than as a rectangle.
          //
          // `add tooltip` WILL OVERWRITE THIS. See components/README.md.
          "sports-tooltip z-(--z-popover) w-fit origin-(--radix-tooltip-content-transform-origin)",
          "rounded-[10px] border border-float-border bg-popover px-2.5 py-1.5",
          "text-xs font-medium text-foreground text-balance",
          "shadow-(--float-shadow) [backdrop-filter:var(--float-blur)]",
          "animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
          // NO EXIT ANIMATION, also edited from the default (which fades and
          // zooms out). Radix keeps a closing tooltip mounted until its exit
          // animation ends, and a mounted TooltipContent is a
          // DismissableLayer: the newest, so the only one listening for
          // Escape. For those 150ms an Escape went to a bubble already shut,
          // and Settings, or any dialog under it, stayed up: 10 Escapes of
          // 10 straight after a Tab walk (v0.10.43,
          // scripts/measure-tooltip-escape.mjs). With no animation when
          // closed, Radix unmounts it in the same commit. Dropping only the
          // exit classes isn't enough: a tooltip shut before its entrance
          // began would have Radix wait out the entrance instead.
          "data-[state=closed]:animate-none",
          className
        )}
        {...props}
      >
        {children}
        {/* No arrow. The generated one is a rotated square filled with the
          * bubble's colour, which cannot work against a translucent surface:
          * the square and the bubble each blur the backdrop separately and
          * the overlap goes visibly darker. A 4px offset reads as attached
          * without one. */}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }

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
          // content here is the dark glass recipe in tokens.css, so the
          // tooltip is too, down to the bright top edge that makes it read
          // as material rather than as a rectangle.
          //
          // `add tooltip` WILL OVERWRITE THIS. See components/README.md.
          "sports-tooltip z-50 w-fit origin-(--radix-tooltip-content-transform-origin)",
          "rounded-[10px] border border-float-border bg-popover px-2.5 py-1.5",
          "text-xs font-medium text-foreground text-balance",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_8px_28px_rgba(0,0,0,0.45)]",
          "backdrop-blur-[18px] backdrop-saturate-[1.2]",
          "animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
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

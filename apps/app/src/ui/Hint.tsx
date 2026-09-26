import type { ReactElement, ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip";

/**
 * A label that appears on hover, for a control that shows no words.
 *
 * WHY A WRAPPER rather than the three shadcn parts at every call site. There
 * are 92 aria-labelled controls in this app and the shape is identical at
 * every one of them: a trigger, a string, a side. Three imports and five
 * lines each would be 460 lines of boilerplate whose only variable is the
 * string, and the first time the side offset or the delay wanted changing it
 * would want changing in 92 places.
 *
 * WHAT IT REPLACES, and why that is worth doing: the browser's own `title`
 * attribute. A native tooltip waits about a second, draws in the OS's
 * styling rather than the app's, appears at the pointer instead of anchored
 * to the control, and cannot be themed, positioned or animated. It is the
 * one piece of UI in this app that nobody designed.
 *
 * `asChild` IS THE POINT. Radix renders no wrapper element of its own; it
 * clones the child and adds its handlers, so the trigger stays exactly the
 * button it already was. Nothing in the layout moves and no harness
 * selector changes, which is what makes this safe to apply widely.
 *
 * THE CHILD MUST STILL CARRY ITS OWN `aria-label`. This is decoration, not
 * an accessible name: Radix wires the tooltip up as a description, and a
 * screen reader that never fires a hover would otherwise reach an unnamed
 * button. Every call site here is a control that already had one.
 *
 * FOCUS FROM A SCRIPT DOESN'T OPEN IT. Radix opens on any focus that isn't
 * a press, so a screen that moves focus as it opens (the tennis draw puts
 * it on its Back button) popped the label under a mouse user's pointer.
 * Only a focus the browser would ring, `:focus-visible`, opens it now: Tab
 * does, a script's focus after a click doesn't.
 *
 * `off` KEEPS THE WRAPPER and just stays shut, for a control whose words are
 * sometimes showing (Segmented's chosen option). Adding and dropping the
 * wrapper instead changes the element React sees, so it remounts the button
 * and focus falls to the page.
 */
export function Hint({
  label,
  side = "bottom",
  off = false,
  children,
}: {
  /** The words. Kept short: this is a name, not a sentence. */
  label: ReactNode;
  /**
   * Which way it opens. Defaults to BELOW, because most of these controls
   * live in the header and a tooltip above one would be off-screen.
   */
  side?: "top" | "right" | "bottom" | "left";
  /** Stay shut (the words are showing), without dropping the wrapper. */
  off?: boolean;
  /** The control itself. Cloned, not wrapped. */
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        asChild
        // Radix skips its own open when this marks the event.
        onFocus={(e) => {
          if (!e.currentTarget.matches(":focus-visible")) e.preventDefault();
        }}
      >
        {children}
      </TooltipTrigger>
      {/* 6px, which is the gap the app's other floating surfaces sit at, and
        * enough that the bubble reads as attached without an arrow.
        *
        * `off` draws no bubble and leaves Radix's own open state alone.
        * Holding a controlled `open` at false instead lost the closes Radix
        * made meanwhile (it only reports a change from the value it was
        * given), so the option you had just left popped its label. */}
      {!off && (
        <TooltipContent side={side} sideOffset={6}>
          {label}
        </TooltipContent>
      )}
    </Tooltip>
  );
}

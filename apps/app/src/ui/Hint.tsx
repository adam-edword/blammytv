import { useEffect, useState, type ReactElement, type ReactNode } from "react";
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

/** How long a list's pointer rests before its hint shows. Longer than a
 * control's 400ms: these repeat what the card or cell already says, and a
 * pointer crossing a grid should not trail bubbles. */
const LIST_DELAY_MS = 650;

/**
 * THE ONE TOOLTIP FOR EVERY LIST (v0.10.23). A `data-hint="words"` on any
 * element shows the same bubble `Hint` does, from a single tooltip mounted
 * once at the root, moved to whichever element the pointer rests on.
 *
 * WHY NOT `Hint` ON EACH: it costs. Measured in the dev build, 400 buttons
 * rendered in 5.6ms plain and 154ms each wrapped in a Radix tooltip. The
 * Guide mounts a row of programme cells at a time as it scrolls, the Stream
 * rows and the sports board hundreds of cards; each would pay it. Here they
 * pay one attribute. Controls that stand alone keep `Hint`.
 *
 * The anchor is an empty fixed box laid over the element's rect; the
 * tooltip is keyed per show so it measures afresh rather than trusting a
 * position from the last element. It hides on a press, a key, a scroll or
 * the pointer leaving, never opens for touch, and only arms on the pointer
 * actually moving. Newlines in the words
 * break the line (a fixture's headline sits under its teams).
 *
 * Mouse only, deliberately: these are the full text of something already
 * named on screen (an aria-label or its own words), so a keyboard user
 * moving through the Guide loses nothing and gains no bubble per cell.
 */
export function HintLayer() {
  const [shown, setShown] = useState<{ n: number; words: string; rect: DOMRect } | null>(null);
  useEffect(() => {
    let timer = 0;
    let n = 0;
    let at: Element | null = null;
    const hide = () => {
      window.clearTimeout(timer);
      at = null;
      setShown(null);
    };
    // On a MOVE, not on pointerover. A card that slides in under a resting
    // pointer (a draw opened by a click, a row that scrolls) fires the
    // browser's boundary events with no movement at all, and popped its hint
    // at someone who had not touched the mouse. Radix's own tooltips open
    // on movement for the same reason.
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (e.movementX === 0 && e.movementY === 0) return;
      const el = (e.target as Element | null)?.closest?.("[data-hint]") ?? null;
      if (el === at) return;
      window.clearTimeout(timer);
      at = el;
      setShown(null);
      if (!el) return;
      timer = window.setTimeout(() => {
        const words = el.getAttribute("data-hint");
        if (at !== el || !el.isConnected || !words) return;
        setShown({ n: ++n, words, rect: el.getBoundingClientRect() });
      }, LIST_DELAY_MS);
    };
    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget) hide(); // left the window
    };
    document.addEventListener("pointermove", onOver, { passive: true });
    document.addEventListener("pointerout", onOut);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("wheel", hide, { capture: true, passive: true });
    window.addEventListener("blur", hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointermove", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("wheel", hide, { capture: true });
      window.removeEventListener("blur", hide);
    };
  }, []);
  if (!shown) return null;
  const r = shown.rect;
  return (
    <Tooltip key={shown.n} open onOpenChange={(open) => !open && setShown(null)}>
      <TooltipTrigger asChild>
        <span
          aria-hidden
          data-hint-anchor
          style={{
            position: "fixed",
            left: r.left,
            top: r.top,
            width: r.width,
            height: r.height,
            pointerEvents: "none",
          }}
        />
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="whitespace-pre-line">
        {shown.words}
      </TooltipContent>
    </Tooltip>
  );
}

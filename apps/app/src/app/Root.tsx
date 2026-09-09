import React from "react";
import { TooltipProvider } from "../components/ui/tooltip";

/**
 * Every render path, wrapped in the one thing all of them need.
 *
 * `Hint` (ui/Hint.tsx) is a Radix tooltip, and Radix REQUIRES a Provider
 * ancestor: without one it throws on mount rather than degrading. So this is
 * not a main-app concern. Both harness entries below mount real app
 * components — SportsTheater has a hinted fold button — and putting the
 * provider only on the shipping branch took verify-sports-theater from 19
 * checks to a crash before it rendered anything.
 *
 * ONE provider, shared: Radix uses it to hold the open/close timers, so
 * moving between two hinted controls swaps the label instead of restarting
 * the delay.
 *
 * 400ms is a deliberate middle. Zero (shadcn's default) fires on any pointer
 * that crosses a control and turns a toolbar into a flicker; the browser's
 * own ~1s title delay is the sluggishness this replaced. `skipDelayDuration`
 * is the grace period during which a neighbour opens instantly.
 */
export function Root({ children }: { children: React.ReactNode }) {
  return (
    <React.StrictMode>
      <TooltipProvider delayDuration={400} skipDelayDuration={300}>
        {children}
      </TooltipProvider>
    </React.StrictMode>
  );
}

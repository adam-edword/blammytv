import type { ReactNode } from "react";

/**
 * A key, drawn one way (plan 019, K12): multi-view's `<kbd>` chip, the one
 * its picker's footer and its Add tile use. A small tint of the ink it
 * sits in, so it reads on the page and on glass alike.
 */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={"kbd" + (className ? ` ${className}` : "")}>{children}</kbd>;
}

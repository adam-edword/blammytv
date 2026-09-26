/**
 * The eyebrow (plan 019, K9): multi-view's section label, for every label
 * that names a group rather than being one of its items. 11px, 650, 0.06em,
 * uppercase, muted, numbers tabular (`.mvpick__sec` and `.mvtile__chan`,
 * where it came from).
 *
 * UTILITIES, NOT A CLASS, for the reason `sidebarItem.ts` gives: the
 * Guide's group headers are `<Button variant="ghost">`, which paints size,
 * weight and colour with utilities, and `utilities` outranks `app`. A call
 * site utility is the one thing that reaches a Button and a plain element
 * alike, so it is the one definition.
 *
 * `EYEBROW_TYPE` is the type alone, for a label drawn over artwork, which
 * takes the on-image ink rather than --text-muted (dark in the light theme,
 * and the page pins a light foreground there).
 */
export const EYEBROW_TYPE =
  "text-[11px] font-[650] uppercase tracking-[0.06em] tabular-nums";

export const EYEBROW = `${EYEBROW_TYPE} text-muted-foreground`;

export const EYEBROW_ON_IMAGE = `${EYEBROW_TYPE} text-on-image/65`;

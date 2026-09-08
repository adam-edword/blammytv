/**
 * shadcn's sidebar geometry, as utility strings both sidebars share.
 *
 * Adam: "shadcn's sidebar is a part of the edge of the screen, and ours is a
 * floater. just try to match the inside of the sidebar." So this is the
 * INSIDE only — the panel keeps its own width, its float and its rounded
 * card edge. Nothing here touches the container.
 *
 * WHY NOT THE REAL <Sidebar>. shadcn's ships a provider, a rail, a mobile
 * Sheet, a keyboard shortcut and cookie-backed collapse state, all built
 * around being pinned to the viewport edge. The Guide and Sports panels are
 * floating cards with their own collapse already persisted. Taking the
 * component would mean taking the layout with it, which is the one thing
 * that was ruled out.
 *
 * WHY UTILITY STRINGS AND NOT CSS. Both sidebars render their rows as
 * `<Button variant="ghost">`, and Button paints height, padding, gap and
 * weight with utilities. `utilities` outranks `app`, so a rule in live.css
 * setting any of them would not apply — the same trap v0.9.54 found seven
 * of. A call-site utility is how shadcn overrides shadcn.
 *
 * The values are `sidebarMenuButtonVariants` and `SidebarGroupLabel` from
 * the registry, read rather than remembered:
 *
 *   menu button   h-8  p-2   gap-2  rounded-md  text-sm
 *   active        bg-sidebar-accent  font-medium
 *   group label   h-8  px-2  text-xs  font-medium  foreground/70
 *   menu          gap-1 between items
 *   group         p-2
 *
 * `has-[>svg]:px-2` IS NOT REDUNDANT. Button's own base carries
 * `has-[>svg]:px-3`, a conditional variant that tailwind-merge does not
 * cancel against a plain `px-2` — they are different keys. So a row whose
 * mark is an <svg> took 12px while a row whose mark is an emoji <span> took
 * 8px, and the two lists misaligned by 4px depending on what each row
 * happened to contain. Overriding the variant with itself is the fix.
 */

/**
 * A row. `justify-start` AND `text-left`, which are two different fixes for
 * the same complaint. `justify-start` packs the flex children left;
 * `text-left` is what actually left-justifies the LABEL, because the UA
 * stylesheet gives every <button> `text-align: center` and the name span is
 * `flex: 1`, so the text sat centred inside a full-width box no matter
 * where the box was. shadcn's own SidebarMenuButton carries `text-left` for
 * exactly this reason. `font-normal` because Button's base is `font-medium`
 * and shadcn keeps that weight for the ACTIVE row only, which is what makes
 * the active one readable without a fill doing all the work.
 */
export const SIDEBAR_ITEM =
  "h-8 w-full justify-start gap-2 px-2 has-[>svg]:px-2 text-left font-normal";

/** The active row: shadcn's `data-[active=true]` pair. */
export const SIDEBAR_ITEM_ACTIVE =
  "bg-sidebar-accent text-sidebar-accent-foreground font-medium";

/**
 * A group header. Same 32px box as a row so the two line up, but 12px and
 * dimmed — a label is not a destination, and shadcn leans on size and
 * opacity rather than a rule or a caps treatment to say so.
 */
export const SIDEBAR_LABEL =
  "h-8 w-full justify-start gap-2 px-2 has-[>svg]:px-2 text-left text-xs font-medium text-sidebar-foreground/70";

/**
 * Whether a row of a sortable list (ui/Sortable.tsx) is lifted right now.
 *
 * dnd-kit marks the handle it is dragging `aria-pressed`. Escape drops a lifted
 * row where it was, and a dialog around the list (the Rows drawer, Settings)
 * closes on Escape too: the dialog asks first, and leaves that Escape to the
 * row. Its own module because it is read by components in different files and
 * exporting a function from a component file breaks React Fast Refresh.
 */
export const liftedRow = (): boolean => document.querySelector('[aria-roledescription="sortable"][aria-pressed="true"]') !== null;

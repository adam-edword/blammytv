/**
 * The OS "reduce motion" preference, read once.
 *
 * Its own module because it is shared by components in different files, and
 * exporting a constant from a component file breaks React Fast Refresh
 * (that file can then no longer be hot-swapped in isolation).
 *
 * Evaluated at load: this is a system setting, not a live signal, and every
 * animated surface should agree on one answer rather than each sampling it
 * at a different moment. CSS handles its own half through
 * `@media (prefers-reduced-motion: reduce)`; this is for the JS-driven
 * motion that CSS cannot gate, such as the parallax tilt's props.
 */
export const REDUCED_MOTION = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

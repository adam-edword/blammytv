/**
 * How big the sports cards are, relative to their first draft.
 *
 * Every dimension in sports.css is `calc(base * var(--sports-scale))`, so
 * this is the one number that resizes the whole hub. It exists in two
 * places, here and as `--sports-scale` in sports.css, and they MUST agree:
 * react-parallax-tilt takes its glare radius as a string prop, so that one
 * value cannot come from CSS.
 */
export const SPORTS_SCALE = 1.5;

/** A radius in px, scaled, as the string the Tilt prop wants. */
export const scaledRadius = (base: number): string =>
  `${Math.round(base * SPORTS_SCALE)}px`;

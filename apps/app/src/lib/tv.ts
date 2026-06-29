/** True on the Android TV build (the `is-android` class is set on <html> at
 * startup, before these modules load).
 *
 * On TV, norigin's spatial navigation is the single source of focus truth, so
 * components must NOT mirror focus onto native DOM focus. Native focus lags
 * during fast D-pad navigation, and a stale element then either matches
 * `:focus-visible` (a phantom highlight on the wrong card) or strands the
 * cursor when the active element diverges from norigin. Desktop still mirrors
 * focus for real keyboard/mouse a11y. */
export const isTv =
  typeof document !== "undefined" &&
  document.documentElement.classList.contains("is-android");

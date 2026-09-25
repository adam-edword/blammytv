/**
 * Clicking a nav tab from a harness, safely, right after the page loads.
 *
 * At launch the nav capsule sits still at its first position for a moment,
 * then slides its tabs into place: a 380ms margin-left transition that can
 * stall on a busy main thread (AppHeader#place). A click aimed at a tab in
 * that window lands where the tab WAS, which once the capsule has moved is
 * a gap, the BlammyTV mark or a Stream tab. CI hit it once (verify-mvsound,
 * v0.9.117): the page stayed on the Guide, with no error and no reload, and
 * the harness timed out waiting for multi-view. Settled, the Multi-view
 * button is ~260px left of where it first appears.
 *
 * So a tab is clicked only once it has held its place for 300ms (longer
 * than the capsule sits still before sliding) with no transition running
 * anywhere in the capsule, and the click must take: if the app is not on
 * that tab afterwards, this throws and says where it is instead.
 *
 * Not for a harness that clicks the nav on purpose while it moves.
 */

const STILL_MS = 300;

/** Wait until the tab for `dest` has stopped moving. */
export async function settleNav(page, dest) {
  const sel = `[data-dest="${dest}"]`;
  await page.locator(sel).waitFor();
  await page.waitForFunction(
    ({ sel, still }) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const at = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}`;
      const now = performance.now();
      const seen = (window.__navSettle ??= {});
      if (seen[sel]?.at !== at) {
        seen[sel] = { at, since: now };
        return false;
      }
      const moving = document
        .getAnimations()
        .some(
          (a) =>
            a.playState === "running" &&
            a.effect?.target instanceof Element &&
            a.effect.target.closest(".navcap"),
        );
      return !moving && now - seen[sel].since >= still;
    },
    { sel, still: STILL_MS },
    { polling: 50, timeout: 15_000 },
  );
}

/** Click the tab for `dest` once the nav has settled, and make sure it took. */
export async function goTo(page, dest, clickOptions = {}) {
  await settleNav(page, dest);
  await page.locator(`[data-dest="${dest}"]`).click(clickOptions);
  const took = await page
    .waitForFunction(
      (d) => document.querySelector(`[data-dest="${d}"]`)?.getAttribute("aria-current") === "page",
      dest,
      { timeout: 5_000 },
    )
    .then(
      () => true,
      () => false,
    );
  if (!took) {
    const at = await page.evaluate(
      () => document.querySelector("[data-dest][aria-current='page']")?.getAttribute("data-dest") ?? "nowhere",
    );
    throw new Error(`clicked the ${dest} tab but the app stayed on ${at}`);
  }
}

// Pause a page's installed clock a moment from now. clock.pauseAt throws for a
// time already past, and a loaded machine can lose more than 20ms between
// reading the page's clock and pausing it (verify-stream-four crashed so at a
// load average of 7), so a miss reads the clock again and tries once more.
export async function pauseSoon(page) {
  for (let tries = 0; ; tries++) {
    const now = await page.evaluate(() => Date.now());
    try {
      return await page.clock.pauseAt(now + 20);
    } catch (e) {
      if (tries >= 4 || !/past/.test(String(e?.message ?? e))) throw e;
    }
  }
}

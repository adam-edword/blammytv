import { describe, expect, it } from "vitest";
import { DISK_MAX_AGE_MS, EPG_KEEP_AHEAD_MS } from "./epgWindow";

/**
 * These two constants are only correct relative to each other, and they
 * lived in different files with no link between them: the disk cache served
 * snapshots up to 8h old while the parser kept 12h of listings, which
 * happened to work. Raising the cache to 40h without touching the parser
 * would have hydrated a guide with nothing left in it — instant, and empty,
 * which is precisely the state the cache exists to prevent.
 *
 * So the relationship gets a test rather than a comment.
 */
describe("EPG retention vs cache age", () => {
  it("keeps enough schedule to outlive the oldest servable snapshot", () => {
    expect(EPG_KEEP_AHEAD_MS).toBeGreaterThan(DISK_MAX_AGE_MS);
  });

  it("still fills the visible window at the very end of a snapshot's life", () => {
    // A snapshot fetched exactly DISK_MAX_AGE_MS ago, opened now: what is
    // left of its schedule has to cover the 4h the guide actually shows.
    const remaining = EPG_KEEP_AHEAD_MS - DISK_MAX_AGE_MS;
    expect(remaining).toBeGreaterThanOrEqual(4 * 3600_000);
  });
});

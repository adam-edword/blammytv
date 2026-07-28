import { describe, expect, it } from "vitest";
import { autoPlay } from "./autoplay";
import type { Match } from "./matcher";

const chan = (id: string, confidence = 90): Match => ({
  id,
  name: id,
  quality: null,
  confidence,
});

const game = (state: "pre" | "live" | "final") => ({ id: "g1", state });

describe("autoPlay", () => {
  it("plays the top of the rail, which is what best-source means", () => {
    const rail = [chan("marquee", 70), chan("mlbtv", 100)];
    // NOT the highest number: the rail bands its order deliberately, and
    // autoplay agrees with what is drawn rather than re-deciding.
    expect(autoPlay(game("live"), rail, null)).toBe(rail[0]);
  });

  it("fires once per game, so stopping stays stopped", () => {
    const rail = [chan("marquee")];
    expect(autoPlay(game("live"), rail, null)).toBe(rail[0]);
    expect(autoPlay(game("live"), rail, "g1")).toBeNull();
  });

  it("re-arms on a different game", () => {
    const rail = [chan("marquee")];
    expect(autoPlay({ id: "g2", state: "live" }, rail, "g1")).toBe(rail[0]);
  });

  it("leaves a finished game alone", () => {
    expect(autoPlay(game("final"), [chan("marquee")], null)).toBeNull();
  });

  it("plays a game that has not started: the channel is still the one", () => {
    const rail = [chan("fox")];
    expect(autoPlay(game("pre"), rail, null)).toBe(rail[0]);
  });

  it("waits when there is nothing to play yet", () => {
    // A cold start renders before the catalog loads, so the first ask has
    // an empty rail and the caller asks again when channels arrive.
    expect(autoPlay(game("live"), [], null)).toBeNull();
    expect(autoPlay(game("live"), [chan("marquee")], null)).not.toBeNull();
  });
});

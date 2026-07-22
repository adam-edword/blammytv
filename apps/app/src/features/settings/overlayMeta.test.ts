import { describe, expect, it } from "vitest";
import { overlayHeading, type OverlayMetaField } from "./overlayMeta";

const ALL: OverlayMetaField[] = ["logo", "season", "episode", "title", "description"];
const ep = { season: 23, episode: 2, title: "Nami in a Fix!" };

describe("overlayHeading", () => {
  it("composes the full line", () => {
    expect(overlayHeading(ALL, ep, "One Piece")).toBe("S23 · E2 — Nami in a Fix!");
  });
  it("drops each fragment independently", () => {
    expect(overlayHeading(["episode", "title"], ep, undefined)).toBe("E2 — Nami in a Fix!");
    expect(overlayHeading(["season", "episode"], ep, undefined)).toBe("S23 · E2");
    expect(overlayHeading(["title"], ep, undefined)).toBe("Nami in a Fix!");
    expect(overlayHeading(["logo"], ep, undefined)).toBe("");
  });
  it("movies ride the title toggle with the fallback name", () => {
    expect(overlayHeading(ALL, undefined, "Spirited Away")).toBe("Spirited Away");
    expect(overlayHeading(["season", "episode"], undefined, "Spirited Away")).toBe("");
  });
});

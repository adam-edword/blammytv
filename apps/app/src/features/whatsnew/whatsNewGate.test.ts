import { describe, expect, it } from "vitest";
import { shouldShowWhatsNew } from "./whatsNewGate";

const base = { seen: null, version: "1.2.0", newest: "1.2", firstRun: false };

describe("shouldShowWhatsNew", () => {
  it("shows to a profile that has seen an older release", () => {
    expect(shouldShowWhatsNew({ ...base, seen: "1.0" })).toBe(true);
  });

  it("shows to an existing profile that has never seen one", () => {
    expect(shouldShowWhatsNew({ ...base, seen: null })).toBe(true);
  });

  it("does not show a release twice", () => {
    expect(shouldShowWhatsNew({ ...base, seen: "1.2" })).toBe(false);
  });

  it("does not show to a profile that has seen a later one", () => {
    expect(shouldShowWhatsNew({ ...base, seen: "1.3" })).toBe(false);
  });

  it("does not announce a release the build is below", () => {
    expect(shouldShowWhatsNew({ ...base, version: "1.0.42", seen: null })).toBe(false);
    expect(shouldShowWhatsNew({ ...base, version: "1.1.9", seen: "1.0" })).toBe(false);
  });

  it("compares by major and minor, so any patch of the release shows it", () => {
    expect(shouldShowWhatsNew({ ...base, version: "1.2.0", seen: "1.0" })).toBe(true);
    expect(shouldShowWhatsNew({ ...base, version: "1.2.17", seen: "1.0" })).toBe(true);
    expect(shouldShowWhatsNew({ ...base, version: "2.0.0", seen: "1.2" })).toBe(false);
  });

  it("compares minors as numbers, not text", () => {
    expect(shouldShowWhatsNew({ ...base, version: "1.10.0", newest: "1.10", seen: "1.9" })).toBe(true);
    expect(shouldShowWhatsNew({ ...base, version: "1.10.0", newest: "1.10", seen: "1.10" })).toBe(false);
  });

  it("never shows on a first run, which has onboarding", () => {
    expect(shouldShowWhatsNew({ ...base, seen: null, firstRun: true })).toBe(false);
    expect(shouldShowWhatsNew({ ...base, seen: "1.0", firstRun: true })).toBe(false);
  });
});

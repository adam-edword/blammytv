import { describe, expect, it } from "vitest";
import { extractQuality } from "./quality";

describe("extractQuality", () => {
  it("finds the resolution ladder", () => {
    expect(extractQuality("FOX SPORTS 4K")).toBe("4K");
    expect(extractQuality("ESPN UHD")).toBe("4K");
    expect(extractQuality("Sky Ultra HD")).toBe("4K");
    expect(extractQuality("TSN 2160p")).toBe("4K");
    expect(extractQuality("ESPN | FHD")).toBe("FHD");
    expect(extractQuality("beIN 1080p")).toBe("FHD");
    expect(extractQuality("RAI 1080i")).toBe("FHD");
    expect(extractQuality("CBS FULL HD")).toBe("FHD");
    expect(extractQuality("TNT HD")).toBe("HD");
    expect(extractQuality("DAZN 720p")).toBe("HD");
  });

  it("4K outranks everything, HDR outranks FHD", () => {
    expect(extractQuality("BT Sport 4K HDR")).toBe("4K");
    expect(extractQuality("BT Sport 1080p HDR10")).toBe("HDR");
    expect(extractQuality("Sky Dolby Vision FHD")).toBe("HDR");
  });

  it("does not misread words containing tags", () => {
    // FHD must not read as HD; HDTV/UHD-adjacent words stay whole.
    expect(extractQuality("ESPN FHD")).toBe("FHD");
    expect(extractQuality("The HDTV Channel")).toBeNull();
    expect(extractQuality("Sky Shadow")).toBeNull();
  });

  it("returns null for unmarked or SD names", () => {
    expect(extractQuality("ESPN")).toBeNull();
    expect(extractQuality("Cartoon Network SD")).toBeNull();
  });
});

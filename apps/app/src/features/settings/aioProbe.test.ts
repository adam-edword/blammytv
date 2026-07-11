import { describe, expect, it } from "vitest";

import { probeVerdict, type ProbeStep } from "./aioProbe";

// probeVerdict turns forensic evidence into the one sentence a user can
// act on. It must only speak when the failure shape is one we've
// conclusively diagnosed before (the Bobby-403 rule: no guessing).

const ok = (label: string): ProbeStep => ({ label, ok: true, detail: "OK — 3" });

describe("probeVerdict", () => {
  it("stays silent when every step passed", () => {
    expect(probeVerdict([ok("Manifest"), ok("Catalog")])).toBeUndefined();
  });

  it("names the Cloudflare challenge from the forensic headers", () => {
    const v = probeVerdict([
      {
        label: "Manifest",
        ok: false,
        detail: "HTTP 403",
        forensic:
          'answered HTTP 403 — server: cloudflare · cf-mitigated: challenge · body starts "<!DOCTYPE html>"',
      },
    ]);
    expect(v).toMatch(/bot protection/);
    expect(v).toMatch(/can't be fixed/);
  });

  it("recognizes the challenge block page even without cf-mitigated", () => {
    const v = probeVerdict([
      ok("Manifest"),
      {
        label: "Catalog (movie/top)",
        ok: false,
        detail: "HTTP 403",
        forensic:
          'answered HTTP 403 — server: cloudflare · body starts "<title>Just a moment...</title>"',
      },
    ]);
    expect(v).toMatch(/bot protection/);
  });

  it("suggests a stale config on a plain 403 with no challenge markers", () => {
    const v = probeVerdict([
      {
        label: "Manifest",
        ok: false,
        detail: "HTTP 403",
        forensic: 'answered HTTP 403 — server: nginx · body starts "Forbidden"',
      },
    ]);
    expect(v).toMatch(/expired or been regenerated/);
    expect(v).toMatch(/If the error persists.*server.*hosting your manifest/);
  });

  it("stays silent on failures it can't diagnose", () => {
    expect(
      probeVerdict([
        { label: "Manifest", ok: false, detail: "Failed to fetch" },
      ]),
    ).toBeUndefined();
    expect(
      probeVerdict([
        { label: "Manifest", ok: false, detail: "HTTP 500" },
      ]),
    ).toBeUndefined();
  });
});

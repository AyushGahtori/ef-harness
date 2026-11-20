import { describe, expect, it } from "vitest";
import { FONT_ATTESTATION_PHRASE, FontLicenseInspector } from "../../src/assets/index.js";
import { buildFixtureFont } from "./opentype-fixture.js";

const inspector = new FontLicenseInspector();

describe("FontLicenseInspector", () => {
  it("reads OpenType name metadata with fontkit and blocks a desktop-only font", () => {
    const bytes = buildFixtureFont({
      familyName: "Helvetica Neue",
      postscriptName: "HelveticaNeue",
      license: "Desktop use only",
      copyright: "Proprietary",
      fsType: 2,
      weight: 400,
    });
    const report = inspector.inspect(bytes, "HelveticaNeue.otf");
    expect(report.familyName).toBe("Helvetica Neue");
    expect(report.postscriptName).toBe("HelveticaNeue");
    expect(report.weight).toBe(400);
    expect(report.style).toBe("normal");
    expect(report.coverage.glyphCount).toBe(2);
    expect(report.coverage.latin).toBe(true);
    expect(report.licenseText).toBe("Desktop use only");
    expect(report.classification).toBe("desktop-only");
    expect(report.embedding.noEmbedding).toBe(true);
    expect(report.requiresAttestation).toBe(true);
    expect(report.bundleAllowed).toBe(false);
    expect(report.preferWoff2).toBe(true);
    expect(report.container).toBe("otf");
    expect(report.confirmationMessage).toContain(FONT_ATTESTATION_PHRASE);
    const wrong = inspector.withAttestation(report, "I think this is fine");
    expect(wrong.bundleAllowed).toBe(false);
    const accepted = inspector.withAttestation(report, FONT_ATTESTATION_PHRASE);
    expect(accepted.attestationAccepted).toBe(true);
    expect(accepted.bundleAllowed).toBe(true);
    expect(accepted.confirmationMessage).toBeNull();
  });

  it("allows an OFL font and still prefers woff2 delivery", () => {
    const bytes = buildFixtureFont({
      familyName: "Northwind Sans",
      license: "This Font Software is licensed under the SIL Open Font License, Version 1.1.",
      fsType: 0,
      weight: 700,
    });
    const report = inspector.inspect(bytes, "NorthwindSans.ttf");
    expect(report.classification).toBe("open");
    expect(report.bundleAllowed).toBe(true);
    expect(report.requiresAttestation).toBe(false);
    expect(report.weight).toBe(700);
    expect(report.preferWoff2).toBe(true);
  });

  it("requires attestation when the license name record is missing", () => {
    const bytes = buildFixtureFont({ familyName: "Mystery Face", fsType: 0 });
    const report = inspector.inspect(bytes, "MysteryFace.woff");
    expect(report.classification).toBe("unknown");
    expect(report.bundleAllowed).toBe(false);
    expect(report.container).toBe("woff");
  });
});

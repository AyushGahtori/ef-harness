import { Buffer } from "node:buffer";
import { FontLicenseError } from "./errors.js";
import { loadFontkit, type FontkitFont, type FontkitFsType, type FontkitModule } from "./engines.js";
import { FONT_ATTESTATION_PHRASE } from "./limits.js";

export type FontContainer = "woff2" | "woff" | "ttf" | "otf";
export type FontLicenseClass = "open" | "proprietary" | "desktop-only" | "unknown";

export interface FontGlyphCoverage {
  readonly glyphCount: number;
  readonly unicodeCount: number;
  readonly latin: boolean;
  readonly sample: readonly number[];
}

export interface FontLicenseReport {
  readonly familyName: string;
  readonly subfamily: string;
  readonly postscriptName: string;
  readonly weight: number;
  readonly style: "normal" | "italic";
  readonly coverage: FontGlyphCoverage;
  readonly licenseText: string;
  readonly copyright: string;
  readonly embedding: {
    readonly noEmbedding: boolean;
    readonly viewOnly: boolean;
    readonly editable: boolean;
  };
  readonly classification: FontLicenseClass;
  readonly requiresAttestation: boolean;
  readonly attestationPhrase: typeof FONT_ATTESTATION_PHRASE;
  readonly attestationAccepted: boolean;
  readonly bundleAllowed: boolean;
  readonly container: FontContainer;
  readonly preferWoff2: boolean;
  readonly confirmationMessage: string | null;
}

const OPEN_LICENSE = /SIL Open Font License|Open Font License|\bOFL\b|Apache License|MIT License|Ubuntu Font Licence|public domain|\bCC0\b/i;
const DESKTOP_LICENSE = /desktop use only|desktop-only|not for web|no web embedding|embedding prohibited/i;
const PROPRIETARY_LICENSE = /proprietary|all rights reserved|commercial use only|licensed to/i;

export class FontLicenseInspector {
  constructor(private readonly fontkit: FontkitModule = loadFontkit()) {}

  inspect(bytes: Uint8Array, filename: string): FontLicenseReport {
    let font: FontkitFont;
    try {
      font = this.fontkit.create(Buffer.from(bytes));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new FontLicenseError("malformed-font", `fontkit could not read ${filename}: ${message}`);
    }
    const licenseText = recordText(font.name?.records?.license);
    const copyright = recordText(font.name?.records?.copyright);
    const fsType = font["OS/2"]?.fsType;
    const classification = classifyLicense(licenseText, copyright, fsType);
    const requiresAttestation = classification !== "open";
    const container = containerOf(filename, bytes);
    const coverage = coverageOf(font);
    const style = font["OS/2"]?.fsSelection?.italic || /italic|oblique/i.test(font.subfamilyName ?? "")
      ? "italic"
      : "normal";
    return this.finish({
      familyName: font.familyName || filename,
      subfamily: font.subfamilyName || "Regular",
      postscriptName: font.postscriptName || font.familyName || filename,
      weight: font["OS/2"]?.usWeightClass || (font["OS/2"]?.fsSelection?.bold ? 700 : 400),
      style,
      coverage,
      licenseText,
      copyright,
      embedding: {
        noEmbedding: fsType?.noEmbedding === true,
        viewOnly: fsType?.viewOnly === true,
        editable: fsType?.editable === true,
      },
      classification,
      requiresAttestation,
      attestationAccepted: false,
      container,
      preferWoff2: container !== "woff2",
    });
  }

  withAttestation(report: FontLicenseReport, phrase: string): FontLicenseReport {
    const accepted = phrase.normalize("NFC") === FONT_ATTESTATION_PHRASE;
    return this.finish({
      ...report,
      attestationAccepted: accepted,
      requiresAttestation: report.classification !== "open",
    });
  }

  private finish(input: Omit<FontLicenseReport, "attestationPhrase" | "bundleAllowed" | "confirmationMessage">): FontLicenseReport {
    const bundleAllowed = !input.requiresAttestation || input.attestationAccepted;
    const confirmationMessage = bundleAllowed
      ? null
      : `${input.familyName} is marked ${input.classification}. It will not be copied into the web app until you confirm: "${FONT_ATTESTATION_PHRASE}".`;
    return {
      ...input,
      attestationPhrase: FONT_ATTESTATION_PHRASE,
      bundleAllowed,
      confirmationMessage,
    };
  }
}

function classifyLicense(license: string, copyright: string, fsType: FontkitFsType | undefined): FontLicenseClass {
  const combined = `${license}\n${copyright}`;
  const desktop = DESKTOP_LICENSE.test(license) || fsType?.noEmbedding === true;
  if (desktop) return "desktop-only";
  if (OPEN_LICENSE.test(combined)) return "open";
  if (PROPRIETARY_LICENSE.test(combined) || fsType?.viewOnly === true) return "proprietary";
  if (!license.trim()) return "unknown";
  return "proprietary";
}

function coverageOf(font: FontkitFont): FontGlyphCoverage {
  const codes = (font.characterSet ?? []).filter((code) => code > 0 && code !== 0xffff && code <= 0x10ffff);
  const unique = [...new Set(codes)].sort((left, right) => left - right);
  return {
    glyphCount: font.numGlyphs ?? unique.length,
    unicodeCount: unique.length,
    latin: unique.some((code) => code >= 0x41 && code <= 0x5a),
    sample: unique.slice(0, 16),
  };
}

function recordText(record: unknown): string {
  if (typeof record === "string") return record.trim();
  if (!record || typeof record !== "object") return "";
  const entries = record as Record<string, unknown>;
  const english = entries.en;
  if (typeof english === "string" && english.trim()) return english.trim();
  for (const value of Object.values(entries)) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function containerOf(filename: string, bytes: Uint8Array): FontContainer {
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  if (extension === "woff2" || extension === "woff" || extension === "otf" || extension === "ttf") {
    return extension;
  }
  const magic = Buffer.from(bytes.subarray(0, 4)).toString("latin1");
  if (magic === "wOF2") return "woff2";
  if (magic === "wOFF") return "woff";
  if (magic === "OTTO") return "otf";
  return "ttf";
}

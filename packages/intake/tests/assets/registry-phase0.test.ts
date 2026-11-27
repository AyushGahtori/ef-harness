import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  BrandAssetRegistry,
  DESIGN_SYSTEM_SOURCE,
  FONT_ATTESTATION_PHRASE,
  MISSING_LIGHT_LOGO_ALERT,
  MemoryCasBlobStore,
  Phase0BrandAssetsGenerator,
  SqliteBrandAssetState,
  type BrandColorSuggestion,
  type DesignSystemScaffoldBuilderPort,
} from "../../src/assets/index.js";
import { buildFixtureFont } from "./opentype-fixture.js";
import { scanUnapprovedHotlinks } from "../../src/assets/hotlink-scanner.js";

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "package.json"));
const sharp = require("sharp") as (input: Buffer | { create: object }) => {
  jpeg: () => { toBuffer: () => Promise<Buffer> };
  png: () => { toBuffer: () => Promise<Buffer> };
};

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("BrandAssetRegistry and Phase 0 emission", () => {
  it("stores a sanitized asset in CAS and a brand_asset node in state.db", async () => {
    const suggestions: BrandColorSuggestion[] = [];
    const designSystem: DesignSystemScaffoldBuilderPort = {
      source: DESIGN_SYSTEM_SOURCE,
      suggestBrandColors(suggestion) {
        suggestions.push(suggestion);
      },
    };
    const registry = new BrandAssetRegistry({
      cas: new MemoryCasBlobStore(),
      state: SqliteBrandAssetState.open(),
      designSystem,
    });
    const png = await sharp({
      create: { width: 6, height: 4, channels: 3, background: { r: 32, g: 64, b: 96 } },
    }).png().toBuffer();
    const stored = await registry.registerRaster(png, { role: "hero", altText: "Hero mark" });
    expect(stored.assetId).toBe("BA-hero");
    expect(stored.role).toBe("hero");
    expect(stored.casSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.placeholder).toBe(false);
    expect(stored.dominantColorsHex.length).toBeGreaterThan(0);
    const roundTrip = Buffer.from(registry.readBytes("hero"));
    expect(roundTrip.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(roundTrip.length).toBe(stored.byteLength);
    const row = registry.get("hero");
    expect(row?.casSha256).toBe(stored.casSha256);
    expect(suggestions).toEqual([
      expect.objectContaining({ assetId: "BA-hero", role: "hero" }),
    ]);
    const state = registry.list();
    expect(state).toHaveLength(1);
    expect(state[0]?.mimeType).toBe("image/png");
  });

  it("alerts when only a dark logo is uploaded and can accept the inverted offer", async () => {
    const registry = openRegistry();
    const png = await sharp({
      create: { width: 4, height: 4, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } },
    }).png().toBuffer();
    await registry.registerRaster(png, { role: "logo_dark", altText: "Dark logo" });
    expect(registry.alerts).toContain(MISSING_LIGHT_LOGO_ALERT);
    expect(registry.offers.map((offer) => offer.kind)).toEqual(["inverted-monochrome", "placeholder"]);
    expect(registry.get("logo_light")).toBeNull();
    const light = await registry.acceptInvertedLogoLight();
    expect(light.role).toBe("logo_light");
    expect(registry.alerts).not.toContain(MISSING_LIGHT_LOGO_ALERT);
    expect(registry.get("logo_light")?.casSha256).toBe(light.casSha256);
  });

  it("refuses to bundle a desktop-only font until the attestation phrase is recorded", async () => {
    const registry = openRegistry();
    const bytes = buildFixtureFont({
      familyName: "Helvetica Neue",
      postscriptName: "HelveticaNeue",
      license: "Desktop use only",
      fsType: 2,
    });
    const blocked = await registry.registerFont(bytes, "HelveticaNeue.otf");
    expect(blocked.status).toBe("needs-attestation");
    expect(blocked.asset).toBeNull();
    expect(blocked.report.confirmationMessage).toContain(FONT_ATTESTATION_PHRASE);
    expect(registry.get("font")).toBeNull();
    const allowed = await registry.registerFont(bytes, "HelveticaNeue.otf", FONT_ATTESTATION_PHRASE);
    expect(allowed.status).toBe("registered");
    expect(allowed.asset?.licenseAttestation).toBe(FONT_ATTESTATION_PHRASE);
    expect(allowed.asset?.mimeType).toBe("font/otf");
    expect(registry.get("font")?.casSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("emits typed src/brand/assets.ts and real files, with placeholders when nothing was uploaded", async () => {
    const registry = openRegistry();
    const appRoot = mkdtempSync(path.join(tmpdir(), "brand-assets-"));
    roots.push(appRoot);
    const emitted = await new Phase0BrandAssetsGenerator(registry).emit({
      appRoot,
      projectName: "Northwind Kitchen",
    });
    expect(emitted.hotlinks).toEqual([]);
    expect(emitted.checklist.length).toBeGreaterThan(0);
    expect(emitted.assetsTs).toContain("export const BRAND_ASSETS");
    expect(emitted.assetsTs).toContain("logoLight:");
    expect(emitted.assetsTs).toContain("favicon:");
    expect(emitted.assetsTs).toContain("placeholder: true");
    expect(emitted.assetsTs).not.toContain("unsplash.com");
    expect(emitted.assetsTs).not.toContain("https://");
    for (const file of emitted.files) {
      expect(statSync(file).isFile()).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(0);
    }
    const assetsPath = path.join(appRoot, "src", "brand", "assets.ts");
    expect(readFileSync(assetsPath, "utf8")).toBe(emitted.assetsTs);
    const diagnostics = typecheck(assetsPath);
    expect(diagnostics).toEqual([]);
    const findings = scanUnapprovedHotlinks(
      `<img src="https://images.unsplash.com/photo-123" />\n<img src="/logo.png" />`,
      { projectRoot: appRoot },
    );
    expect(findings.map((finding) => finding.reason)).toEqual(["stock-cdn", "broken-relative-path"]);
    expect(findings[0]?.message).toContain("BRAND_ASSETS");
  }, 20_000);
});

function openRegistry(): BrandAssetRegistry {
  return new BrandAssetRegistry({
    cas: new MemoryCasBlobStore(),
    state: SqliteBrandAssetState.open(),
  });
}

function typecheck(file: string): string[] {
  const ts = require("typescript") as {
    createProgram: (files: string[], options: Record<string, unknown>) => {
      getSemanticDiagnostics: () => Array<{ messageText: unknown; file?: { fileName: string } }>;
    };
    flattenDiagnosticMessageText: (message: unknown, newline: string) => string;
    ScriptTarget: { ES2022: number };
    ModuleKind: { ESNext: number };
    ModuleResolutionKind: { Bundler: number };
  };
  const program = ts.createProgram([file], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    noResolve: true,
  });
  return program.getSemanticDiagnostics()
    .filter((diagnostic) => diagnostic.file?.fileName.endsWith("assets.ts"))
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}

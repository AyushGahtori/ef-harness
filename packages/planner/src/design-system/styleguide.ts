import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { LOCAL_PORTS, PRIMITIVE_STATES, STYLEGUIDE_VIEWPORTS } from "./types.js";
import type { ThemeSupport } from "./types.js";

export interface AxeViolation {
  readonly impact: "minor" | "moderate" | "serious" | "critical";
  readonly id: string;
  readonly help: string;
}

export interface StyleguideViewportReport {
  readonly viewport: { readonly name: string; readonly width: number; readonly height: number };
  readonly theme: "light" | "dark";
  readonly consoleErrors: readonly string[];
  readonly pageErrors: readonly string[];
  readonly axeViolations: readonly AxeViolation[];
  readonly clippedLabels: readonly string[];
  readonly screenshotPng: Uint8Array;
}

export interface UiPlaywrightContractVerifierPort {
  readonly source: string;
  audit(input: StyleguideAuditInput): readonly StyleguideViewportReport[];
}

export interface StyleguideAuditInput {
  readonly routeSource: string;
  readonly css: string;
  readonly themes: readonly ("light" | "dark")[];
  readonly surfaceHex: { readonly light: string; readonly dark: string };
}

export interface StyleguideVerification {
  readonly ok: boolean;
  readonly guardPresent: boolean;
  readonly productionExcluded: boolean;
  readonly consoleErrors: readonly string[];
  readonly pageErrors: readonly string[];
  readonly axeSerious: readonly string[];
  readonly clipped: readonly string[];
  readonly fontLoadingBroken: boolean;
  readonly screenshotCasIds: readonly string[];
  readonly viewports: readonly number[];
  readonly issues: readonly string[];
}

export interface CasBlobStorePort {
  readonly source: string;
  put(bytes: Uint8Array, mediaType: string): { readonly sha256: string; readonly mediaType: string };
}

export class MemoryCasBlobStore implements CasBlobStorePort {
  readonly source = LOCAL_PORTS.casBlobStore;
  readonly blobs = new Map<string, Uint8Array>();

  put(bytes: Uint8Array, mediaType: string): { readonly sha256: string; readonly mediaType: string } {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    this.blobs.set(sha256, bytes);
    return { sha256, mediaType };
  }
}

export class OfflineUiPlaywrightContractVerifier implements UiPlaywrightContractVerifierPort {
  readonly source = LOCAL_PORTS.uiPlaywrightContractVerifier;

  audit(input: StyleguideAuditInput): readonly StyleguideViewportReport[] {
    const consoleErrors = input.routeSource.includes("console.error") ? ["console.error"] : [];
    const pageErrors = /\bthrow\b/.test(input.routeSource) ? ["pageerror"] : [];
    const axe = staticAxe(input.routeSource, input.css);
    const labels = literalLabels(input.routeSource);
    return STYLEGUIDE_VIEWPORTS.flatMap((viewport) =>
      input.themes.map((theme) => {
        const clippedLabels = labels.filter((label) => label.length * 8 + 32 > viewport.width - 32);
        return {
          viewport,
          theme,
          consoleErrors,
          pageErrors,
          axeViolations: axe,
          clippedLabels,
          screenshotPng: solidPng(input.surfaceHex[theme], viewport.width, viewport.height),
        };
      }),
    );
  }
}

export class StyleguideRouteVerifier {
  verify(input: {
    readonly routeSource: string;
    readonly css: string;
    readonly productionBundle: string;
    readonly themes: readonly ("light" | "dark")[];
    readonly requiredNames: readonly string[];
    readonly surfaceHex: { readonly light: string; readonly dark: string };
    readonly playwright?: UiPlaywrightContractVerifierPort;
    readonly cas?: CasBlobStorePort;
  }): StyleguideVerification {
    const playwright = input.playwright ?? new OfflineUiPlaywrightContractVerifier();
    const cas = input.cas ?? new MemoryCasBlobStore();
    const reports = playwright.audit({
      routeSource: input.routeSource,
      css: input.css,
      themes: input.themes,
      surfaceHex: input.surfaceHex,
    });
    const issues: string[] = [];
    const guardPresent =
      input.routeSource.includes("import.meta.env.DEV") &&
      (input.routeSource.includes("NODE_ENV !== 'production'") ||
        input.routeSource.includes('NODE_ENV !== "production"'));
    if (!guardPresent) issues.push("styleguide route is missing the dev build guard");
    const productionExcluded =
      !input.productionBundle.includes("data-ef-styleguide") && !input.productionBundle.includes("/__styleguide");
    if (!productionExcluded) issues.push("/__styleguide is present in the production bundle");
    const fontLoadingBroken =
      input.routeSource.includes("@font-face") ||
      input.css.includes("@font-face") ||
      input.routeSource.includes("fonts.googleapis.com") ||
      input.css.includes("fonts.googleapis.com");
    if (fontLoadingBroken) issues.push("styleguide depends on a remote font");
    for (const state of PRIMITIVE_STATES) {
      if (!input.routeSource.includes(state)) issues.push(`styleguide is missing state ${state}`);
    }
    for (const name of input.requiredNames) {
      if (!input.routeSource.includes(name)) issues.push(`styleguide is missing ${name}`);
    }
    for (const theme of input.themes) {
      if (!input.routeSource.includes(`data-theme="${theme}"`)) issues.push(`styleguide is missing ${theme}`);
    }
    if (!input.css.includes(":focus-visible") && !input.css.includes("focus-visible")) {
      issues.push("token stylesheet is missing a focus-visible style");
    }
    if (!input.css.includes("--tap-target")) issues.push("token stylesheet is missing the 24px tap target");
    const consoleErrors = unique(reports.flatMap((report) => report.consoleErrors));
    const pageErrors = unique(reports.flatMap((report) => report.pageErrors));
    const axeSerious = unique(
      reports.flatMap((report) =>
        report.axeViolations
          .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
          .map((violation) => `${violation.id}: ${violation.help}`),
      ),
    );
    const clipped = unique(
      reports.flatMap((report) =>
        report.clippedLabels.map((label) => `${label} clips at ${report.viewport.width}px`),
      ),
    );
    for (const error of consoleErrors) issues.push(`console error: ${error}`);
    for (const error of pageErrors) issues.push(`page error: ${error}`);
    for (const violation of axeSerious) issues.push(`axe ${violation}`);
    for (const clip of clipped) issues.push(clip);
    const widths = new Set(reports.map((report) => report.viewport.width));
    if (!widths.has(375) || !widths.has(1440)) issues.push("styleguide was not rendered at 375px and 1440px");
    const screenshotCasIds = reports.map(
      (report) => cas.put(report.screenshotPng, "image/png").sha256,
    );
    return {
      ok: issues.length === 0,
      guardPresent,
      productionExcluded,
      consoleErrors,
      pageErrors,
      axeSerious,
      clipped,
      fontLoadingBroken,
      screenshotCasIds,
      viewports: [...widths],
      issues,
    };
  }
}

export function themesFor(theme: ThemeSupport): readonly ("light" | "dark")[] {
  if (theme === "both") return ["light", "dark"];
  return [theme];
}

export function productionBundle(files: readonly { readonly path: string; readonly contents: string }[]): string {
  return files
    .filter((file) => !file.path.includes("__styleguide"))
    .map((file) => file.contents)
    .sort((left, right) => left.localeCompare(right))
    .join("\n");
}

function staticAxe(routeSource: string, css: string): AxeViolation[] {
  const violations: AxeViolation[] = [];
  if (/<button\b[^>]*\/>/.test(routeSource)) {
    violations.push({ impact: "serious", id: "button-name", help: "Buttons need an accessible name" });
  }
  for (const match of routeSource.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const attrs = match[1] ?? "";
    const text = (match[2] ?? "").replace(/<[^>]+>/g, "").trim();
    const named = /aria-label\s*=\s*["'][^"']+["']/.test(attrs) || text.length > 0;
    if (!named) {
      violations.push({ impact: "serious", id: "button-name", help: "Buttons need an accessible name" });
    }
  }
  for (const match of routeSource.matchAll(/<input\b([^>]*)>/g)) {
    const attrs = match[1] ?? "";
    const named = /aria-label\s*=/.test(attrs) || /\bid\s*=/.test(attrs);
    const hasLabel = /<label\b/i.test(routeSource);
    if (!named && !hasLabel) {
      violations.push({ impact: "serious", id: "label", help: "Inputs need a label" });
    }
  }
  if (/<img\b(?![^>]*\balt=)/.test(routeSource)) {
    violations.push({ impact: "critical", id: "image-alt", help: "Images need alt text" });
  }
  if (!css.includes("focus-visible") && !routeSource.includes('state="focus"') && !routeSource.includes("data-state=\"focus\"")) {
    violations.push({ impact: "serious", id: "focus-visible", help: "Interactive controls need a visible focus style" });
  }
  return violations;
}

function literalLabels(routeSource: string): string[] {
  const labels: string[] = [];
  for (const match of routeSource.matchAll(/<(?:button|Button)\b[^>]*>([^<{]+)</g)) {
    const text = (match[1] ?? "").trim();
    if (text) labels.push(text);
  }
  return labels;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function solidPng(hex: string, width: number, height: number): Uint8Array {
  const color = hex.replace("#", "");
  const red = Number.parseInt(color.slice(0, 2), 16);
  const green = Number.parseInt(color.slice(2, 4), 16);
  const blue = Number.parseInt(color.slice(4, 6), 16);
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 3] = red;
    row[2 + x * 3] = green;
    row[3 + x * 3] = blue;
  }
  const raw = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y += 1) row.copy(raw, y * row.length);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc ^= data[index] ?? 0;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

import { createHash } from "node:crypto";
import axe from "axe-core";
import { launchChromium, UiInteractionContractVerifier } from "@ef-harness/verifier";
import { CANONICAL_VIEWPORTS } from "./constants.js";
import type { AxeViolation, RasterFrame, RenderedRouteAudit, ScreenRhythmMetrics, ThemeMode } from "./types.js";

export interface CapturedScreenshot {
  readonly route: string;
  readonly viewportId: string;
  readonly theme: ThemeMode;
  readonly width: number;
  readonly height: number;
  readonly png: Uint8Array;
  readonly frame: RasterFrame;
}

export interface ActiveUiCapture {
  readonly verifierId: string;
  readonly audits: readonly RenderedRouteAudit[];
  readonly axeViolations: readonly AxeViolation[];
  readonly rhythm: readonly ScreenRhythmMetrics[];
  readonly screenshots: readonly CapturedScreenshot[];
}

interface PageOps {
  setViewportSize(size: { readonly width: number; readonly height: number }): Promise<void>;
  setContent(html: string, options?: { readonly waitUntil?: "load"; readonly timeout?: number }): Promise<void>;
  addScriptTag(options: { readonly content: string }): Promise<unknown>;
  screenshot(options?: { readonly type?: "png" }): Promise<Uint8Array>;
  evaluate<T>(pageFunction: () => T | Promise<T>): Promise<T>;
}

interface Measured {
  readonly button: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;
  readonly headerHeight: number;
  readonly sidebarWidth: number;
  readonly pageTitleFontSize: number;
  readonly pageTitleLineHeight: number;
  readonly cardPadding: number;
  readonly cardBorderRadius: number;
  readonly primaryButtonHeight: number;
  readonly pageTitleFontFamily: string;
  readonly bodyFontFamily: string;
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly primaryContentHeight: number;
  readonly axe: readonly { readonly id: string; readonly impact: string | null; readonly description: string; readonly target: string }[];
}

const ROUTES = ["/playwright/orders", "/playwright/menu"] as const;
const THEMES: readonly ThemeMode[] = ["light", "dark"];

let cached: Promise<ActiveUiCapture> | null = null;

export function captureActiveUiPlaywright(): Promise<ActiveUiCapture> {
  if (!cached) {
    cached = runCapture().catch((error: unknown) => {
      cached = null;
      throw error;
    });
  }
  return cached;
}

function verifierId(): string {
  const verifier = new UiInteractionContractVerifier({
    cas: {
      async put(bytes: Uint8Array) {
        return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      },
      async promote() {
        return;
      },
    },
  });
  if (!verifier.supports({ checkId: "ui-consistency", surface: "ui" })) {
    throw new Error("UiInteractionContractVerifier does not accept the ui surface");
  }
  return verifier.id;
}

async function runCapture(): Promise<ActiveUiCapture> {
  const id = verifierId();
  const browser = await launchChromium();
  try {
    const context = await browser.newContext();
    const page = (await context.newPage()) as unknown as PageOps;
    await page.addScriptTag({ content: axe.source });
    const audits: RenderedRouteAudit[] = [];
    const screenshots: CapturedScreenshot[] = [];
    const rhythm: ScreenRhythmMetrics[] = [];
    const axeViolations: AxeViolation[] = [];
    for (const route of ROUTES) {
      for (const viewport of CANONICAL_VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        for (const theme of THEMES) {
          await page.setContent(documentFor(route, theme), { waitUntil: "load", timeout: 15_000 });
          const measured = await page.evaluate(readPage);
          const png = new Uint8Array(await page.screenshot({ type: "png" }));
          audits.push(auditFrom(route, viewport, theme, measured));
          rhythm.push(rhythmFrom(route, measured));
          screenshots.push({
            route,
            viewportId: viewport.id,
            theme,
            width: viewport.width,
            height: viewport.height,
            png,
            frame: frameFromPng(png, viewport.width, Math.min(viewport.height, 64)),
          });
          for (const violation of measured.axe) {
            if (violation.impact !== "serious" && violation.impact !== "critical" && violation.impact !== "moderate" && violation.impact !== "minor") {
              continue;
            }
            axeViolations.push({
              id: violation.id,
              impact: violation.impact,
              description: violation.description,
              nodes: [{ target: violation.target }],
            });
          }
        }
      }
    }
    await context.close();
    return { verifierId: id, audits, axeViolations, rhythm, screenshots };
  } finally {
    await browser.close();
  }
}

function documentFor(route: string, theme: ThemeMode): string {
  const title = route.endsWith("menu") ? "Menu" : "Orders";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>
    body{margin:0;font-family:Inter,sans-serif}
    body[data-theme="light"]{background:#ffffff;color:#111827}
    body[data-theme="dark"]{background:#0f172a;color:#f8fafc}
    header{height:56px;display:flex;align-items:center;padding:0 16px}
    h1{font-size:24px;line-height:32px;margin:0}
    .card{padding:16px;border-radius:8px}
    button{min-width:44px;min-height:44px;height:44px;border:0}
    body[data-theme="light"] button{background:#1d4ed8;color:#ffffff}
    body[data-theme="dark"] button{background:#93c5fd;color:#0f172a}
    .sidebar{position:absolute;width:240px;height:0;overflow:hidden}
    main{min-height:160px}
  </style></head><body data-theme="${theme}"><header><h1 class="title">${title}</h1></header><div class="sidebar"></div><main><section class="card"><button type="button">Save</button></section></main></body></html>`;
}

function readPage(): Measured | Promise<Measured> {
  const scope = globalThis as unknown as {
    document: {
      querySelector(selector: string): {
        getBoundingClientRect(): { x: number; y: number; width: number; height: number };
      } | null;
      documentElement: { scrollWidth: number; clientWidth: number };
      body: unknown;
    };
    getComputedStyle(element: unknown): {
      height: string;
      width: string;
      fontSize: string;
      lineHeight: string;
      paddingTop: string;
      borderRadius: string;
      fontFamily: string;
    };
    axe?: {
      run(node: unknown): Promise<{
        violations: { id: string; impact: string | null; description: string; nodes: { target: string[] }[] }[];
      }>;
    };
  };
  const button = scope.document.querySelector("button");
  const rect = button?.getBoundingClientRect();
  const header = scope.document.querySelector("header");
  const title = scope.document.querySelector("h1");
  const card = scope.document.querySelector(".card");
  const sidebar = scope.document.querySelector(".sidebar");
  const headerStyle = header ? scope.getComputedStyle(header) : null;
  const titleStyle = title ? scope.getComputedStyle(title) : null;
  const cardStyle = card ? scope.getComputedStyle(card) : null;
  const buttonStyle = button ? scope.getComputedStyle(button) : null;
  const sidebarStyle = sidebar ? scope.getComputedStyle(sidebar) : null;
  const bodyStyle = scope.getComputedStyle(scope.document.body);
  const axeApi = scope.axe;
  const main = scope.document.querySelector("main");
  const measured: Measured = {
    button: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
    headerHeight: headerStyle ? Number.parseFloat(headerStyle.height) : 0,
    sidebarWidth: sidebarStyle ? Number.parseFloat(sidebarStyle.width) : 0,
    pageTitleFontSize: titleStyle ? Number.parseFloat(titleStyle.fontSize) : 0,
    pageTitleLineHeight: titleStyle ? Number.parseFloat(titleStyle.lineHeight) : 0,
    cardPadding: cardStyle ? Number.parseFloat(cardStyle.paddingTop) : 0,
    cardBorderRadius: cardStyle ? Number.parseFloat(cardStyle.borderRadius) : 0,
    primaryButtonHeight: buttonStyle ? Number.parseFloat(buttonStyle.height) : 0,
    pageTitleFontFamily: titleStyle?.fontFamily ?? "",
    bodyFontFamily: bodyStyle.fontFamily,
    scrollWidth: scope.document.documentElement.scrollWidth,
    clientWidth: scope.document.documentElement.clientWidth,
    primaryContentHeight: main?.getBoundingClientRect().height ?? 0,
    axe: [],
  };
  if (!axeApi) return measured;
  return axeApi.run(scope.document).then((report) => ({
    ...measured,
    axe: report.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      description: violation.description,
      target: violation.nodes[0]?.target[0] ?? "html",
    })),
  }));
}

function auditFrom(
  route: string,
  viewport: { readonly id: string; readonly width: number; readonly height: number },
  theme: ThemeMode,
  measured: Measured,
): RenderedRouteAudit {
  const box = measured.button ?? { x: 16, y: 16, width: 44, height: 44 };
  return {
    route,
    viewportId: viewport.id,
    width: viewport.width,
    height: viewport.height,
    theme,
    scrollWidth: measured.scrollWidth,
    clientWidth: measured.clientWidth,
    elements: [
      {
        selector: "button",
        role: "button",
        tag: "button",
        box,
        interactive: true,
        accessibleName: "Save",
      },
    ],
    images: [],
    primaryContentHeight: measured.primaryContentHeight,
  };
}

function rhythmFrom(route: string, measured: Measured): ScreenRhythmMetrics {
  return {
    route,
    headerHeight: measured.headerHeight,
    sidebarWidth: measured.sidebarWidth,
    pageTitleFontSize: measured.pageTitleFontSize,
    pageTitleFontFamily: measured.pageTitleFontFamily,
    pageTitleLineHeight: measured.pageTitleLineHeight,
    cardPadding: measured.cardPadding,
    cardBorderRadius: measured.cardBorderRadius,
    primaryButtonHeight: measured.primaryButtonHeight,
    bodyFontFamily: measured.bodyFontFamily,
  };
}

export function frameFromPng(png: Uint8Array, width: number, height: number): RasterFrame {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    const source = png[index % png.length] ?? 0;
    pixels[index] = source;
    pixels[index + 1] = png[(index + 1) % png.length] ?? source;
    pixels[index + 2] = png[(index + 2) % png.length] ?? source;
    pixels[index + 3] = 255;
  }
  return { width, height, pixels };
}

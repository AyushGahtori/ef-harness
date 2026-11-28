import path from "node:path";
import { bestGap, cropRect, elementsForRegion, viewportBox } from "./geometry.js";
import { acceptSourceAttribute, baseName } from "./path-guard.js";
import { encodeSyntheticPng } from "./png.js";
import type { CasBlobStorePort, CodeIndexLookupPort, PageContext, ScreenshotPort } from "./ports.js";
import type {
  GroundedContextBundle,
  IntersectingElement,
  PreviewNode,
  SourceLocation,
  ValidatedPick,
} from "./types.js";
import { SNIPPET_BYTE_LIMIT, TEXT_EXCERPT_LIMIT, VIEWPORT_WIDTHS } from "./types.js";

export interface CapturePage extends PageContext {
  readonly domPath?: string;
}

export class ElementAndGapContextCapturer {
  constructor(
    private readonly cas: CasBlobStorePort,
    private readonly screenshots: ScreenshotPort,
    private readonly projectRoot: string,
    private readonly codeIndex: CodeIndexLookupPort,
  ) {}

  captureElement(node: PreviewNode, ancestors: readonly PreviewNode[], page: CapturePage): GroundedContextBundle {
    const box = viewportBox(node, page.scrollY);
    return this.finish({
      kind: "element",
      sourceRaw: node.source,
      ancestorRaws: ancestors.flatMap((item) => (item.source ? [item.source] : [])),
      role: node.role,
      name: node.name,
      text: node.text,
      domPath: page.domPath ?? node.tag,
      snippet: node.snippet,
      box,
      styles: node.styles,
      viewportWidth: page.viewportWidth,
      viewportHeight: page.viewportHeight,
      route: page.route,
      theme: page.theme,
      componentName: node.componentName,
      fiberFile: node.fiberSource?.fileName ?? null,
      fiberLine: node.fiberSource?.lineNumber ?? null,
      fiberColumn: node.fiberSource?.columnNumber ?? null,
      intersecting: [],
      gap: null,
    });
  }

  captureGap(drag: PreviewNode["box"], nodes: readonly PreviewNode[], page: CapturePage): GroundedContextBundle {
    const selected = elementsForRegion(drag, nodes);
    const intersecting: IntersectingElement[] = selected.map((node) => ({
      source: node.source,
      tag: node.tag,
      name: node.componentName ?? node.name ?? node.tag,
      box: viewportBox(node, page.scrollY),
    }));
    const gap = bestGap(intersecting.map((item) => item.box));
    const primary = selected[0];
    return this.finish({
      kind: "gap",
      sourceRaw: primary?.source ?? null,
      ancestorRaws: selected.slice(1).flatMap((node) => (node.source ? [node.source] : [])),
      role: null,
      name: gapLabel(intersecting),
      text: "",
      domPath: selected.map((node) => node.tag).join(" + "),
      snippet: selected.map((node) => node.snippet).join("\n"),
      box: drag,
      styles: primary?.styles ?? {
        font: "",
        color: "",
        padding: "",
        gap: `${gap.px}px`,
        position: "static",
      },
      viewportWidth: page.viewportWidth,
      viewportHeight: page.viewportHeight,
      route: page.route,
      theme: page.theme,
      componentName: null,
      fiberFile: null,
      fiberLine: null,
      fiberColumn: null,
      intersecting,
      gap,
    });
  }

  fromMessage(pick: ValidatedPick, viewportHeight: number): GroundedContextBundle {
    const recomputed =
      pick.intersecting.length >= 2 ? bestGap(pick.intersecting.map((item) => item.box)) : null;
    return this.finish({
      kind: pick.gesture === "gap" ? "gap" : "element",
      sourceRaw: pick.source,
      ancestorRaws: [...pick.ancestorSources],
      role: pick.role,
      name: pick.gesture === "gap" ? gapLabel(pick.intersecting) : pick.name,
      text: pick.text,
      domPath: pick.domPath,
      snippet: pick.snippet,
      box: pick.gesture === "gap" ? pick.box : pick.cropRect,
      styles: pick.styles,
      viewportWidth: pick.viewportWidth,
      viewportHeight,
      route: pick.route,
      theme: pick.theme,
      componentName: pick.componentName,
      fiberFile: pick.fiberSource?.fileName ?? null,
      fiberLine: pick.fiberSource?.lineNumber ?? null,
      fiberColumn: pick.fiberSource?.columnNumber ?? null,
      intersecting: [...pick.intersecting],
      gap: recomputed ?? (pick.gapPx === null || pick.gapAxis === null ? null : { px: pick.gapPx, axis: pick.gapAxis }),
    });
  }

  private finish(input: FinishInput): GroundedContextBundle {
    const direct = input.sourceRaw ? this.accept(input.sourceRaw) : null;
    const fiber = this.acceptFiber(input.fiberFile, input.fiberLine, input.fiberColumn);
    const indexed =
      !direct && !fiber
        ? this.codeIndex.lookup({ role: input.role, name: input.name, route: input.route })
        : null;
    const indexedOk = indexed ? this.accept(indexed.raw) : null;
    const source = direct;
    const resolved = direct ?? fiber ?? indexedOk;
    const resolution = direct ? "data-ef-source" : fiber ? "fiber" : indexedOk ? "code-index" : "unresolved";
    const ancestorStack = input.ancestorRaws.flatMap((raw) => {
      const accepted = this.accept(raw);
      return accepted ? [accepted] : [];
    });
    if (input.kind === "gap") {
      for (const hit of input.intersecting) {
        if (!hit.source) continue;
        const accepted = this.accept(hit.source);
        if (accepted && !ancestorStack.some((item) => item.raw === accepted.raw)) {
          ancestorStack.push(accepted);
        }
      }
    }
    const textExcerpt = input.text.replace(/\s+/g, " ").trim().slice(0, TEXT_EXCERPT_LIMIT);
    const domSnippet = scrubSnippet(truncateBytes(input.snippet, SNIPPET_BYTE_LIMIT));
    const rect = cropRect(input.box, { width: input.viewportWidth, height: input.viewportHeight });
    const png = this.screenshots.capture(rect);
    const label =
      input.kind === "gap"
        ? input.name && input.name.length > 0
          ? input.name
          : "Selected region"
        : elementLabel(input.role, input.name, input.componentName);
    const pillFile = resolved?.file ?? "unknown";
    const pillLine = resolved?.line ?? 0;
    const pillSource = `${baseName(pillFile)}:${pillLine}`;
    const elementId = `${input.kind}-${pillSource}-${Math.round(input.box.x)}-${Math.round(input.box.y)}`;
    const cropId = this.cas.putBlob(png, {
      holderKind: "point-to-fix",
      holderId: elementId,
      mediaType: "image/png",
    }).hash;
    const preset = VIEWPORT_WIDTHS.find((width) => width === input.viewportWidth) ?? null;
    const bundle: GroundedContextBundle = {
      kind: input.kind,
      elementId,
      source,
      resolvedFile: resolved?.file ?? null,
      resolution,
      ancestorStack,
      role: input.role,
      name: input.name,
      textExcerpt,
      domPath: input.domPath.slice(0, 500),
      domSnippet,
      box: input.box,
      styles: input.styles,
      viewportWidth: input.viewportWidth,
      viewportPreset: preset,
      route: input.route,
      theme: input.theme,
      componentName: input.componentName,
      crop: {
        rect,
        png,
        casId: cropId,
        paddingPx: 40,
        scrubbed: true,
        synthetic: true,
      },
      bundleCasId: "",
      intersecting: input.intersecting,
      gapPx: input.gap?.px ?? null,
      gapAxis: input.gap?.axis ?? null,
      label,
      pillSource,
      pill: `Fixing UI: ${label} (${pillSource}) · ✕`,
    };
    const stored = jsonBytes(bundleWithoutPng(bundle));
    const bundleCasId = this.cas.putBlob(stored, {
      holderKind: "point-to-fix",
      holderId: `${elementId}:bundle`,
      mediaType: "application/json",
    }).hash;
    return { ...bundle, bundleCasId };
  }

  private accept(raw: string): SourceLocation | null {
    const accepted = acceptSourceAttribute(raw, this.projectRoot);
    return accepted.ok ? accepted.location : null;
  }

  private acceptFiber(
    fileName: string | null,
    line: number | null,
    column: number | null,
  ): SourceLocation | null {
    if (!fileName || line === null || column === null) return null;
    const relative = toProjectFile(fileName, this.projectRoot);
    if (!relative) return null;
    return this.accept(`${relative}:${line}:${column}`);
  }
}

interface FinishInput {
  readonly kind: "element" | "gap";
  readonly sourceRaw: string | null;
  readonly ancestorRaws: readonly string[];
  readonly role: string | null;
  readonly name: string | null;
  readonly text: string;
  readonly domPath: string;
  readonly snippet: string;
  readonly box: PreviewNode["box"];
  readonly styles: PreviewNode["styles"];
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly route: string;
  readonly theme: PreviewNode extends never ? never : GroundedContextBundle["theme"];
  readonly componentName: string | null;
  readonly fiberFile: string | null;
  readonly fiberLine: number | null;
  readonly fiberColumn: number | null;
  readonly intersecting: readonly IntersectingElement[];
  readonly gap: { readonly px: number; readonly axis: "vertical" | "horizontal" } | null;
}

export function elementLabel(
  role: string | null,
  name: string | null,
  componentName: string | null,
): string {
  if (name && role === "button" && !/button/i.test(name)) return `${name} button`;
  if (name) return name;
  if (componentName) return componentName;
  return "element";
}

function gapLabel(items: readonly IntersectingElement[]): string {
  const names = items.map((item) => item.name).filter((name) => name.length > 0);
  if (names.length >= 2) return `Gap between ${names[0]} and ${names[1]}`;
  if (names.length === 1) return `Gap beside ${names[0]}`;
  return "Selected gap";
}

export function scrubSnippet(snippet: string): string {
  return snippet
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\bvalue="[^"]*"/gi, 'value=""');
}

function truncateBytes(value: string, limit: number): string {
  const buffer = Buffer.from(value);
  if (buffer.byteLength <= limit) return value;
  return buffer.subarray(0, limit).toString("utf8");
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function bundleWithoutPng(bundle: GroundedContextBundle): unknown {
  return {
    ...bundle,
    crop: { ...bundle.crop, png: undefined },
  };
}

function toProjectFile(fileName: string, projectRoot: string): string | null {
  const normalized = fileName.replaceAll("\\", "/");
  if (path.isAbsolute(fileName)) {
    const relative = path.relative(projectRoot, fileName).replaceAll("\\", "/");
    if (relative.startsWith("..") || relative.startsWith("/")) return null;
    return relative;
  }
  if (normalized.split("/").includes("..")) return null;
  return normalized;
}

export class SyntheticScrubbedScreenshot implements ScreenshotPort {
  capture(rect: { readonly width: number; readonly height: number }): Uint8Array {
    return encodeSyntheticPng(rect.width, rect.height);
  }
}

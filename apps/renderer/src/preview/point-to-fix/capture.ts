import { parseEfSourceAttribute } from "./source-path.js";
import type {
  ElementPickContext,
  GapPickContext,
  LayoutBox,
  PreviewTheme,
  PreviewViewportWidth,
} from "./types.js";

export interface DomLikeElement {
  readonly tagName: string;
  readonly efSource: string | null;
  readonly role: string | null;
  readonly accessibleName: string;
  readonly textContent: string;
  readonly domPath: string;
  readonly layoutBox: LayoutBox;
  readonly styles: Readonly<Record<string, string>>;
  readonly ancestorEfSources?: readonly string[];
  readonly reactDebugSource?: string | null;
}

export interface CaptureEnvironment {
  readonly viewportWidth: PreviewViewportWidth;
  readonly route: string;
  readonly theme: PreviewTheme;
  readonly casPut: (bytes: Uint8Array, mime: string) => string;
}

const PAD_PX = 40;
const TEXT_LIMIT = 200;
const DOM_SNIPPET_LIMIT = 2048;

function padBox(box: LayoutBox): LayoutBox {
  return {
    x: Math.max(0, box.x - PAD_PX),
    y: Math.max(0, box.y - PAD_PX),
    width: box.width + PAD_PX * 2,
    height: box.height + PAD_PX * 2,
  };
}

function syntheticCropRef(env: CaptureEnvironment, label: string): string {
  const payload = new TextEncoder().encode(
    `synthetic-crop:${label}:${env.viewportWidth}:${env.theme}`,
  );
  return env.casPut(payload, "image/png");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function captureElementContext(
  element: DomLikeElement,
  env: CaptureEnvironment,
): ElementPickContext {
  const efSource =
    parseEfSourceAttribute(element.efSource) ??
    parseEfSourceAttribute(element.reactDebugSource ?? null);
  const ancestors = (element.ancestorEfSources ?? [])
    .map((v) => parseEfSourceAttribute(v))
    .filter((v): v is NonNullable<typeof v> => v !== null);

  const snippet = `<${element.tagName.toLowerCase()} …>`;
  return {
    kind: "element",
    efSource,
    ancestorSources: ancestors,
    role: element.role,
    accessibleName: element.accessibleName,
    textExcerpt: truncate(element.textContent.trim(), TEXT_LIMIT),
    domPath: element.domPath,
    domSnippet: truncate(snippet, DOM_SNIPPET_LIMIT),
    layoutBox: element.layoutBox,
    styles: element.styles,
    viewportWidth: env.viewportWidth,
    route: env.route,
    theme: env.theme,
    cropPngRef: syntheticCropRef(env, element.domPath),
  };
}

function boxesIntersect(a: LayoutBox, b: LayoutBox): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

function verticalGapBetween(top: LayoutBox, bottom: LayoutBox): number {
  return Math.max(0, bottom.y - (top.y + top.height));
}

function regionWithGapSlack(region: LayoutBox, slackPx = 6): LayoutBox {
  return {
    x: region.x,
    y: Math.max(0, region.y - slackPx),
    width: region.width,
    height: region.height + slackPx * 2,
  };
}

export function captureGapRegion(
  region: LayoutBox,
  candidates: readonly DomLikeElement[],
  env: CaptureEnvironment,
): GapPickContext {
  const selection = regionWithGapSlack(region);
  const intersecting = candidates
    .filter((el) => boxesIntersect(selection, el.layoutBox))
    .map((el) => captureElementContext(el, env))
    .sort((a, b) => a.layoutBox.y - b.layoutBox.y);

  let gapPx = 0;
  if (intersecting.length >= 2) {
    gapPx = verticalGapBetween(intersecting[0]!.layoutBox, intersecting[1]!.layoutBox);
  }

  return {
    kind: "gap",
    regionBox: padBox(region),
    cropPngRef: syntheticCropRef(env, `gap:${region.x},${region.y}`),
    intersectingElements: intersecting,
    gapPx,
    viewportWidth: env.viewportWidth,
    route: env.route,
    theme: env.theme,
  };
}
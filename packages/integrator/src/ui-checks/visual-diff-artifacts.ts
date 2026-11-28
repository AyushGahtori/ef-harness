import type { CasStorePort } from "./ports.js";
import type { RasterFrame, SourceLocation, UiConsistencyFinding } from "./types.js";

function rgbaAt(frame: RasterFrame, x: number, y: number): [number, number, number, number] {
  const offset = (y * frame.width + x) * 4;
  return [
    frame.pixels[offset] ?? 0,
    frame.pixels[offset + 1] ?? 0,
    frame.pixels[offset + 2] ?? 0,
    frame.pixels[offset + 3] ?? 255,
  ];
}

function isMasked(frame: RasterFrame, x: number, y: number, masked: Set<string>): boolean {
  if (masked.size === 0) return false;
  const key = `${x},${y}`;
  return masked.has(key);
}

export function buildMaskedPixelSet(frame: RasterFrame, maskedSelectors: readonly string[] | undefined): Set<string> {
  const masked = new Set<string>();
  if (!maskedSelectors?.length) return masked;
  for (const region of frame.maskedSelectors ?? []) {
    if (!maskedSelectors.includes(region)) continue;
    const parts = region.split(":").map(Number);
    const x = parts[0];
    const y = parts[1];
    const w = parts[2];
    const h = parts[3];
    if (x === undefined || y === undefined || w === undefined || h === undefined) continue;
    if ([x, y, w, h].some((v) => Number.isNaN(v))) continue;
    for (let py = y; py < y + h; py += 1) {
      for (let px = x; px < x + w; px += 1) {
        masked.add(`${px},${py}`);
      }
    }
  }
  return masked;
}

export function compareRasterFrames(
  expected: RasterFrame,
  actual: RasterFrame,
  options: { readonly maxDiffPixelRatio: number; readonly threshold: number; readonly masked?: Set<string> },
): { readonly diffRatio: number; readonly diff: RasterFrame } {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    const empty = new Uint8ClampedArray(expected.width * expected.height * 4);
    return {
      diffRatio: 1,
      diff: { width: expected.width, height: expected.height, pixels: empty },
    };
  }
  const diffPixels = new Uint8ClampedArray(expected.width * expected.height * 4);
  let compared = 0;
  let different = 0;
  for (let y = 0; y < expected.height; y += 1) {
    for (let x = 0; x < expected.width; x += 1) {
      if (options.masked && isMasked(expected, x, y, options.masked)) continue;
      compared += 1;
      const [er, eg, eb] = rgbaAt(expected, x, y);
      const [ar, ag, ab] = rgbaAt(actual, x, y);
      const delta =
        (Math.abs(er - ar) + Math.abs(eg - ag) + Math.abs(eb - ab)) / (255 * 3);
      const offset = (y * expected.width + x) * 4;
      if (delta > options.threshold) {
        different += 1;
        diffPixels[offset] = 255;
        diffPixels[offset + 1] = 0;
        diffPixels[offset + 2] = 128;
        diffPixels[offset + 3] = 255;
      } else {
        diffPixels[offset] = er;
        diffPixels[offset + 1] = eg;
        diffPixels[offset + 2] = eb;
        diffPixels[offset + 3] = 120;
      }
    }
  }
  const ratio = compared === 0 ? 0 : different / compared;
  return {
    diffRatio: ratio,
    diff: { width: expected.width, height: expected.height, pixels: diffPixels },
  };
}

export function packageVisualDiffArtifacts(input: {
  readonly route: string;
  readonly selector?: string;
  readonly source?: SourceLocation;
  readonly expected: RasterFrame;
  readonly actual: RasterFrame;
  readonly diff: RasterFrame;
  readonly cas: CasStorePort;
}): { readonly expectedId: string; readonly actualId: string; readonly diffId: string } {
  const expectedId = input.cas.put({
    id: "",
    kind: "expected",
    route: input.route,
    frame: input.expected,
    ...(input.selector ? { selector: input.selector } : {}),
    ...(input.source ? { source: input.source } : {}),
  });
  const actualId = input.cas.put({
    id: "",
    kind: "actual",
    route: input.route,
    frame: input.actual,
    ...(input.selector ? { selector: input.selector } : {}),
    ...(input.source ? { source: input.source } : {}),
  });
  const diffId = input.cas.put({
    id: "",
    kind: "diff",
    route: input.route,
    frame: input.diff,
    ...(input.selector ? { selector: input.selector } : {}),
    ...(input.source ? { source: input.source } : {}),
  });
  return { expectedId, actualId, diffId };
}

export function findingFromVisualDiff(input: {
  readonly route: string;
  readonly selector?: string;
  readonly source?: SourceLocation;
  readonly artifactIds: { readonly expectedId: string; readonly actualId: string; readonly diffId: string };
  readonly diffRatio: number;
}): UiConsistencyFinding {
  return {
    stage: "screenshot_regression",
    rule: "toHaveScreenshot",
    severity: "error",
    message: `layout drift on ${input.route}${input.selector ? ` (${input.selector})` : ""}: diff ratio ${input.diffRatio.toFixed(4)}`,
  ...(input.source
    ? {
        location: {
          ...input.source,
          dataEfSource: input.source.dataEfSource ?? `${input.source.file}:${input.source.line}`,
        },
      }
    : {}),
    casArtifactId: input.artifactIds.diffId,
  };
}
import { TEXT_CONTRAST_FLOOR, UI_CONTRAST_FLOOR } from "./types.js";

const PUBLISHED_TEXT_STRONG: Readonly<Record<string, string>> = {
  "#FACC15": "#854D0E",
  "#FF7A45": "#B23C0C",
};

const INK = "#0F172A";
const PAPER = "#FFFFFF";

export function normalizeHex(input: string): string {
  const raw = input.trim();
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(raw);
  if (!match) {
    throw new Error(`invalid hex color ${input}`);
  }
  const body = match[1] ?? "";
  const expanded = body.length === 3 ? [...body].map((channel) => channel + channel).join("") : body;
  return `#${expanded.toUpperCase()}`;
}

function channel(value: number): number {
  const unit = value / 255;
  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const normalized = normalizeHex(hex);
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const left = relativeLuminance(foreground);
  const right = relativeLuminance(background);
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

export function formatRatio(value: number): string {
  return value.toFixed(2);
}

function rgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHex(hex);
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function fromRgb(r: number, g: number, b: number): string {
  const byte = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`.toUpperCase();
}

function mix(from: string, toward: string, amount: number): string {
  const left = rgb(from);
  const right = rgb(toward);
  return fromRgb(
    left.r + (right.r - left.r) * amount,
    left.g + (right.g - left.g) * amount,
    left.b + (right.b - left.b) * amount,
  );
}

function passesOn(hex: string, backgrounds: readonly string[], floor: number): boolean {
  return backgrounds.every((background) => contrastRatio(hex, background) >= floor);
}

function mixUntil(fill: string, toward: string, backgrounds: readonly string[], floor: number): string {
  for (let step = 0; step <= 1000; step += 1) {
    const candidate = mix(fill, toward, step / 1000);
    if (passesOn(candidate, backgrounds, floor)) return candidate;
  }
  return toward;
}

export interface ResolvedPairing {
  readonly fill: string;
  readonly foreground: string;
  readonly textStrong: string;
  readonly whiteOnFill: number;
  readonly foregroundOnFill: number;
  readonly textStrongOnSurface: number;
  readonly publishedTextStrong: boolean;
}

/**
 * Keep the caller's brand fill. Choose an on-fill label and a small-text sibling
 * that each clear WCAG AA. Bright yellow and orange use the published siblings
 * when those siblings actually clear the floor on the supplied surfaces.
 */
export function resolveAccessiblePairing(fill: string, surfaces: readonly string[]): ResolvedPairing {
  const normalized = normalizeHex(fill);
  const whiteOnFill = contrastRatio(PAPER, normalized);
  const inkOnFill = contrastRatio(INK, normalized);
  let foreground = PAPER;
  if (whiteOnFill < TEXT_CONTRAST_FLOOR) {
    foreground = inkOnFill >= TEXT_CONTRAST_FLOOR ? INK : mixUntil(normalized, INK, [normalized], TEXT_CONTRAST_FLOOR);
  }
  const published = PUBLISHED_TEXT_STRONG[normalized];
  let textStrong = normalized;
  let publishedTextStrong = false;
  if (!passesOn(normalized, surfaces, TEXT_CONTRAST_FLOOR)) {
    if (published && passesOn(published, surfaces, TEXT_CONTRAST_FLOOR)) {
      textStrong = published;
      publishedTextStrong = true;
    } else {
      const toward = relativeLuminance(surfaces[0] ?? PAPER) > 0.5 ? INK : PAPER;
      textStrong = mixUntil(normalized, toward, surfaces, TEXT_CONTRAST_FLOOR);
    }
  }
  const textStrongOnSurface = Math.min(
    ...surfaces.map((surface) => contrastRatio(textStrong, surface)),
  );
  return {
    fill: normalized,
    foreground,
    textStrong,
    whiteOnFill,
    foregroundOnFill: contrastRatio(foreground, normalized),
    textStrongOnSurface,
    publishedTextStrong,
  };
}

export function meetsTextFloor(ratio: number): boolean {
  return ratio >= TEXT_CONTRAST_FLOOR;
}

export function meetsUiFloor(ratio: number): boolean {
  return ratio >= UI_CONTRAST_FLOOR;
}

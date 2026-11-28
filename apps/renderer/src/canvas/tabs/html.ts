import type { CanvasTheme, MatrixFillStatus } from "./types.js";

export interface ThemeTokens {
  readonly bg: string;
  readonly fg: string;
  readonly muted: string;
  readonly border: string;
  readonly selected: string;
  readonly stripBg: string;
  readonly stripFg: string;
  readonly status: Readonly<Record<MatrixFillStatus, string>>;
}

export const THEME: Readonly<Record<CanvasTheme, ThemeTokens>> = {
  light: {
    bg: "#FFFFFF",
    fg: "#1B1B1B",
    muted: "#3D3D3D",
    border: "#5C5C5C",
    selected: "#E8F0FE",
    stripBg: "#FFF6DE",
    stripFg: "#3D2A00",
    status: {
      pass1: "#003A8C",
      pass2: "#0D5C3D",
      pass3: "#5C2D91",
      proposed: "#7A4E00",
      conflict: "#8E1B1B",
      na: "#333333",
    },
  },
  dark: {
    bg: "#121212",
    fg: "#F4F4F4",
    muted: "#D6D6D6",
    border: "#C8C8C8",
    selected: "#1E2A3A",
    stripBg: "#3A2E12",
    stripFg: "#FFE7B0",
    status: {
      pass1: "#9CC4FF",
      pass2: "#8EEDC7",
      pass3: "#E0C4FF",
      proposed: "#FFD27A",
      conflict: "#FFB4B4",
      na: "#E0E0E0",
    },
  },
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function channel(hexByte: string): number {
  const raw = Number.parseInt(hexByte, 16) / 255;
  if (raw <= 0.04045) return raw / 12.92;
  return ((raw + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(foreground: string, background: string): number {
  const lum = (hex: string): number => {
    const normalized = hex.replace("#", "");
    const r = channel(normalized.slice(0, 2));
    const g = channel(normalized.slice(2, 4));
    const b = channel(normalized.slice(4, 6));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const lighter = Math.max(lum(foreground), lum(background));
  const darker = Math.min(lum(foreground), lum(background));
  return (lighter + 0.05) / (darker + 0.05);
}

export interface ContrastPair {
  readonly label: string;
  readonly fg: string;
  readonly bg: string;
}

export function contrastPairs(theme: CanvasTheme): readonly ContrastPair[] {
  const tokens = THEME[theme];
  const pairs: ContrastPair[] = [
    { label: "body", fg: tokens.fg, bg: tokens.bg },
    { label: "muted", fg: tokens.muted, bg: tokens.bg },
    { label: "strip", fg: tokens.stripFg, bg: tokens.stripBg },
    { label: "selected", fg: tokens.fg, bg: tokens.selected },
  ];
  for (const [status, fg] of Object.entries(tokens.status)) {
    pairs.push({ label: status, fg, bg: tokens.bg });
  }
  return pairs;
}

export function styleBlock(): string {
  return `<style>
    .tabs-root { font-family: "Segoe UI", sans-serif; line-height: 1.45; }
    .tabs-root table, .tabs-root .num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }
    .tabs-root :focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
    .tabs-root button, .tabs-root a { font: inherit; }
    .chip { display: inline-block; border: 1px solid currentColor; border-radius: 999px; padding: 0 0.4rem; margin-right: 0.25rem; }
    .tier-chip { display: inline-block; border: 1px solid currentColor; padding: 0 0.35rem; }
  </style>`;
}

export function rootOpen(theme: CanvasTheme, label: string, extra = ""): string {
  const tokens = THEME[theme];
  return `<section class="tabs-root" data-theme="${theme}" data-source="state.db" aria-label="${escapeHtml(label)}" style="background:${tokens.bg};color:${tokens.fg};border:1px solid ${tokens.border}" ${extra}>${styleBlock()}`;
}

export function attrs(values: Readonly<Record<string, string | number | boolean | undefined>>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === false) continue;
    if (value === true) {
      parts.push(key);
      continue;
    }
    parts.push(`${key}="${escapeHtml(String(value))}"`);
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

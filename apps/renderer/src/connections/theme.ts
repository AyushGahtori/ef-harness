import { contrastRatio } from "./contrast.js";

export interface ThemeTokens {
  readonly name: "light" | "dark";
  readonly canvas: string;
  readonly text: string;
  readonly muted: string;
  readonly surface: string;
  readonly surfaceText: string;
  readonly accent: string;
  readonly accentText: string;
  readonly warning: string;
  readonly warningText: string;
  readonly focusRing: string;
  readonly border: string;
}

export const LIGHT_THEME: ThemeTokens = {
  name: "light",
  canvas: "#FFFFFF",
  text: "#1A1A1A",
  muted: "#3F3F3F",
  surface: "#F7F5F1",
  surfaceText: "#1A1A1A",
  accent: "#0F5C3A",
  accentText: "#FFFFFF",
  warning: "#8E1B1B",
  warningText: "#FFFFFF",
  focusRing: "#0B4F8A",
  border: "#4B5563",
};

export const DARK_THEME: ThemeTokens = {
  name: "dark",
  canvas: "#121417",
  text: "#F4F4F5",
  muted: "#D4D4D8",
  surface: "#1C2128",
  surfaceText: "#F4F4F5",
  accent: "#6EE7B7",
  accentText: "#052E1A",
  warning: "#F87171",
  warningText: "#2A0A0A",
  focusRing: "#93C5FD",
  border: "#D4D4D8",
};

const PAIRS: readonly (readonly [keyof ThemeTokens, keyof ThemeTokens])[] = [
  ["text", "canvas"],
  ["muted", "canvas"],
  ["surfaceText", "surface"],
  ["accentText", "accent"],
  ["warningText", "warning"],
  ["text", "surface"],
];

export function themeFor(name: "light" | "dark"): ThemeTokens {
  return name === "dark" ? DARK_THEME : LIGHT_THEME;
}

export function themeContrastFailures(tokens: ThemeTokens): readonly string[] {
  const failures: string[] = [];
  for (const [fgKey, bgKey] of PAIRS) {
    const fg = tokens[fgKey];
    const bg = tokens[bgKey];
    if (typeof fg !== "string" || typeof bg !== "string") continue;
    if (contrastRatio(fg, bg) < 4.5) {
      failures.push(`${tokens.name}:${fgKey}-on-${bgKey}`);
    }
  }
  return failures;
}

export function layoutForWidth(width: number): "stacked" | "split" {
  return width < 800 ? "stacked" : "split";
}

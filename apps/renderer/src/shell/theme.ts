import { contrastRatio } from "./contrast.js";
import type { PressureLevel, ResolvedThemeName, ThemePreference, ThemeTokens } from "./types.js";

export const LIGHT_THEME: ThemeTokens = {
  name: "light",
  canvas: "#FFFFFF",
  text: "#1A1A1A",
  muted: "#3F3F3F",
  topBar: "#F3F1EC",
  topBarText: "#1A1A1A",
  stopBg: "#8E1B1B",
  stopFg: "#FFFFFF",
  pauseBg: "#1F3A5F",
  pauseFg: "#FFFFFF",
  resumeBg: "#0F5C3A",
  resumeFg: "#FFFFFF",
  greenBg: "#0E6B32",
  greenFg: "#FFFFFF",
  yellowBg: "#FFE08A",
  yellowFg: "#1A1A1A",
  orangeBg: "#9A3412",
  orangeFg: "#FFFFFF",
  redBg: "#9F1239",
  redFg: "#FFFFFF",
  focusRing: "#0B4F8A",
  border: "#4B5563",
  composerBg: "#FFFFFF",
  composerText: "#1A1A1A",
  railBg: "#F7F5F1",
  inspectorBg: "#F7F5F1",
};

export const DARK_THEME: ThemeTokens = {
  name: "dark",
  canvas: "#121417",
  text: "#F4F4F5",
  muted: "#D4D4D8",
  topBar: "#1C2128",
  topBarText: "#F4F4F5",
  stopBg: "#F87171",
  stopFg: "#2A0A0A",
  pauseBg: "#93C5FD",
  pauseFg: "#0B1B33",
  resumeBg: "#6EE7B7",
  resumeFg: "#052E1A",
  greenBg: "#4ADE80",
  greenFg: "#052E16",
  yellowBg: "#FACC15",
  yellowFg: "#1A1A1A",
  orangeBg: "#FB923C",
  orangeFg: "#2A1204",
  redBg: "#FB7185",
  redFg: "#3F0414",
  focusRing: "#93C5FD",
  border: "#D4D4D8",
  composerBg: "#1C2128",
  composerText: "#F4F4F5",
  railBg: "#181C22",
  inspectorBg: "#181C22",
};

const TEXT_PAIRS: readonly (readonly [keyof ThemeTokens, keyof ThemeTokens])[] = [
  ["text", "canvas"],
  ["muted", "canvas"],
  ["topBarText", "topBar"],
  ["stopFg", "stopBg"],
  ["pauseFg", "pauseBg"],
  ["resumeFg", "resumeBg"],
  ["greenFg", "greenBg"],
  ["yellowFg", "yellowBg"],
  ["orangeFg", "orangeBg"],
  ["redFg", "redBg"],
  ["composerText", "composerBg"],
  ["text", "railBg"],
  ["text", "inspectorBg"],
];

export function themeContrastFailures(tokens: ThemeTokens): readonly string[] {
  const failures: string[] = [];
  for (const [fgKey, bgKey] of TEXT_PAIRS) {
    const fg = tokens[fgKey];
    const bg = tokens[bgKey];
    if (typeof fg !== "string" || typeof bg !== "string") continue;
    const ratio = contrastRatio(fg, bg);
    if (ratio < 4.5) {
      failures.push(`${tokens.name} ${fgKey} on ${bgKey} is ${ratio.toFixed(2)}`);
    }
  }
  const ring = contrastRatio(tokens.focusRing, tokens.canvas);
  if (ring < 3) {
    failures.push(`${tokens.name} focus ring on canvas is ${ring.toFixed(2)}`);
  }
  return failures;
}

export function resolveTheme(
  preference: ThemePreference,
  system: ResolvedThemeName,
): ThemeTokens {
  const name = preference === "system" ? system : preference;
  return name === "dark" ? DARK_THEME : LIGHT_THEME;
}

export function governorColors(level: PressureLevel, tokens: ThemeTokens): { fg: string; bg: string } {
  if (level === "GREEN") return { fg: tokens.greenFg, bg: tokens.greenBg };
  if (level === "YELLOW") return { fg: tokens.yellowFg, bg: tokens.yellowBg };
  if (level === "ORANGE") return { fg: tokens.orangeFg, bg: tokens.orangeBg };
  return { fg: tokens.redFg, bg: tokens.redBg };
}

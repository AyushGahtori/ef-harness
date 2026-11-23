import type { OfficePalette, OfficeThemeMode } from "./types.js";

const LIGHT: OfficePalette = {
  ambient: 0xfff5e8,
  lampGlow: 0xffe0b0,
  floorTint: 0xe8d4b8,
};

const DARK: OfficePalette = {
  ambient: 0x2a241c,
  lampGlow: 0x5c4a32,
  floorTint: 0x3d3428,
};

export function paletteForTheme(mode: OfficeThemeMode): OfficePalette {
  return mode === "dark" ? DARK : LIGHT;
}
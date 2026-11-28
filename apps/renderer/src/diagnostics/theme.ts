export type DiagnosticsTheme = "light" | "dark";

export interface ThemePalette {
  readonly background: string;
  readonly text: string;
  readonly accent: string;
  readonly stroke: string;
  readonly line: string;
}

export function palette(theme: DiagnosticsTheme): ThemePalette {
  if (theme === "dark") {
    return {
      background: "#121418",
      text: "#f2f4f8",
      accent: "#d6e6ff",
      stroke: "#9ecbff",
      line: "#8b97a8",
    };
  }
  return {
    background: "#ffffff",
    text: "#1b1f24",
    accent: "#0b4f8a",
    stroke: "#0b4f8a",
    line: "#5c6773",
  };
}

export function paint(theme: DiagnosticsTheme, extra = ""): string {
  const colors = palette(theme);
  return `background-color:${colors.background};color:${colors.text};${extra}`;
}

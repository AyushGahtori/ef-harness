import type { BoardThemeName } from "./types.js";

export interface ThemeColorPair {
  readonly name: string;
  readonly foreground: string;
  readonly background: string;
}

export interface BoardTheme {
  readonly name: BoardThemeName;
  readonly page: string;
  readonly surface: string;
  readonly text: string;
  readonly muted: string;
  readonly buttonBg: string;
  readonly buttonText: string;
  readonly border: string;
  readonly focus: string;
  readonly heldBg: string;
  readonly heldText: string;
  readonly thinkingBg: string;
  readonly thinkingText: string;
  readonly waitingBg: string;
  readonly waitingText: string;
  readonly runningBg: string;
  readonly runningText: string;
  readonly highlight: string;
}

export const BOARD_THEMES: Readonly<Record<BoardThemeName, BoardTheme>> = {
  light: {
    name: "light",
    page: "#f8fafc",
    surface: "#ffffff",
    text: "#0f172a",
    muted: "#1e293b",
    buttonBg: "#e2e8f0",
    buttonText: "#0f172a",
    border: "#cbd5e1",
    focus: "#1d4ed8",
    heldBg: "#fee2e2",
    heldText: "#450a0a",
    thinkingBg: "#e0e7ff",
    thinkingText: "#1e1b4b",
    waitingBg: "#fef3c7",
    waitingText: "#451a03",
    runningBg: "#dcfce7",
    runningText: "#052e16",
    highlight: "#dbeafe",
  },
  dark: {
    name: "dark",
    page: "#0b1220",
    surface: "#111827",
    text: "#f8fafc",
    muted: "#e2e8f0",
    buttonBg: "#334155",
    buttonText: "#f8fafc",
    border: "#334155",
    focus: "#93c5fd",
    heldBg: "#7f1d1d",
    heldText: "#fee2e2",
    thinkingBg: "#312e81",
    thinkingText: "#e0e7ff",
    waitingBg: "#78350f",
    waitingText: "#fef3c7",
    runningBg: "#14532d",
    runningText: "#dcfce7",
    highlight: "#1e3a8a",
  },
};

function channel(hex: string, start: number): number {
  const raw = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
  if (raw <= 0.04045) return raw / 12.92;
  return ((raw + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) =>
    0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
  const left = luminance(foreground);
  const right = luminance(background);
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

export function themeContrastPairs(theme: BoardTheme): readonly ThemeColorPair[] {
  return [
    { name: "text on page", foreground: theme.text, background: theme.page },
    { name: "muted on page", foreground: theme.muted, background: theme.page },
    { name: "text on surface", foreground: theme.text, background: theme.surface },
    { name: "muted on surface", foreground: theme.muted, background: theme.surface },
    { name: "button", foreground: theme.buttonText, background: theme.buttonBg },
    { name: "held", foreground: theme.heldText, background: theme.heldBg },
    { name: "thinking", foreground: theme.thinkingText, background: theme.thinkingBg },
    { name: "waiting", foreground: theme.waitingText, background: theme.waitingBg },
    { name: "running", foreground: theme.runningText, background: theme.runningBg },
    { name: "text on highlight", foreground: theme.text, background: theme.highlight },
  ];
}

export function themeStyle(theme: BoardTheme): string {
  return `
    :root { color-scheme: ${theme.name}; }
    body {
      margin: 0;
      background: ${theme.page};
      color: ${theme.text};
      font: 14px/1.4 ui-sans-serif, system-ui, sans-serif;
    }
    main { padding: 12px; }
    h1 { font-size: 18px; line-height: 24px; margin: 0 0 8px; }
    h2 { font-size: 14px; line-height: 20px; margin: 0; color: ${theme.text}; }
    p { margin: 0; }
    a { color: ${theme.text}; }
    button, input {
      font: inherit;
      color: ${theme.buttonText};
      background: ${theme.buttonBg};
      border: 1px solid ${theme.border};
      border-radius: 4px;
      min-height: 24px;
      min-width: 24px;
    }
    input { color: ${theme.text}; background: ${theme.surface}; }
    button[aria-pressed="true"] { outline: 2px solid ${theme.focus}; }
    :focus-visible { outline: 2px solid ${theme.focus}; outline-offset: 2px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; margin-bottom: 8px; }
    .capacity { margin: 8px 0; color: ${theme.text}; }
    .lanes { display: flex; align-items: flex-start; gap: 8px; }
    .lane { flex: 1 1 240px; min-width: 240px; background: ${theme.page}; }
    .lane[data-density="slim"] { flex: 0 0 96px; min-width: 96px; }
    .count { color: ${theme.muted}; }
    .viewport { position: relative; overflow: auto; }
    .lane-list { position: relative; margin: 0; padding: 0; list-style: none; }
    .lane-row { position: absolute; left: 0; right: 0; box-sizing: border-box; }
    .card {
      box-sizing: border-box;
      height: 160px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px;
      background: ${theme.surface};
      color: ${theme.text};
      border: 1px solid ${theme.border};
      border-radius: 6px;
    }
    .card[data-highlighted="true"] { background: ${theme.highlight}; }
    .card[data-selected="true"] { outline: 2px solid ${theme.focus}; }
    .identity, .status, .badges { height: 20px; line-height: 20px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 8px; margin-right: 4px; }
    .tier, .badge {
      display: inline-block;
      height: 18px;
      line-height: 18px;
      padding: 0 4px;
      border-radius: 4px;
      background: ${theme.buttonBg};
      color: ${theme.buttonText};
    }
    .badge[data-sub-badge="thinking"] { background: ${theme.thinkingBg}; color: ${theme.thinkingText}; }
    .badge[data-sub-badge="waiting_for_run_slot"] { background: ${theme.waitingBg}; color: ${theme.waitingText}; }
    .badge[data-sub-badge="running_command"] { background: ${theme.runningBg}; color: ${theme.runningText}; }
    .badge[data-hold] { background: ${theme.heldBg}; color: ${theme.heldText}; }
    .quarantine[data-quarantine="off"] { visibility: hidden; }
    .health { height: 16px; display: flex; gap: 4px; }
    .health-slot { width: 16px; height: 16px; flex: 0 0 16px; border-radius: 2px; background: ${theme.border}; }
    .health-slot[data-filled="true"] { background: ${theme.focus}; }
    .actions { height: 48px; overflow: hidden; display: flex; flex-wrap: wrap; gap: 4px; }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
      color: ${theme.text};
      background: ${theme.page};
    }
  `;
}

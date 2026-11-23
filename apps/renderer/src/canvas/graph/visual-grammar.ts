import type { NodeBasis } from "./types.js";

export interface VisualGrammarTokens {
  readonly borderStyle: "solid" | "dashed" | "dotted";
  readonly borderWidthPx: number;
  readonly borderColor: string;
  readonly fill: string;
  readonly textColor: string;
  readonly badge: string | null;
  readonly icon: string;
  readonly ariaLabel: string;
}

const LIGHT_TEXT = "#1c1917";
const DARK_TEXT = "#f8fafc";

const LIGHT = {
  explicit: { border: "#1e4d8b", fill: "#f5f9ff", icon: "◼" },
  delegated: { border: "#5c6b7a", fill: "#f4f6f8", icon: "▸" },
  defaulted: { border: "#5c6b7a", fill: "#f4f6f8", icon: "▸" },
  derived: { border: "#2f6f4e", fill: "#f3faf6", icon: "◎" },
  proposed: { border: "#b87614", fill: "#fff9ef", icon: "◇" },
  observed: { border: "#4a5568", fill: "#eceff4", icon: "▣" },
  conflict: { border: "#b42318", fill: "#fef3f2", icon: "!" },
  skeleton: { border: "#6b7280", fill: "#f9fafb", icon: "🔒" },
} as const;

const DARK: Record<keyof typeof LIGHT | "skeleton" | "conflict", { border: string; fill: string; icon: string }> = {
  explicit: { border: "#7eb0ff", fill: "#0f1a2d", icon: "◼" },
  delegated: { border: "#9aa8b7", fill: "#161b22", icon: "▸" },
  defaulted: { border: "#9aa8b7", fill: "#161b22", icon: "▸" },
  derived: { border: "#5ecf8a", fill: "#0f1f16", icon: "◎" },
  proposed: { border: "#f0b35a", fill: "#2a1f0d", icon: "◇" },
  observed: { border: "#94a3b8", fill: "#1a202c", icon: "▣" },
  conflict: { border: "#f97066", fill: "#2a1210", icon: "!" },
  skeleton: { border: "#9ca3af", fill: "#111827", icon: "🔒" },
};

export function visualGrammarForNode(input: {
  readonly basis: NodeBasis | null;
  readonly hasConflict: boolean;
  readonly skeletonLocked: boolean;
  readonly theme: "light" | "dark";
}): VisualGrammarTokens {
  const palette = input.theme === "dark" ? DARK : LIGHT;
  if (input.hasConflict) {
    const c = palette.conflict;
    return {
      borderStyle: "solid",
      borderWidthPx: 2,
      borderColor: c.border,
      fill: c.fill,
      textColor: input.theme === "dark" ? DARK_TEXT : LIGHT_TEXT,
      badge: "Conflict",
      icon: c.icon,
      ariaLabel: "conflict node",
    };
  }
  if (input.skeletonLocked) {
    const s = palette.skeleton;
    return {
      borderStyle: "dotted",
      borderWidthPx: 1,
      borderColor: s.border,
      fill: s.fill,
      textColor: input.theme === "dark" ? DARK_TEXT : LIGHT_TEXT,
      badge: "Locked",
      icon: s.icon,
      ariaLabel: "skeleton locked",
    };
  }
  const basis = input.basis ?? "explicit";
  const tone = palette[basis] ?? palette.explicit;
  const delegated = basis === "delegated" || basis === "defaulted";
  const badge = delegated ? "Chosen for you" : basis === "proposed" ? "Proposed" : basis === "observed" ? "Existing" : null;
  return {
    borderStyle: basis === "explicit" || basis === "observed" || basis === "proposed" ? "solid" : "dashed",
    borderWidthPx: basis === "proposed" ? 2 : 1,
    borderColor: tone.border,
    fill: tone.fill,
    textColor: input.theme === "dark" ? DARK_TEXT : LIGHT_TEXT,
    badge,
    icon: tone.icon,
    ariaLabel: `${basis} node`,
  };
}

export function contrastRatioPass(fg: string, bg: string): boolean {
  const lum = (hex: string) => {
    const raw = hex.replace("#", "");
    const r = Number.parseInt(raw.slice(0, 2), 16) / 255;
    const g = Number.parseInt(raw.slice(2, 4), 16) / 255;
    const b = Number.parseInt(raw.slice(4, 6), 16) / 255;
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const l1 = lum(fg);
  const l2 = lum(bg);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return ratio >= 4.5;
}
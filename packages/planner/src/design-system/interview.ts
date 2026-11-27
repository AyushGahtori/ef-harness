import { contrastRatio, normalizeHex, resolveAccessiblePairing } from "./contrast.js";
import type { ResolvedPairing } from "./contrast.js";
import {
  DENSITIES,
  DesignSystemError,
  MOOD_PRESETS,
  THEME_SUPPORTS,
} from "./types.js";
import type {
  AccessibleColorPairing,
  BrandRoleDecision,
  Density,
  InterviewQuestion,
  LookAndFeelDecision,
  LookAndFeelInput,
  MoodPreset,
  TypographyPairing,
} from "./types.js";

const LIGHT_SURFACES = ["#F8FAFC", "#FFFFFF"] as const;
const DARK_SURFACES = ["#0F172A", "#1E293B"] as const;
const PRESET_PRIMARY = "#0F172A";
const PRESET_ACCENT = "#3730A3";

const MOODS: Record<
  MoodPreset,
  { readonly label: string; readonly typography: TypographyPairing; readonly radiusControlPx: 4 | 8 | 12 }
> = {
  neutral: {
    label: "Clean neutral",
    typography: {
      heading: "ui-sans-serif, system-ui, sans-serif",
      body: "ui-sans-serif, system-ui, sans-serif",
      loading: "system",
    },
    radiusControlPx: 8,
  },
  editorial: {
    label: "Editorial",
    typography: {
      heading: "ui-serif, Georgia, serif",
      body: "ui-sans-serif, system-ui, sans-serif",
      loading: "system",
    },
    radiusControlPx: 4,
  },
  technical: {
    label: "Technical",
    typography: {
      heading: "ui-sans-serif, system-ui, sans-serif",
      body: "ui-monospace, SFMono-Regular, Menlo, monospace",
      loading: "system",
    },
    radiusControlPx: 4,
  },
  soft: {
    label: "Soft",
    typography: {
      heading: "ui-sans-serif, system-ui, sans-serif",
      body: "ui-sans-serif, system-ui, sans-serif",
      loading: "system",
    },
    radiusControlPx: 12,
  },
};

const DENSITY_METRICS: Record<Density, { readonly pagePaddingPx: 16 | 24 | 32; readonly stackGapPx: 8 | 12 | 16 }> = {
  comfortable: { pagePaddingPx: 32, stackGapPx: 16 },
  balanced: { pagePaddingPx: 24, stackGapPx: 12 },
  compact: { pagePaddingPx: 16, stackGapPx: 8 },
};

function toPairing(resolved: ResolvedPairing): AccessibleColorPairing {
  return {
    fill: resolved.fill,
    foreground: resolved.foreground,
    textStrong: resolved.textStrong,
    whiteOnFill: resolved.whiteOnFill,
    foregroundOnFill: resolved.foregroundOnFill,
    textStrongOnSurface: resolved.textStrongOnSurface,
    publishedTextStrong: resolved.publishedTextStrong,
  };
}

function fixedPairing(
  fill: string,
  foreground: string,
  textStrong: string,
  surfaces: readonly string[],
): AccessibleColorPairing {
  return {
    fill,
    foreground,
    textStrong,
    whiteOnFill: contrastRatio("#FFFFFF", fill),
    foregroundOnFill: contrastRatio(foreground, fill),
    textStrongOnSurface: Math.min(...surfaces.map((surface) => contrastRatio(textStrong, surface))),
    publishedTextStrong: false,
  };
}

function roleDecision(hex: string, kind: "primary" | "accent"): BrandRoleDecision {
  if (kind === "primary" && hex === PRESET_PRIMARY) {
    return {
      input: hex,
      light: fixedPairing(hex, "#FFFFFF", hex, LIGHT_SURFACES),
      dark: fixedPairing("#E2E8F0", "#0F172A", "#E2E8F0", DARK_SURFACES),
    };
  }
  if (kind === "accent" && hex === PRESET_ACCENT) {
    return {
      input: hex,
      light: fixedPairing(hex, "#FFFFFF", hex, LIGHT_SURFACES),
      dark: fixedPairing("#C4B5FD", "#0F172A", "#C4B5FD", DARK_SURFACES),
    };
  }
  return {
    input: hex,
    light: toPairing(resolveAccessiblePairing(hex, LIGHT_SURFACES)),
    dark: toPairing(resolveAccessiblePairing(hex, DARK_SURFACES)),
  };
}

function includes<T extends string>(values: readonly T[], value: string): value is T {
  return values.some((item) => item === value);
}

/**
 * Four visual choices cover mood (with its locked system typography pairing),
 * brand color or a Task 099 asset, density, and theme. The kit stays shadcn/ui.
 */
export class LookAndFeelInterviewFlow {
  readonly questions: readonly InterviewQuestion[] = [
    {
      id: "mood",
      prompt: "Visual personality, including its system typography pairing",
      recommended: "neutral",
    },
    {
      id: "brand",
      prompt: "Primary and accent brand colors, or an uploaded brand asset",
      recommended: "slate with one indigo accent",
    },
    {
      id: "density",
      prompt: "Density",
      recommended: "balanced",
    },
    {
      id: "theme",
      prompt: "Light, dark, or both",
      recommended: "both",
    },
  ];

  acceptAll(): LookAndFeelDecision {
    return this.capture({});
  }

  capture(input: LookAndFeelInput): LookAndFeelDecision {
    const issues: string[] = [];
    const mood = input.mood ?? "neutral";
    const density = input.density ?? "balanced";
    const theme = input.theme ?? "both";
    if (!includes(MOOD_PRESETS, mood)) issues.push(`mood ${mood} is not a preset`);
    if (!includes(DENSITIES, density)) issues.push(`density ${density} must be comfortable, balanced, or compact`);
    if (!includes(THEME_SUPPORTS, theme)) issues.push(`theme ${theme} must be light, dark, or both`);
    const assets = input.brandAssets ?? [];
    for (const asset of assets) {
      if (!asset.assetId.trim()) issues.push("brand asset is missing an id");
      for (const color of asset.dominantColorsHex) {
        try {
          readHex(color);
        } catch (error) {
          issues.push(error instanceof Error ? error.message : String(error));
        }
      }
    }
    let primary = PRESET_PRIMARY;
    let accent = PRESET_ACCENT;
    let source: LookAndFeelDecision["brand"]["source"] = "preset";
    if (input.primary) {
      primary = readHex(input.primary, issues);
      source = "user";
    }
    if (input.accent) {
      accent = readHex(input.accent, issues);
      source = "user";
    }
    const suggestions = assets
      .filter((asset) => asset.role !== "font" && asset.dominantColorsHex.length > 0)
      .map((asset) => ({
        assetId: asset.assetId,
        primary: safeHex(asset.dominantColorsHex[0], primary),
        accent: safeHex(asset.dominantColorsHex[1], accent),
      }));
    if (input.useBrandAssetColors) {
      const suggestion = suggestions[0];
      if (!suggestion) {
        issues.push("useBrandAssetColors requires a brand asset with a dominant color");
      } else {
        primary = suggestion.primary;
        accent = suggestion.accent;
        source = "brand-asset";
      }
    }
    if (issues.length > 0) throw new DesignSystemError(issues);
    const moodRecord = MOODS[mood];
    const densityRecord = DENSITY_METRICS[density];
    return {
      visualChoices: 4,
      mood,
      moodLabel: moodRecord.label,
      density,
      theme,
      typography: moodRecord.typography,
      componentLibrary: "shadcn/ui",
      gradients: "none",
      radiusControlPx: moodRecord.radiusControlPx,
      pagePaddingPx: densityRecord.pagePaddingPx,
      stackGapPx: densityRecord.stackGapPx,
      brand: {
        source,
        primary: roleDecision(primary, "primary"),
        accent: roleDecision(accent, "accent"),
        assetIds: assets.map((asset) => asset.assetId),
        suggestions,
      },
    };
  }
}

function readHex(value: string, issues?: string[]): string {
  try {
    return normalizeHex(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (issues) issues.push(message);
    else throw error;
    return PRESET_PRIMARY;
  }
}

function safeHex(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  try {
    return normalizeHex(value);
  } catch {
    return fallback;
  }
}

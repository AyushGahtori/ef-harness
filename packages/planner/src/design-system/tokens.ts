import { contrastRatio, formatRatio } from "./contrast.js";
import type { LookAndFeelDecision } from "./types.js";
import {
  MOTION_SCALE,
  RADIUS_SCALE,
  SEMANTIC_COLOR_KEYS,
  SPACING_SCALE_PX,
  STYLE_DICTIONARY_SOURCE,
  TEXT_CONTRAST_FLOOR,
  TEXT_PAIRS,
  TYPE_SCALE,
  UI_CONTRAST_FLOOR,
  UI_PAIRS,
} from "./types.js";
import type {
  ContrastPair,
  ContrastReport,
  DesignTokenDocument,
  SemanticColorName,
  SemanticPalette,
  StyleDictionaryBuild,
  W3cLeaf,
} from "./types.js";

const LIGHT_BASE: SemanticPalette = {
  surface: "#F8FAFC",
  "surface-raised": "#FFFFFF",
  "text-primary": "#0F172A",
  "text-muted": "#334155",
  border: "#475569",
  focus: "#1E3A8A",
  primary: "#0F172A",
  "primary-foreground": "#FFFFFF",
  "primary-text-strong": "#0F172A",
  accent: "#3730A3",
  "accent-foreground": "#FFFFFF",
  "accent-text-strong": "#3730A3",
  danger: "#991B1B",
  "danger-foreground": "#FFFFFF",
  warning: "#92400E",
  "warning-foreground": "#FFFFFF",
  success: "#065F46",
  "success-foreground": "#FFFFFF",
};

const DARK_BASE: SemanticPalette = {
  surface: "#0F172A",
  "surface-raised": "#1E293B",
  "text-primary": "#F8FAFC",
  "text-muted": "#CBD5E1",
  border: "#94A3B8",
  focus: "#93C5FD",
  primary: "#E2E8F0",
  "primary-foreground": "#0F172A",
  "primary-text-strong": "#E2E8F0",
  accent: "#C4B5FD",
  "accent-foreground": "#0F172A",
  "accent-text-strong": "#C4B5FD",
  danger: "#FCA5A5",
  "danger-foreground": "#0F172A",
  warning: "#FCD34D",
  "warning-foreground": "#0F172A",
  success: "#6EE7B7",
  "success-foreground": "#0F172A",
};

function colorLeaf(hex: string): W3cLeaf {
  return { $type: "color", $value: hex };
}

function dimension(value: string): W3cLeaf {
  return { $type: "dimension", $value: value };
}

function paletteRecord(palette: SemanticPalette): Record<SemanticColorName, W3cLeaf> {
  const record = {} as Record<SemanticColorName, W3cLeaf>;
  for (const key of SEMANTIC_COLOR_KEYS) {
    record[key] = colorLeaf(palette[key]);
  }
  return record;
}

function withBrand(base: SemanticPalette, decision: LookAndFeelDecision, theme: "light" | "dark"): SemanticPalette {
  const primary = decision.brand.primary[theme];
  const accent = decision.brand.accent[theme];
  return {
    ...base,
    primary: primary.fill,
    "primary-foreground": primary.foreground,
    "primary-text-strong": primary.textStrong,
    accent: accent.fill,
    "accent-foreground": accent.foreground,
    "accent-text-strong": accent.textStrong,
  };
}

export function pairingLines(decision: LookAndFeelDecision): readonly string[] {
  const lines: string[] = [];
  for (const role of ["primary", "accent"] as const) {
    for (const theme of ["light", "dark"] as const) {
      const pairing = decision.brand[role][theme];
      lines.push(
        `${role} ${theme}: fill ${pairing.fill}, on-fill ${pairing.foreground} at ${formatRatio(pairing.foregroundOnFill)}:1, small text ${pairing.textStrong} at ${formatRatio(pairing.textStrongOnSurface)}:1.`,
      );
      if (pairing.whiteOnFill < TEXT_CONTRAST_FLOOR) {
        lines.push(
          `White on ${pairing.fill} is ${formatRatio(pairing.whiteOnFill)}:1 and fails WCAG AA for small text.`,
        );
      }
    }
  }
  return lines;
}

function lightElevation(border: string): { raised: string; overlay: string } {
  return {
    raised: `0 1px 2px rgb(15 23 42 / 0.12), 0 0 0 1px ${border}`,
    overlay: `0 12px 32px rgb(15 23 42 / 0.16), 0 0 0 1px ${border}`,
  };
}

function darkElevation(border: string): { raised: string; overlay: string } {
  return {
    raised: `0 0 0 1px ${border}`,
    overlay: `0 8px 24px rgb(0 0 0 / 0.45), 0 0 0 1px ${border}`,
  };
}

export class W3cDesignTokenGenerator {
  readonly source = STYLE_DICTIONARY_SOURCE;

  generate(decision: LookAndFeelDecision): DesignTokenDocument {
    const light = withBrand(LIGHT_BASE, decision, "light");
    const dark = withBrand(DARK_BASE, decision, "dark");
    const lightShadow = lightElevation(light.border);
    const darkShadow = darkElevation(dark.border);
    const spacing: Record<string, W3cLeaf> = {};
    for (const step of SPACING_SCALE_PX) {
      spacing[String(step)] = dimension(`${step}px`);
    }
    const size: Record<string, W3cLeaf> = {};
    for (const step of TYPE_SCALE) {
      size[step.id] = dimension(`${step.px}px`);
    }
    const radius: Record<string, W3cLeaf> = {};
    for (const step of RADIUS_SCALE) {
      radius[step.id] = dimension(`${step.px}px`);
    }
    radius.control = dimension(`${decision.radiusControlPx}px`);
    const motion: Record<string, W3cLeaf> = {};
    for (const step of MOTION_SCALE) {
      motion[step.id] = { $type: "duration", $value: `${step.ms}ms` };
    }
    return {
      $description: `theme-support=${decision.theme}; mood=${decision.mood}; density=${decision.density}; gradients=none; style-dictionary=${STYLE_DICTIONARY_SOURCE}`,
      color: { light: paletteRecord(light), dark: paletteRecord(dark) },
      spacing,
      font: {
        family: {
          heading: { $type: "fontFamily", $value: decision.typography.heading.split(", ") },
          body: { $type: "fontFamily", $value: decision.typography.body.split(", ") },
        },
        size,
        weight: {
          regular: { $type: "number", $value: 400 },
          semibold: { $type: "number", $value: 600 },
        },
      },
      radius,
      elevation: {
        light: {
          raised: { $type: "shadow", $value: lightShadow.raised },
          overlay: { $type: "shadow", $value: lightShadow.overlay },
        },
        dark: {
          raised: { $type: "shadow", $value: darkShadow.raised },
          overlay: { $type: "shadow", $value: darkShadow.overlay },
        },
      },
      motion,
      border: { width: dimension("1px") },
      density: {
        page: dimension(`${decision.pagePaddingPx}px`),
        gap: dimension(`${decision.stackGapPx}px`),
      },
      palettes: { light, dark },
    };
  }

  verifyContrast(document: DesignTokenDocument): ContrastReport {
    const pairs: ContrastPair[] = [];
    for (const theme of ["light", "dark"] as const) {
      const palette = document.palettes[theme];
      for (const [foreground, background] of TEXT_PAIRS) {
        const ratio = contrastRatio(palette[foreground], palette[background]);
        pairs.push({
          theme,
          kind: "text",
          foreground,
          background,
          ratio,
          floor: TEXT_CONTRAST_FLOOR,
          ok: ratio >= TEXT_CONTRAST_FLOOR,
        });
      }
      for (const [foreground, background] of UI_PAIRS) {
        const ratio = contrastRatio(palette[foreground], palette[background]);
        pairs.push({
          theme,
          kind: "ui",
          foreground,
          background,
          ratio,
          floor: UI_CONTRAST_FLOOR,
          ok: ratio >= UI_CONTRAST_FLOOR,
        });
      }
    }
    return { ok: pairs.every((pair) => pair.ok), pairs };
  }

  compile(document: DesignTokenDocument): StyleDictionaryBuild {
    const contrast = this.verifyContrast(document);
    const tokensJson = `${JSON.stringify(publicDocument(document), null, 2)}\n`;
    const css = renderCss(document);
    const tailwind = renderTailwind();
    const typescript = renderTypescript(document);
    return {
      source: STYLE_DICTIONARY_SOURCE,
      tokensJson,
      css,
      tailwind,
      typescript,
      contrast,
      tokenHexes: collectHexes(document),
    };
  }
}

function publicDocument(document: DesignTokenDocument): unknown {
  return {
    $description: document.$description,
    color: document.color,
    spacing: document.spacing,
    font: document.font,
    radius: document.radius,
    elevation: document.elevation,
    motion: document.motion,
    border: document.border,
    density: document.density,
  };
}

function collectHexes(document: DesignTokenDocument): string[] {
  const hexes = new Set<string>();
  for (const theme of ["light", "dark"] as const) {
    for (const key of SEMANTIC_COLOR_KEYS) {
      hexes.add(document.palettes[theme][key]);
    }
  }
  return [...hexes];
}

function renderCss(document: DesignTokenDocument): string {
  const darkDefault = document.$description.includes("theme-support=dark");
  const rootTheme = darkDefault ? "dark" : "light";
  const alternate = darkDefault ? "light" : "dark";
  const lines = [
    "/* style-dictionary: local-port deterministic DTCG transform. Generated from design/tokens.json. */",
    "/* gradients: none */",
    ":root {",
    `  color-scheme: ${rootTheme};`,
    ...sharedBindings(document),
    ...colorBindings(document, rootTheme),
    "}",
    `:root[data-theme="${alternate}"] {`,
    `  color-scheme: ${alternate};`,
    ...colorBindings(document, alternate),
    "}",
  ];
  if (document.$description.includes("theme-support=both")) {
    lines.push(
      "@media (prefers-color-scheme: dark) {",
      '  :root:not([data-theme="light"]) {',
      "    color-scheme: dark;",
      ...colorBindings(document, "dark").map((line) => `  ${line}`),
      "  }",
      "}",
    );
  }
  lines.push(
    "@media (prefers-reduced-motion: reduce) {",
    "  :root {",
    "    --motion-fast: 0ms;",
    "    --motion-normal: 0ms;",
    "    --motion-slow: 0ms;",
    "  }",
    "}",
    ".ui-button,",
    ".ui-input,",
    ".ui-dialog,",
    ".ui-toast {",
    "  min-height: var(--tap-target);",
    "  min-width: var(--tap-target);",
    "  font-family: var(--font-body);",
    "  font-size: var(--font-size-md);",
    "  border-radius: var(--radius-control);",
    "  border: var(--border-width) solid var(--color-border);",
    "}",
    ".ui-button-primary {",
    "  background: var(--color-primary);",
    "  color: var(--color-primary-foreground);",
    "}",
    ".ui-button-secondary {",
    "  background: var(--color-surface-raised);",
    "  color: var(--color-text-primary);",
    "}",
    ".ui-button-danger {",
    "  background: var(--color-danger);",
    "  color: var(--color-danger-foreground);",
    "}",
    ".ui-button[data-state=\"hover\"],",
    ".ui-button:hover {",
    "  filter: brightness(0.96);",
    "}",
    ".ui-button[data-state=\"focus\"],",
    ".ui-button:focus-visible,",
    ".ui-input:focus-visible,",
    ".ui-dialog:focus-visible {",
    "  outline: var(--border-width) solid var(--color-focus);",
    "  outline-offset: 2px;",
    "}",
    ".ui-button[data-state=\"disabled\"],",
    ".ui-button:disabled {",
    "  opacity: 0.6;",
    "}",
    ".ui-button[data-state=\"error\"],",
    ".ui-input[data-state=\"error\"] {",
    "  outline: var(--border-width) solid var(--color-danger);",
    "}",
    ".ui-surface {",
    "  background: var(--color-surface);",
    "  color: var(--color-text-primary);",
    "}",
    ".ui-surface-raised {",
    "  background: var(--color-surface-raised);",
    "  color: var(--color-text-primary);",
    "  box-shadow: var(--elevation-raised);",
    "}",
    ".layout-print {",
    "  background: var(--color-surface);",
    "  color: var(--color-text-primary);",
    "}",
    "",
  );
  return lines.join("\n");
}

function familyValue(leaf: { readonly $value: string | number | readonly string[] }): string {
  return Array.isArray(leaf.$value) ? leaf.$value.join(", ") : String(leaf.$value);
}

function sharedBindings(document: DesignTokenDocument): string[] {
  const lines: string[] = [];
  for (const step of SPACING_SCALE_PX) {
    lines.push(`  --spacing-${step}: ${step}px;`);
  }
  lines.push("  --tap-target: var(--spacing-24);");
  for (const step of TYPE_SCALE) {
    lines.push(`  --font-size-${step.id}: ${step.px}px;`);
  }
  lines.push(`  --font-heading: ${familyValue(document.font.family.heading)};`);
  lines.push(`  --font-body: ${familyValue(document.font.family.body)};`);
  lines.push("  --font-weight-regular: 400;");
  lines.push("  --font-weight-semibold: 600;");
  for (const step of RADIUS_SCALE) {
    lines.push(`  --radius-${step.id}: ${step.px}px;`);
  }
  lines.push(`  --radius-control: ${String(document.radius.control?.$value ?? "8px")};`);
  lines.push("  --border-width: 1px;");
  for (const step of MOTION_SCALE) {
    lines.push(`  --motion-${step.id}: ${step.ms}ms;`);
  }
  lines.push(`  --density-page: ${String(document.density.page.$value)};`);
  lines.push(`  --density-gap: ${String(document.density.gap.$value)};`);
  return lines;
}

function colorBindings(document: DesignTokenDocument, theme: "light" | "dark"): string[] {
  const palette = document.palettes[theme];
  const lines: string[] = [];
  for (const key of SEMANTIC_COLOR_KEYS) {
    lines.push(`  --color-${key}: ${palette[key]};`);
  }
  const shadow = document.elevation[theme];
  lines.push(`  --elevation-raised: ${String(shadow.raised.$value)};`);
  lines.push(`  --elevation-overlay: ${String(shadow.overlay.$value)};`);
  return lines;
}

function renderTailwind(): string {
  const colors = SEMANTIC_COLOR_KEYS.map((key) => `      "${key}": "var(--color-${key})",`).join("\n");
  const spacing = SPACING_SCALE_PX.map((step) => `      "${step}": "var(--spacing-${step})",`).join("\n");
  const fontSize = TYPE_SCALE.map((step) => `      "${step.id}": "var(--font-size-${step.id})",`).join("\n");
  const radius = RADIUS_SCALE.map((step) => `      "${step.id}": "var(--radius-${step.id})",`).join("\n");
  return [
    "/* Generated from design/tokens.json by the local Style Dictionary transform. */",
    "export const tailwindTheme = {",
    "  extend: {",
    "    colors: {",
    colors,
    "    },",
    "    spacing: {",
    spacing,
    "    },",
    "    fontSize: {",
    fontSize,
    "    },",
    "    borderRadius: {",
    radius,
    "    },",
    "    boxShadow: {",
    '      raised: "var(--elevation-raised)",',
    '      overlay: "var(--elevation-overlay)",',
    "    },",
    "    transitionDuration: {",
    '      fast: "var(--motion-fast)",',
    '      normal: "var(--motion-normal)",',
    '      slow: "var(--motion-slow)",',
    "    },",
    "  },",
    "} as const;",
    "",
  ].join("\n");
}

function renderTypescript(document: DesignTokenDocument): string {
  return [
    "/* Generated from design/tokens.json by the local Style Dictionary transform. */",
    "export const tokens = ",
    JSON.stringify(
      {
        color: document.palettes,
        spacing: Object.fromEntries(SPACING_SCALE_PX.map((step) => [String(step), `${step}px`])),
        fontSize: Object.fromEntries(TYPE_SCALE.map((step) => [step.id, `${step.px}px`])),
        radius: Object.fromEntries(RADIUS_SCALE.map((step) => [step.id, `${step.px}px`])),
        motion: Object.fromEntries(MOTION_SCALE.map((step) => [step.id, `${step.ms}ms`])),
        elevation: {
          light: {
            raised: document.elevation.light.raised.$value,
            overlay: document.elevation.light.overlay.$value,
          },
          dark: {
            raised: document.elevation.dark.raised.$value,
            overlay: document.elevation.dark.overlay.$value,
          },
        },
      },
      null,
      2,
    ),
    " as const;",
    "",
  ].join("\n");
}

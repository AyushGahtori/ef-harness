import type { DesignKit, LintViolation } from "./types.js";
import { SPACING_SCALE_PX, TYPE_SCALE } from "./types.js";

const SPACING = new Set<number>([0, 1, ...SPACING_SCALE_PX]);
const TYPE = new Set<number>(TYPE_SCALE.map((step) => step.px));

const HEX = /#(?:[0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})\b/gi;
const ARBITRARY_COLOR =
  /\b(?:bg|text|border|fill|stroke|from|to|via|ring|outline|caret|decoration|accent|shadow|divide)-\[(?:#[0-9A-Fa-f]{3,8}|rgba?\([^)\]]+\)|hsla?\([^)\]]+\))\]/gi;
const ARBITRARY_LENGTH =
  /\b(?:p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|w|h|min-w|min-h|max-w|max-h|text|leading|tracking)-\[(\d+(?:\.\d+)?)px\]/gi;
const DECL_LENGTH =
  /\b(font-size|margin|padding|gap|width|height|top|right|bottom|left|inset)\s*:\s*(\d+(?:\.\d+)?)px/gi;
const RAW_TAG = /<\s*(button|input|dialog)\b/g;

export const FIX_HINTS = {
  button: "Use <Button variant='primary'> from @/components/ui/button",
  input: "Use <Input> from @/components/ui/input",
  dialog: "Use <Dialog> from @/components/ui/dialog",
} as const;

export interface LintOptions {
  readonly knownTokenHexes?: readonly string[];
  readonly kit?: DesignKit;
  readonly allowHexPaths?: readonly string[];
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

function isTokenSource(filePath: string, options: LintOptions): boolean {
  const path = normalizePath(filePath);
  if (
    path.endsWith("design/tokens.json") ||
    path.endsWith("src/styles/tokens.css") ||
    path.endsWith("src/styles/tokens.ts") ||
    path.endsWith("eslint/ef-token-rules.mjs") ||
    path.endsWith("stylelint/ef-token-rules.mjs")
  ) {
    return true;
  }
  return (options.allowHexPaths ?? []).some((allowed) => path.endsWith(normalizePath(allowed)) || path.includes(normalizePath(allowed)));
}

function isPrimitive(filePath: string): boolean {
  const path = normalizePath(filePath);
  return path.includes("/components/ui/") || path.startsWith("src/components/ui/");
}

function isStyleguide(filePath: string): boolean {
  return normalizePath(filePath).includes("__styleguide");
}

function expandHex(value: string): string {
  const body = value.slice(1);
  const expanded = body.length === 3 || body.length === 4
    ? [...body.slice(0, 3)].map((channel) => channel + channel).join("")
    : body.slice(0, 6);
  return `#${expanded.toUpperCase()}`;
}

function known(hex: string, options: LintOptions): boolean {
  const normalized = expandHex(hex);
  return (options.knownTokenHexes ?? []).some((token) => token.toUpperCase() === normalized);
}

export class DesignTokenLintRuleset {
  lintFile(filePath: string, source: string, options: LintOptions = {}): LintViolation[] {
    if (isTokenSource(filePath, options)) return [];
    const violations: LintViolation[] = [];
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      violations.push(...lintLine(filePath, line, index + 1, options));
    });
    return violations;
  }

  lintFiles(
    files: readonly { readonly path: string; readonly contents: string }[],
    options: LintOptions = {},
  ): LintViolation[] {
    return files.flatMap((file) =>
      this.lintFile(file.path, file.contents, options).map((violation) => ({
        ...violation,
        message: `${file.path}:${violation.line} ${violation.message}`,
      })),
    );
  }

  emit(): { readonly eslint: string; readonly stylelint: string } {
    return {
      eslint: emittedEslint(),
      stylelint: emittedStylelint(),
    };
  }
}

function lintLine(filePath: string, line: string, lineNumber: number, options: LintOptions): LintViolation[] {
  const violations: LintViolation[] = [];
  const styleguide = isStyleguide(filePath);
  for (const match of line.matchAll(new RegExp(HEX.source, "gi"))) {
    const hex = match[0] ?? "";
    if (styleguide && known(hex, options)) continue;
    violations.push({
      rule: "ef/no-raw-color",
      line: lineNumber,
      message: `raw color ${hex} is outside tokens.css`,
    });
  }
  if (/\b(?:rgba?|hsla?)\(/i.test(line)) {
    violations.push({
      rule: "ef/no-raw-color",
      line: lineNumber,
      message: "raw rgb() or hsl() color is outside tokens.css",
    });
  }
  for (const match of line.matchAll(new RegExp(ARBITRARY_COLOR.source, "gi"))) {
    violations.push({
      rule: "ef/no-arbitrary-color",
      line: lineNumber,
      message: `arbitrary Tailwind color ${match[0] ?? ""} is not a token`,
    });
  }
  if (/\b(?:bg-white|text-black)\b/.test(line)) {
    violations.push({
      rule: "ef/no-dark-inversion",
      line: lineNumber,
      message: "hardcoded bg-white or text-black breaks dark mode; use semantic surface and text tokens",
    });
  }
  for (const match of line.matchAll(new RegExp(ARBITRARY_LENGTH.source, "gi"))) {
    const px = Number(match[1]);
    const token = match[0] ?? "";
    const allowed = token.startsWith("text-") || token.startsWith("leading-") || token.startsWith("tracking-")
      ? TYPE.has(px)
      : SPACING.has(px);
    if (!allowed) {
      violations.push({
        rule: "ef/no-magic-spacing",
        line: lineNumber,
        message: `${token} is off the semantic spacing and type scale`,
      });
    }
  }
  for (const match of line.matchAll(new RegExp(DECL_LENGTH.source, "gi"))) {
    const property = (match[1] ?? "").toLowerCase();
    const px = Number(match[2]);
    const allowed = property === "font-size" ? TYPE.has(px) : SPACING.has(px);
    if (!allowed) {
      violations.push({
        rule: "ef/no-magic-spacing",
        line: lineNumber,
        message: `${property}: ${px}px is off the semantic scale`,
      });
    }
  }
  for (const match of line.matchAll(/["'](\d+(?:\.\d+)?)px["']/g)) {
    const px = Number(match[1]);
    if (!SPACING.has(px) && !TYPE.has(px)) {
      violations.push({
        rule: "ef/no-magic-spacing",
        line: lineNumber,
        message: `${px}px is off the semantic spacing and type scale`,
      });
    }
  }
  if (!isPrimitive(filePath)) {
    for (const match of line.matchAll(new RegExp(RAW_TAG.source, "g"))) {
      const tag = (match[1] ?? "").toLowerCase();
      const hint =
        tag === "input" ? FIX_HINTS.input : tag === "dialog" ? FIX_HINTS.dialog : primitiveHint(options.kit);
      violations.push({
        rule: "ef/no-raw-primitive",
        line: lineNumber,
        message: hint,
      });
    }
  }
  return violations;
}

function primitiveHint(kit: DesignKit | undefined): string {
  if (kit === "mui") return "Use the existing MUI Button from @mui/material instead of a raw <button>.";
  if (kit === "chakra") return "Use the existing Chakra Button from @chakra-ui/react instead of a raw <button>.";
  return FIX_HINTS.button;
}

function emittedEslint(): string {
  return `const SPACING = new Set([0, 1, 4, 8, 12, 16, 24, 32, 48, 64]);
const TYPE = new Set([12, 14, 16, 20, 24, 32]);
const FIX = {
  button: "Use <Button variant='primary'> from @/components/ui/button",
  input: "Use <Input> from @/components/ui/input",
  dialog: "Use <Dialog> from @/components/ui/dialog",
};

function pathOf(filePath) {
  return String(filePath).replaceAll("\\\\", "/");
}

function allowed(filePath) {
  const path = pathOf(filePath);
  return (
    path.endsWith("design/tokens.json") ||
    path.endsWith("src/styles/tokens.css") ||
    path.endsWith("src/styles/tokens.ts") ||
    path.endsWith("eslint/ef-token-rules.mjs") ||
    path.endsWith("stylelint/ef-token-rules.mjs")
  );
}

function primitive(filePath) {
  const path = pathOf(filePath);
  return path.includes("/components/ui/") || path.startsWith("src/components/ui/");
}

export function lintSource(source, filePath, options = {}) {
  if (allowed(filePath)) return [];
  const known = new Set((options.knownTokenHexes ?? []).map((hex) => String(hex).toUpperCase()));
  const styleguide = pathOf(filePath).includes("__styleguide");
  const kit = options.kit;
  const violations = [];
  const lines = String(source).split(/\\r?\\n/);
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    for (const match of line.matchAll(/#(?:[0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})\\b/gi)) {
      const hex = match[0];
      const body = hex.slice(1);
      const expanded = body.length <= 4 ? body.slice(0, 3).split("").map((channel) => channel + channel).join("") : body.slice(0, 6);
      const normalized = "#" + expanded.toUpperCase();
      if (styleguide && known.has(normalized)) continue;
      violations.push({ rule: "ef/no-raw-color", line: lineNumber, message: "raw color " + hex + " is outside tokens.css" });
    }
    if (/\\b(?:rgba?|hsla?)\\(/i.test(line)) {
      violations.push({ rule: "ef/no-raw-color", line: lineNumber, message: "raw rgb() or hsl() color is outside tokens.css" });
    }
    for (const match of line.matchAll(/\\b(?:bg|text|border|fill|stroke|from|to|via|ring|outline|caret|decoration|accent|shadow|divide)-\\[(?:#[0-9A-Fa-f]{3,8}|rgba?\\([^)\\]]+\\)|hsla?\\([^)\\]]+\\))\\]/gi)) {
      violations.push({ rule: "ef/no-arbitrary-color", line: lineNumber, message: "arbitrary Tailwind color " + match[0] + " is not a token" });
    }
    if (/\\b(?:bg-white|text-black)\\b/.test(line)) {
      violations.push({ rule: "ef/no-dark-inversion", line: lineNumber, message: "hardcoded bg-white or text-black breaks dark mode; use semantic surface and text tokens" });
    }
    for (const match of line.matchAll(/\\b(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|w|h|min-w|min-h|max-w|max-h|text|leading|tracking)-\\[(\\d+(?:\\.\\d+)?)px\\]/gi)) {
      const px = Number(match[2]);
      const token = match[0];
      const name = match[1];
      const ok = name === "text" || name === "leading" || name === "tracking" ? TYPE.has(px) : SPACING.has(px);
      if (!ok) violations.push({ rule: "ef/no-magic-spacing", line: lineNumber, message: token + " is off the semantic spacing and type scale" });
    }
    for (const match of line.matchAll(/\\b(font-size|margin|padding|gap|width|height|top|right|bottom|left|inset)\\s*:\\s*(\\d+(?:\\.\\d+)?)px/gi)) {
      const property = match[1].toLowerCase();
      const px = Number(match[2]);
      const ok = property === "font-size" ? TYPE.has(px) : SPACING.has(px);
      if (!ok) violations.push({ rule: "ef/no-magic-spacing", line: lineNumber, message: property + ": " + px + "px is off the semantic scale" });
    }
    if (!primitive(filePath)) {
      for (const match of line.matchAll(/<\\s*(button|input|dialog)\\b/g)) {
        const tag = match[1].toLowerCase();
        const message = tag === "input"
          ? FIX.input
          : tag === "dialog"
            ? FIX.dialog
            : kit === "mui"
              ? "Use the existing MUI Button from @mui/material instead of a raw <button>."
              : kit === "chakra"
                ? "Use the existing Chakra Button from @chakra-ui/react instead of a raw <button>."
                : FIX.button;
        violations.push({ rule: "ef/no-raw-primitive", line: lineNumber, message });
      }
    }
  });
  return violations;
}

export const eslintRules = {
  "ef/no-raw-color": {
    meta: { type: "problem", schema: [] },
    create(context) {
      return {
        Program() {
          const source = context.sourceCode.getText();
          for (const violation of lintSource(source, context.filename)) {
            if (violation.rule === "ef/no-raw-color" || violation.rule === "ef/no-arbitrary-color" || violation.rule === "ef/no-dark-inversion") {
              context.report({ loc: { line: violation.line, column: 0 }, message: violation.message });
            }
          }
        },
      };
    },
  },
  "ef/no-magic-spacing": {
    meta: { type: "problem", schema: [] },
    create(context) {
      return {
        Program() {
          const source = context.sourceCode.getText();
          for (const violation of lintSource(source, context.filename)) {
            if (violation.rule === "ef/no-magic-spacing") {
              context.report({ loc: { line: violation.line, column: 0 }, message: violation.message });
            }
          }
        },
      };
    },
  },
  "ef/no-raw-primitive": {
    meta: { type: "problem", schema: [] },
    create(context) {
      return {
        Program() {
          const source = context.sourceCode.getText();
          for (const violation of lintSource(source, context.filename)) {
            if (violation.rule === "ef/no-raw-primitive") {
              context.report({ loc: { line: violation.line, column: 0 }, message: violation.message });
            }
          }
        },
      };
    },
  },
};
`;
}

function emittedStylelint(): string {
  return `export function lintCss(source, filePath) {
  const path = String(filePath).replaceAll("\\\\", "/");
  if (path.endsWith("src/styles/tokens.css") || path.endsWith("design/tokens.json")) return [];
  const violations = [];
  const lines = String(source).split(/\\r?\\n/);
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (/#(?:[0-9A-Fa-f]{3,8})\\b/.test(line) || /\\b(?:rgba?|hsla?)\\(/i.test(line)) {
      violations.push({ rule: "ef/no-raw-color", line: lineNumber, message: "raw color is outside tokens.css" });
    }
    const length = /\\b(font-size|margin|padding|gap)\\s*:\\s*(\\d+(?:\\.\\d+)?)px/i.exec(line);
    if (length) {
      const px = Number(length[2]);
      const property = length[1].toLowerCase();
      const scale = property === "font-size" ? [12, 14, 16, 20, 24, 32] : [0, 1, 4, 8, 12, 16, 24, 32, 48, 64];
      if (!scale.includes(px)) {
        violations.push({ rule: "ef/no-magic-spacing", line: lineNumber, message: property + ": " + px + "px is off the semantic scale" });
      }
    }
  });
  return violations;
}
`;
}

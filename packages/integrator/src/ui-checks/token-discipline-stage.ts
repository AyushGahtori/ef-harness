import { UNAPPROVED_IMAGE_HOSTS } from "./constants.js";
import type { DesignTokenLintPort, BrandAssetRegistryPort } from "./ports.js";
import type { RepoFileSlice, UiConsistencyFinding } from "./types.js";

const ARBITRARY_COLOR =
  /\b(?:bg|text|border|fill|stroke|from|to|via|ring|outline)-\[(?:#[0-9A-Fa-f]{3,8}|rgba?\([^)\]]+\)|hsla?\([^)\]]+\))\]/;
const RAW_TAG = /<\s*(button|input)\b/;
const DARK_HARDCODE = /\b(?:bg-white|text-black)\b/;

function isTokenSource(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return (
    normalized.includes("/components/ui/") ||
    normalized.endsWith("tokens.css") ||
    normalized.endsWith("tokens.json") ||
    normalized.includes("__styleguide")
  );
}

export class LocalDesignTokenLint implements DesignTokenLintPort {
  readonly source = "local-port:DesignTokenLintRuleset:Task-094";

  lintFiles(files: readonly RepoFileSlice[]): UiConsistencyFinding[] {
    const findings: UiConsistencyFinding[] = [];
    for (const file of files) {
      if (isTokenSource(file.path)) continue;
      const lines = file.contents.split(/\r?\n/);
      lines.forEach((line, index) => {
        const lineNo = index + 1;
        if (/(?:#(?:[0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})\b)|\b(?:rgba?|hsla?)\(/i.test(line)) {
          findings.push(finding(file.path, lineNo, "ef/no-raw-color", "raw color is outside tokens.css"));
        }
        if (ARBITRARY_COLOR.test(line)) {
          findings.push(finding(file.path, lineNo, "ef/no-arbitrary-color", "arbitrary Tailwind color value"));
        }
        if (RAW_TAG.test(line)) {
          findings.push(
            finding(
              file.path,
              lineNo,
              "ef/no-raw-primitive",
              "raw <button>/<input> bypasses src/components/ui/*",
            ),
          );
        }
        if (DARK_HARDCODE.test(line)) {
          findings.push(finding(file.path, lineNo, "ef/no-dark-hardcode", "hardcoded bg-white/text-black breaks dark mode"));
        }
      });
    }
    return findings;
  }
}

export class LocalBrandAssetRegistry implements BrandAssetRegistryPort {
  readonly source = "local-port:BrandAssetRegistry:Task-099";

  scanHotlinks(files: readonly RepoFileSlice[]): UiConsistencyFinding[] {
    const findings: UiConsistencyFinding[] = [];
    for (const file of files) {
      const lines = file.contents.split(/\r?\n/);
      lines.forEach((line, index) => {
        for (const host of UNAPPROVED_IMAGE_HOSTS) {
          if (line.includes(host)) {
            findings.push(
              finding(
                file.path,
                index + 1,
                "ef/no-external-hotlink",
                `unapproved external image host ${host}`,
              ),
            );
          }
        }
        const brokenRelative = /src=["']\.\/missing\//.test(line);
        if (brokenRelative) {
          findings.push(finding(file.path, index + 1, "ef/broken-relative-image", "broken relative image path"));
        }
      });
    }
    return findings;
  }
}

function finding(file: string, line: number, rule: string, message: string): UiConsistencyFinding {
  return {
    stage: "token_discipline",
    rule,
    severity: "error",
    message,
    location: { file, line, dataEfSource: `${file}:${line}` },
  };
}

export function runTokenDisciplineStage(
  files: readonly RepoFileSlice[],
  deps: {
    readonly tokenLint?: DesignTokenLintPort;
    readonly brandAssets?: BrandAssetRegistryPort;
  } = {},
): UiConsistencyFinding[] {
  const tokenLint = deps.tokenLint ?? new LocalDesignTokenLint();
  const brandAssets = deps.brandAssets ?? new LocalBrandAssetRegistry();
  return [...tokenLint.lintFiles(files), ...brandAssets.scanHotlinks(files)];
}
import { DUPLICATE_SIMILARITY_THRESHOLD } from "./constants.js";
import type { RepoFileSlice, UiConsistencyFinding } from "./types.js";

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

function propSignature(source: string): string[] {
  const match = /(?:export\s+)?(?:function|const)\s+\w+\s*\(([^)]*)\)/.exec(source);
  if (!match?.[1]) return [];
  return match[1]
    .split(",")
    .map((part) => part.trim().split(/[:=]/)[0]?.trim() ?? "")
    .filter(Boolean)
    .sort();
}

function jsxStructure(source: string): string[] {
  const tags: string[] = [];
  for (const match of source.matchAll(/<\s*([A-Za-z][\w.-]*)\b/g)) {
    tags.push(match[1]?.toLowerCase() ?? "");
  }
  for (const match of source.matchAll(/<\s*\/\s*([A-Za-z][\w.-]*)\s*>/g)) {
    tags.push(`/${match[1]?.toLowerCase() ?? ""}`);
  }
  return tags;
}

function similarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function blendScores(jsx: number, props: number): number {
  return jsx * 0.75 + props * 0.25;
}

export class DuplicateComponentDetector {
  constructor(private readonly threshold = DUPLICATE_SIMILARITY_THRESHOLD) {}

  detect(input: {
    readonly featureFiles: readonly RepoFileSlice[];
    readonly primitiveFiles: readonly RepoFileSlice[];
  }): UiConsistencyFinding[] {
    const findings: UiConsistencyFinding[] = [];
    for (const feature of input.featureFiles) {
      const featurePath = normalizePath(feature.path);
      if (!featurePath.includes("/features/") || !featurePath.includes("/components/")) continue;
      const featureJsx = jsxStructure(feature.contents);
      const featureProps = propSignature(feature.contents);
      for (const primitive of input.primitiveFiles) {
        const primitivePath = normalizePath(primitive.path);
        const primitiveJsx = jsxStructure(primitive.contents);
        const primitiveProps = propSignature(primitive.contents);
        const score = blendScores(similarity(featureJsx, primitiveJsx), similarity(featureProps, primitiveProps));
        if (score >= this.threshold) {
          findings.push({
            stage: "duplicate_component",
            rule: "duplicate-primitive",
            severity: "error",
            message: `Duplicate of shared ${primitivePath} (similarity ${score.toFixed(2)}) — reuse shared primitive`,
            location: {
              file: featurePath,
              line: 1,
              dataEfSource: `${featurePath}:1`,
            },
          });
        }
      }
    }
    return findings;
  }
}

export function splitUiSources(files: readonly RepoFileSlice[]): {
  readonly featureFiles: RepoFileSlice[];
  readonly primitiveFiles: RepoFileSlice[];
} {
  const featureFiles: RepoFileSlice[] = [];
  const primitiveFiles: RepoFileSlice[] = [];
  for (const file of files) {
    const path = normalizePath(file.path);
    if (path.includes("/components/ui/")) primitiveFiles.push(file);
    else if (path.includes("/features/") && path.includes("/components/")) featureFiles.push(file);
  }
  return { featureFiles, primitiveFiles };
}
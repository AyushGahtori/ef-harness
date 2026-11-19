import path from "node:path";
import { fileURLToPath } from "node:url";

export const packageName = "@ef-harness/shared-contracts" as const;
export const layer = 0 as const;

export const CANONICAL_ASSETS = {
  stateSql: "schema/state.sql",
  globalSql: "schema/global.sql",
  telemetrySql: "schema/telemetry.sql",
  codeIndexSql: "schema/code-index.sql",
  queriesSql: "schema/queries.sql",
  inferOrAskSkill: "skills/infer-or-ask/SKILL.md",
  resumeChangerBenchmark: "resume-changer-benchmark.json",
  mergeDiagramsScript: "tools/merge-diagrams.js",
  mermaidLargeConfig: "tools/mermaid-large.json",
} as const;

export type CanonicalAssetKey = keyof typeof CANONICAL_ASSETS;

export function repositoryRoot(moduleUrl: string = import.meta.url): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), "..", "..", "..");
}

export function canonicalAssetRelative(key: CanonicalAssetKey): string {
  return CANONICAL_ASSETS[key];
}

export function canonicalAssetAbsolute(
  key: CanonicalAssetKey,
  moduleUrl: string = import.meta.url,
): string {
  return path.join(repositoryRoot(moduleUrl), CANONICAL_ASSETS[key]);
}

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}

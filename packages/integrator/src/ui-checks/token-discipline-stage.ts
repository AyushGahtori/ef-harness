import { defaultConsumedPorts } from "./local-ports.js";
import type { DesignTokenLintPort, BrandAssetRegistryPort } from "./ports.js";
import type { RepoFileSlice, UiConsistencyFinding } from "./types.js";

export function runTokenDisciplineStage(
  files: readonly RepoFileSlice[],
  deps: {
    readonly tokenLint?: DesignTokenLintPort;
    readonly brandAssets?: BrandAssetRegistryPort;
  } = {},
): UiConsistencyFinding[] {
  const tokenLint = deps.tokenLint ?? defaultConsumedPorts.tokenLint;
  const brandAssets = deps.brandAssets ?? defaultConsumedPorts.brandAssets;
  return [...tokenLint.lintFiles(files), ...brandAssets.scanHotlinks(files)];
}
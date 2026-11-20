import { assetKeys, extractAssetReferences, extractCodeNames } from "./extract-names.js";
import { makeFinding } from "./findings.js";
import { isFixturePath, isGeneratedOrSeed, lineSnippet, normalizePath } from "./path-match.js";
import type { NameRegistryService } from "./ports.js";
import type { RegisteredAsset, StaticAuditFinding } from "./types.js";

export interface NameAssetFile {
  readonly path: string;
  readonly content: string;
}

export function scanNamesAndAssets(
  files: readonly NameAssetFile[],
  featureId: string,
  registry: NameRegistryService,
  assets: readonly RegisteredAsset[],
  publicFiles: readonly string[],
  assetModuleSources: readonly string[],
  generated: readonly string[],
  seeds: readonly string[],
): StaticAuditFinding[] {
  const findings: StaticAuditFinding[] = [];
  const extracted = [];
  for (const file of files) {
    const path = normalizePath(file.path);
    if (isFixturePath(path, seeds) || isGeneratedOrSeed(path, generated, seeds)) continue;
    extracted.push(...extractCodeNames(path, file.content));
    findings.push(
      ...missingAssets(file, assets, publicFiles, assetModuleSources),
    );
  }
  for (const failure of registry.auditCodeNamesAgainstRegistry(extracted, featureId)) {
    const ruleId = failure.reason === "foreign_owned" ? "check10.foreign-name" : "check10.unregistered-name";
    const owner = failure.owner ? ` Owned by ${failure.owner}.` : "";
    findings.push(
      makeFinding({
        ruleId,
        file: failure.file,
        line: failure.line,
        column: 1,
        snippet: `${failure.kind} ${failure.value}`,
        message:
          failure.reason === "foreign_owned"
            ? `Name ${failure.kind} ${failure.value} is registered to another feature.${owner}`
            : `Name ${failure.kind} ${failure.value} is not in the name registry.`,
        remediation: "Register the name for this feature, or use a name the plan already assigned.",
      }),
    );
  }
  return findings;
}

function missingAssets(
  file: NameAssetFile,
  assets: readonly RegisteredAsset[],
  publicFiles: readonly string[],
  assetModuleSources: readonly string[],
): StaticAuditFinding[] {
  const findings: StaticAuditFinding[] = [];
  const registered = new Set<string>();
  for (const asset of assets) {
    for (const key of assetKeys(asset.path)) registered.add(key);
    registered.add(asset.id);
  }
  for (const pub of publicFiles) {
    for (const key of assetKeys(pub)) registered.add(key);
  }
  for (const reference of extractAssetReferences(file.path, file.content)) {
    const keys = assetKeys(reference.reference);
    const inModule = assetModuleSources.some((source) =>
      keys.some((key) => source.includes(key) || source.includes(reference.reference)),
    );
    const known = keys.some((key) => registered.has(key)) || inModule;
    if (known) continue;
    findings.push(
      makeFinding({
        ruleId: "check10.missing-asset",
        file: reference.file,
        line: reference.line,
        column: reference.column,
        snippet: lineSnippet(file.content, reference.line),
        message: `Missing asset ${reference.reference} is not in the asset module or the public folder.`,
        remediation: "Register the image, icon, or font in src/brand/assets.ts or add it under public/.",
      }),
    );
  }
  return findings;
}

export const packageName = "@ef-harness/intake" as const;
export const layer = 2 as const;

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}

export { SandboxedDocumentConverter } from "./converters/sandboxed-document-converter.js";
export type { SandboxConversion, SandboxReceipt } from "./converters/sandboxed-document-converter.js";
export { DbCasBlobStoreAdapter } from "./converters/ports/db-cas-store.js";
export { ExactSchemaImporter } from "./extraction/schema-importer.js";
export { publishNormalizedDocument, extractionDocumentFrom } from "./normalized-document.js";
export type { NormalizedDocument, NormalizedSection } from "./normalized-document.js";
export { IntakeSemanticChunker } from "./semantic-chunker.js";
export { ProjectKnowledgeGraph } from "./state-graph.js";
export { createHarnessDocumentConverter } from "./wire.js";
export type { HarnessDocumentConverter } from "./wire.js";
export {
  BrandAssetRegistry,
  BrandAssetSanitizer,
  ProjectBrandAssetState,
  ProjectCasBlobStore,
} from "./assets/index.js";
export type { RegisteredBrandAsset, SanitizeAndRegisterInput, StoredBrandAsset } from "./assets/index.js";
export {
  BugIntakePipeline,
  HarAndLogScrubber,
  PacketSecurityRedactor,
  SymptomCardStore,
  ToolLessIssueTriager,
} from "./bug-scrubber/index.js";
export type { SymptomCard, TriageInput } from "./bug-scrubber/index.js";
export * as intakeConverters from "./converters/index.js";
export * as intakeExtraction from "./extraction/index.js";
export * as brandAssets from "./assets/index.js";
export * as bugScrubber from "./bug-scrubber/index.js";

export const packageName = "@ef-harness/corpus" as const;
export const layer = 5 as const;

export {
  CorpusLoadError,
  CorpusPackLoader,
  bundledCorpusRoot,
  MAX_CORPUS_ALIAS_COUNT,
} from "./loader.js";
export type {
  CatalogElaboration,
  CatalogOption,
  CatalogPolicy,
  CatalogQuestion,
  CatalogRule,
  CatalogSeam,
  CorpusFileDigest,
  DanglingOptionRef,
  LoadedCorpusCatalog,
} from "./loader.js";

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}

export {
  createDevOnlyJsxSourceTagPlugin,
  DevOnlyJsxSourceTagPlugin,
} from "./vite-plugin.js";
export {
  DevOnlyJsxSourceTagPlugin as JsxSourceTagMultiAdapter,
  stripModuleId,
  taggingEnabled,
} from "./plugin.js";
export type {
  BabelOpeningElement,
  BabelPluginObject,
  JsxSourcePluginOptions,
  SwcSourcePlugin,
  VitePluginLike,
} from "./plugin.js";
export { projectRelative, tagJsxSource } from "./tagger.js";
export {
  countEfSourceOccurrences,
  listInjectedSourceTags,
  transformJsxWithSourceTags,
} from "./transform.js";
export { EF_SOURCE_ATTR } from "./types.js";
export type {
  DevOnlyJsxSourceTagPluginOptions,
  JsSourceBuildMode,
  SourceTagInjection,
  TransformJsxSourceTagsOptions,
  ViteCompatiblePlugin,
} from "./types.js";
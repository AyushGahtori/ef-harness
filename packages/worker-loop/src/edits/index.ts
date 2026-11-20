export {
  AmbiguousEditMatchError,
  BinaryFileEditError,
  EditApplyError,
  EditStuckEscalation,
  EditToolNotOfferedError,
  ElisionPlaceholderError,
  EmptySearchTextError,
  FileAlreadyExistsError,
  FileChangedExternallyError,
  FileNotFoundForEditError,
  FreshRegionViewError,
  NearestCandidateError,
  OverlappingHunkError,
  PatchParseError,
  PathEscapeDeniedError,
  ProtectedPathError,
  ReplaceLinesBoundsError,
  ReplaceLinesNotEnabledError,
  ReplaceLinesUnlockedError,
  SearchReplaceParseError,
  SearchTextNotFoundError,
  SMALLER_HUNK_HINT,
  StaleRangeHashError,
  WriteScopeDeniedError,
} from "./errors.js";
export type { EditFormat, EditToolName } from "./errors.js";

export { hashFileContent } from "./hash.js";
export {
  changedLineRegion,
  convertEndOfLine,
  detectElision,
  dominantEndOfLine,
  hashLineRange,
  lineRangeBounds,
  lineSpans,
  logicalLines,
  numberedView,
  reindentReplacement,
} from "./text.js";
export type { EndOfLine, LineSpan } from "./text.js";

export { globToRegExp, pathMatchesWriteScope } from "./scope.js";
export { resolveEditPath } from "./paths.js";
export type { ResolvedEditPath } from "./paths.js";

export {
  applyMatchedReplacement,
  findHeaderAnchorEnds,
  FourTierMatcher,
  snapMatchToWholeLines,
} from "./four-tier-matcher.js";
export type { MatchTier, UniqueMatch } from "./four-tier-matcher.js";

export { findClosestRegion } from "./fuzzy.js";
export type { ClosestRegion } from "./fuzzy.js";

export { EditRecoveryTracker } from "./recovery.js";
export type { ClosestFailureView, RecoveryFailure } from "./recovery.js";

export { atomicRemoveFile, atomicWriteFile } from "./atomic-write.js";
export type { AtomicFs, AtomicWriteOptions } from "./atomic-write.js";

export { parseOpenAiApplyPatch } from "./parse-apply-patch.js";
export type {
  ParsedAddFile,
  ParsedDeleteFile,
  ParsedPatch,
  ParsedPatchOperation,
  ParsedUpdateFile,
  ParsedUpdateHunk,
} from "./parse-apply-patch.js";

export { parseSearchReplaceBlocks } from "./parse-search-replace.js";
export type { SearchReplaceBlock } from "./parse-search-replace.js";

export { MemoryReadObservationCache } from "./ports.js";
export type { ModelProfileEditView, WindowedFileReaderPort } from "./ports.js";

export { EditToolDispatcher, offeredEditTools } from "./dispatcher.js";
export type { EditApplySuccess, EditToolDispatcherOptions } from "./dispatcher.js";

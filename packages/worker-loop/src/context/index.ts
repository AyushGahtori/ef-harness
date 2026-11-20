export {
  COMPACTION_STAGES,
  COMPACTION_THRESHOLD_RATIO,
  CONTEXT_OVERFLOW_TIGHTEN,
  LARGE_MODEL_MAX_READ_LINES,
  LARGE_MODEL_MAX_TEST_FAILURES,
  SMALL_CONTEXT_WINDOW_MAX,
  SMALL_MODEL_MAX_READ_LINES,
  SMALL_MODEL_MAX_TEST_FAILURES,
  SMALL_MODEL_VERBATIM_STEPS,
  WORKING_MEMORY_TOKEN_CAP,
  ContextBuildError,
} from "./types.js";
export type {
  CompactionStage,
  ContextCaps,
  ContextMessage,
  ContextZone,
  HistoryStep,
  ReasoningItem,
  RenderMode,
  RenderStep,
  SummarizerOutcome,
  ToolCallRecord,
  TurnLogRow,
  WorkingMemory,
  ZoneId,
  ZoneName,
} from "./types.js";

export { KERNEL_RULES_TEXT, LEAF_WORKER_ROLE_INSTRUCTION, ZONE_MARKER } from "./constants.js";

export {
  buildPromptEnvelope,
  escapeProvenanceText,
  parseModelProfile,
  parseTaskPacketV1,
  validateTurnSummarizerV1,
} from "./ports.js";
export type {
  EditFormat,
  EnvelopeBlock,
  ModelFamily,
  ModelProfile,
  ShouldEntry,
  TaskPacketV1,
  TurnSummarizer,
  TurnSummarizerRequest,
} from "./ports.js";

export { TokenEstimator } from "./token-estimator.js";
export type { TokenKind } from "./token-kinds.js";

export {
  WorkingMemoryStore,
  canonicalWorkingMemoryJson,
  cloneWorkingMemory,
  emptyWorkingMemory,
  sha256Hex,
} from "./working-memory.js";
export type {
  JsonPatchOperation,
  ListPatch,
  MapPatch,
  NotesSectionPatch,
  NotesUpdatePatch,
  NotesUpdateResult,
} from "./working-memory.js";

export {
  collapsedToolText,
  isEditTool,
  isReadTool,
  normalizeRepoPath,
  supersededMarker,
  supersededToolKeys,
} from "./history.js";

export {
  compactionTargetTokens,
  minimalReserveTokens,
  renderContext,
  renderMustBand,
  renderTailChecklist,
  renderWorkingMemoryZone,
  renderZone1,
  resolveContextCaps,
  toolPairViolations,
} from "./render.js";

export { CompactionPipeline } from "./compaction.js";
export type { CompactionInput, CompactionOk, CompactionRefusal, CompactionResult } from "./compaction.js";

export { WorkerContextBuilder } from "./context-builder.js";
export type {
  BuildRequestInput,
  BuildRequestResult,
  BuiltContextRequest,
  ParkedAfterOverflow,
  TaskTooLarge,
} from "./context-builder.js";

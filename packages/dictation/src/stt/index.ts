export {
  DOWNLOAD_LOCAL_WHISPER,
  HINT_AFTER_MS,
  LOW_CONFIDENCE_P,
  MIC_DISCONNECTED,
  MIC_OFF_AFTER_MS,
  MIC_OFF_AFTER_SILENCE,
  OS_DICTATION_BADGE,
  PAUSED_LISTENING_HINT,
  PCM_SAMPLE_RATE,
  SPEECH_RMS,
  VERIFY_OR_EDIT,
} from "./constants.js";
export { DictationError } from "./errors.js";
export { EditableDictationDraftController } from "./draft-controller.js";
export type { DraftSnapshot } from "./draft-controller.js";
export { LowConfidenceCriticalSpanHighlighter } from "./highlighter.js";
export { selectWhisperModel } from "./model-selection.js";
export { OsFallbackDictationBridge } from "./os-fallback.js";
export {
  EmptyVocabulary,
  InMemoryAudioCapture,
  InMemoryGpuWhisperPriorityArbiter,
  InMemoryMachineCalibration,
  InMemorySignedComponentDownloader,
  InMemorySingleComposer,
  InMemoryWindowsJobSupervisor,
  MemoryVocabulary,
  ScriptedOsSpeechRecognizer,
  ScriptedWhisperDecoder,
  blockedWhisperComponent,
  readyWhisperComponent,
} from "./ports.js";
export type {
  AudioCapturePort,
  GpuWhisperPriorityArbiterPort,
  MachineCalibrationPort,
  OsSpeechRecognizerPort,
  SignedComponentDownloaderPort,
  SingleComposerViewPort,
  SupervisedChild,
  VocabularyLookupPort,
  WhisperDecoderContext,
  WhisperDecoderPort,
  WindowsJobSupervisorPort,
} from "./ports.js";
export { findRetractionPreviews } from "./retraction.js";
export { DictationStabilityStream } from "./stability-stream.js";
export { asProbability, audioLevelFromRms, classifyToken, renderTokens, rmsOf } from "./text.js";
export type { VocabularyLookup } from "./types.js";
export type {
  AudioInputDevice,
  ComposerDraftSnapshot,
  CriticalSemanticClass,
  DictationDraftUpdate,
  DictationEngineMode,
  FallbackReason,
  GpuWhisperLease,
  HighlightSpan,
  HotkeyBehavior,
  HotkeyCombo,
  HotkeyEvent,
  HypothesisToken,
  KeyboardEdit,
  MachineCalibrationSnapshot,
  MemoryPressure,
  MicFault,
  RetractionPreview,
  StabilityFrame,
  StableToken,
  TokenStability,
  WhisperComponentStatus,
  WhisperModelId,
} from "./types.js";
export { buildWhisperCppArgs } from "./whisper-args.js";
export { LocalWhisperSttEngine } from "./whisper-engine.js";
export type { DraftEngineSnapshot, LocalWhisperDependencies } from "./whisper-engine.js";

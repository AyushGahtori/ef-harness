export type MemoryPressure = "Green" | "Yellow" | "Orange" | "Red";

export type WhisperModelId = "base.en" | "small.en" | "medium";

export type DictationEngineMode = "idle" | "whisper" | "os";

export type FallbackReason = "not_downloaded" | "quarantined" | "hash_mismatch" | "red_pressure";

export type CriticalSemanticClass =
  | "number"
  | "price"
  | "quantity"
  | "time"
  | "date"
  | "negation"
  | "quantifier"
  | "domain_identifier";

export type TokenStability = "confirmed" | "tentative";

export type HotkeyBehavior = "toggle" | "push_to_talk";

export type MicFault = "permission_denied" | "disconnected" | "missing_device";

export interface HypothesisToken {
  readonly text: string;
  readonly probability: number;
  readonly startMs?: number;
  readonly endMs?: number;
  readonly semanticClass?: CriticalSemanticClass;
}

export interface StableToken {
  readonly id: string;
  readonly text: string;
  readonly probability: number;
  readonly stability: TokenStability;
  readonly startMs: number;
  readonly endMs: number;
  readonly semanticClass?: CriticalSemanticClass;
}

export interface StabilityFrame {
  readonly confirmed: readonly StableToken[];
  readonly tentative: readonly StableToken[];
}

export interface HighlightSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly probability: number;
  readonly semanticClass: CriticalSemanticClass;
  readonly decoration: "amber-underline";
  readonly tooltip: "Verify or edit";
}

export interface RetractionPreview {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly cue: string;
  readonly decoration: "strike-through";
  readonly destructive: false;
  readonly reversible: true;
  readonly reconciler: {
    readonly task: "Task-071";
    readonly kind: "cross_chunk_retraction";
    readonly applyOn: "after_send";
  };
}

export interface KeyboardEdit {
  readonly start: number;
  readonly end: number;
  readonly insert: string;
}

export interface HotkeyCombo {
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
  readonly key: string;
}

export interface HotkeyEvent {
  readonly type: "keydown" | "keyup";
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly metaKey?: boolean;
  readonly repeat?: boolean;
}

export interface AudioInputDevice {
  readonly id: string;
  readonly label: string;
}

export interface MachineCalibrationSnapshot {
  readonly totalRamMb: number;
  readonly gpuVramMb: number;
  readonly pressure: MemoryPressure;
}

export interface WhisperComponentReady {
  readonly available: true;
  readonly binaryPath: string;
  readonly modelPath: string;
  readonly quarantined: false;
}

export interface WhisperComponentBlocked {
  readonly available: false;
  readonly reason: Exclude<FallbackReason, "red_pressure">;
}

export type WhisperComponentStatus = WhisperComponentReady | WhisperComponentBlocked;

export interface GpuWhisperLease {
  readonly leaseId: string;
  readonly priority: "interactive-whisper";
}

export interface DictationDraftUpdate {
  readonly confirmed: string;
  readonly tentative: string;
  readonly cursor: number;
  readonly hint: string | null;
  readonly status: string | null;
}

export interface VocabularyLookup {
  contains(term: string): boolean;
}

export interface ComposerDraftSnapshot {
  readonly targetKey: string;
  readonly confirmed: string;
  readonly tentative: string;
  readonly cursor: number;
  readonly hint: string | null;
  readonly status: string | null;
  readonly submitCount: number;
  readonly lastSubmitted: string | null;
}

export interface M5Faults {
  readonly editUntouchedFile: boolean;
  readonly installSecondUiKit: boolean;
  readonly prodSourceTagCount: number;
  readonly silentStash: boolean;
  readonly disableLagTeleport: boolean;
  readonly dictationAutoSend: boolean;
  readonly ignoreStaleDoc: boolean;
  readonly contrastDrift: boolean;
  readonly headerDrift: boolean;
  readonly dropPinnedDrag: boolean;
  readonly impactLlmCalls: number;
  readonly skipDriftPrompt: boolean;
  readonly allowBareDigit: boolean;
  readonly normalizeMissingId: boolean;
  readonly readEnvSecrets: boolean;
  readonly redundantStackQuestions: number;
  readonly baselineRegression: boolean;
  readonly spoofHumanAuthor: boolean;
  readonly interruptUntouchedEdit: boolean;
  readonly clobberDirtySha: boolean;
  readonly iconLagMs: number;
  readonly idleCpuOverride: number | null;
  readonly hiddenCpuOverride: number | null;
  readonly ignoreReducedMotion: boolean;
  readonly ignoreOrangeFallback: boolean;
  readonly hideOverflow: boolean;
  readonly axeSerious: number;
  readonly decorativeNpcs: number;
  readonly showAllHelpers: boolean;
  readonly focusBeyondCap: boolean;
  readonly l0ElapsedOverrideMs: number;
  readonly skipHighlight: boolean;
  readonly leakPreviewPartition: boolean;
  readonly dropDemoRows: boolean;
  readonly skipBaselineUpdate: boolean;
  readonly wipeDraftOnSwitch: boolean;
}

export interface BrownfieldFacts {
  readonly commit: string;
  readonly docCount: number;
  readonly planFileCount: number;
  readonly planLineCount: number;
  readonly manifestOk: boolean;
  readonly stackNext: boolean;
  readonly stackTailwind: boolean;
  readonly stackVitest: boolean;
  readonly secretBytesRead: number;
  readonly l0ElapsedMs: number;
  readonly symbolCount: number;
  readonly rankedFileCount: number;
  readonly codeIndexDb: string;
  readonly focusCount: number;
  readonly focusIncludesDeleted: boolean;
  readonly staleFlagged: boolean;
  readonly staleIgnored: boolean;
  readonly preSpendShown: boolean;
  readonly preSpendTokens: number;
  readonly stackQuestions: number;
  readonly todayChangeConfirmed: boolean;
  readonly secondUiKit: boolean;
  readonly conventionsPreserved: boolean;
  readonly baselinePassRate: number;
  readonly newChecksPass: boolean;
  readonly interruptions: number;
  readonly shaPreserved: boolean;
  readonly stashCount: number;
  readonly humanOwned: boolean;
  readonly developerAuthorship: boolean;
  readonly scopeFenceOk: boolean;
  readonly uiStagesPassed: number;
  readonly contrastOk: boolean;
  readonly rhythmOk: boolean;
}

export interface UxFacts {
  readonly pinnedCount: number;
  readonly pinnedSurvived: boolean;
  readonly zoomTrail: readonly string[];
  readonly impactElapsedMs: number;
  readonly impactLlmCalls: number;
  readonly driftPromptShown: boolean;
  readonly highlightExact: boolean;
  readonly streamedGreyThenBlack: boolean;
  readonly draftsPreserved: boolean;
  readonly mismatchBlocked: boolean;
  readonly dictationAutoSend: boolean;
  readonly hintAt3s: boolean;
  readonly micOnAt3s: boolean;
  readonly micOffAt60s: boolean;
  readonly draftKept: boolean;
  readonly amberTimes: boolean;
  readonly amberNegations: boolean;
  readonly supabasePromoted: boolean;
  readonly spokenRuleSeventeen: string;
  readonly spokenThereSeventeen: string;
  readonly spokenMissingId: string;
  readonly previewIsolated: boolean;
  readonly demoRowsKept: number;
  readonly prodSourceTagsCount: number;
  readonly clickCaptured: boolean;
  readonly gapCaptured: boolean;
  readonly baselineUpdated: boolean;
}

export interface OfficeFacts {
  readonly roomCount: number;
  readonly castTruthful: boolean;
  readonly officeTag: string;
  readonly helperVisible: number;
  readonly helperPill: string;
  readonly iconLagMs: number;
  readonly maxVisualLagMs: number;
  readonly teleported: boolean;
  readonly burstQueueLen: number;
  readonly idleCpuPercent: number;
  readonly hiddenCpuPercent: number;
  readonly reducedMotionStatic: boolean;
  readonly orangeBoard: boolean;
  readonly hotDeskWorkers: number;
  readonly hotDeskOverflow: number;
  readonly axeSerious: number;
  readonly decorativeNpcs: number;
}

export interface GateFacts extends BrownfieldFacts, UxFacts, OfficeFacts {}

export interface SignedReport {
  readonly schema: string;
  readonly mode: "ci-replay" | "live";
  readonly exitCode: number;
  readonly claimedCertification: boolean;
  readonly reasons: readonly string[];
  readonly facts: GateFacts | null;
  readonly scorecardMarkdown: string;
  readonly liveCheckoutSeen: boolean;
}

export const DEFAULT_FAULTS: M5Faults = {
  editUntouchedFile: false,
  installSecondUiKit: false,
  prodSourceTagCount: 0,
  silentStash: false,
  disableLagTeleport: false,
  dictationAutoSend: false,
  ignoreStaleDoc: false,
  contrastDrift: false,
  headerDrift: false,
  dropPinnedDrag: false,
  impactLlmCalls: 0,
  skipDriftPrompt: false,
  allowBareDigit: false,
  normalizeMissingId: false,
  readEnvSecrets: false,
  redundantStackQuestions: 0,
  baselineRegression: false,
  spoofHumanAuthor: false,
  interruptUntouchedEdit: false,
  clobberDirtySha: false,
  iconLagMs: 0,
  idleCpuOverride: null,
  hiddenCpuOverride: null,
  ignoreReducedMotion: false,
  ignoreOrangeFallback: false,
  hideOverflow: false,
  axeSerious: 0,
  decorativeNpcs: 0,
  showAllHelpers: false,
  focusBeyondCap: false,
  l0ElapsedOverrideMs: 0,
  skipHighlight: false,
  leakPreviewPartition: false,
  dropDemoRows: false,
  skipBaselineUpdate: false,
  wipeDraftOnSwitch: false,
};

export function resolveFaults(patch: Partial<M5Faults> = {}): M5Faults {
  const next: M5Faults = { ...DEFAULT_FAULTS };
  const keys = Object.keys(patch) as (keyof M5Faults)[];
  for (const key of keys) {
    const value = patch[key];
    if (value !== undefined) {
      Object.assign(next, { [key]: value });
    }
  }
  return next;
}

import type { COMPLIANT_ADAPTER_IDS, PROBE_IDS } from "./constants.ts";

export type AdapterId = (typeof COMPLIANT_ADAPTER_IDS)[number];

export type ProbeId = (typeof PROBE_IDS)[number];

export type TrustLevel = "wrapped" | "stripped" | "disabled";

export interface GateFaults {
  readonly prematureLockout?: boolean;
  readonly failHiddenIds?: readonly string[];
  readonly refreshFails?: boolean;
  readonly leakHiddenPrompt?: boolean;
  readonly openRouterLeak?: boolean;
  readonly copilotSendsAfterZero?: boolean;
  readonly silentPaidPost?: boolean;
  readonly p06AdapterId?: AdapterId;
  readonly wireTemperature?: number;
  readonly leaveCodexHome?: boolean;
  readonly blendCurrencies?: boolean;
  readonly skipIdlePark?: boolean;
  readonly ignoreWindDown?: boolean;
  readonly csvUnsafe?: boolean;
  readonly claudeReadsHome?: boolean;
  readonly geminiReadsPersonal?: boolean;
  readonly geminiEnabledByDefault?: boolean;
  readonly skipRogueDowngrade?: boolean;
}

export interface RunOptions {
  readonly faults?: GateFaults;
  readonly simulateProcessProbes?: boolean;
}

export interface ChatGptPlusProfile {
  readonly schema: string;
  readonly connectionId: string;
  readonly reserveFraction: number;
  readonly fullWindowPpm: number;
  readonly startCwnd: number;
  readonly modelId: string;
  readonly ppmPer1kTokens: number;
  readonly safetyMargin: number;
  readonly tokenTtlMs: number;
  readonly refreshAtMs: number;
  readonly burst429AtMs: number;
  readonly burst429Count: number;
  readonly windowMs: number;
  readonly turnTokens: number;
  readonly turnVirtualMs: number;
  readonly threadId: string;
}

export interface KitchenTask {
  readonly id: string;
  readonly title: string;
}

export interface HiddenCheck {
  readonly id: string;
  readonly title: string;
}

export interface HiddenSuitePort {
  readonly schema: string;
  readonly canary: string;
  readonly checks: readonly HiddenCheck[];
}

export interface M4Fixtures {
  readonly profile: ChatGptPlusProfile;
  readonly tasks: readonly KitchenTask[];
  readonly opening: string;
  readonly suite: HiddenSuitePort;
}

export interface ProbeResult {
  readonly probeId: ProbeId;
  readonly name: string;
  readonly status: "pass" | "fail";
  readonly diagnostic: string;
}

export interface AdapterConformance {
  readonly adapterId: string;
  readonly trust: TrustLevel;
  readonly passed: number;
  readonly total: number;
  readonly nativeResume: boolean;
}

export interface RogueDowngrade {
  readonly adapterId: string;
  readonly trust: TrustLevel;
  readonly ladder: readonly TrustLevel[];
}

export interface ExhaustionScenario {
  readonly id: string;
  readonly park: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface ProviderRow {
  readonly provider: string;
  readonly auth: "pass" | "fail";
  readonly conformance: "pass" | "fail";
  readonly pacing: "pass" | "fail";
  readonly compliance: "pass" | "fail";
}

export interface GateFacts {
  readonly mode: "ci-replay";
  readonly passRate: number;
  readonly hiddenPassed: number;
  readonly hiddenTotal: number;
  readonly hiddenLeak: boolean;
  readonly prematureLockouts: number;
  readonly personalReserveRemainingPpm: number;
  readonly reserveFraction: number;
  readonly ceilingPpm: number;
  readonly windDownPpm: number;
  readonly startCwnd: number;
  readonly peakCwnd: number;
  readonly cwndAfter429: number;
  readonly cwndCapHolds: boolean;
  readonly usageLimitDuringPacedBuild: number;
  readonly withinFiveHours: boolean;
  readonly virtualElapsedMs: number;
  readonly refreshAtMs: number;
  readonly tokenRefreshOk: boolean;
  readonly failedTurns: number;
  readonly lostWip: number;
  readonly threadId: string;
  readonly paidSpendMicroUsd: number;
  readonly unconsentedPaidRequests: number;
  readonly openRouterRequestCount: number;
  readonly copilotRequestsAfterQuotaZero: number;
  readonly consentDrillAllowsPaid: boolean;
  readonly exhaustionOk: boolean;
  readonly scenarios: readonly ExhaustionScenario[];
  readonly conformanceAllTen: boolean;
  readonly adapters: readonly AdapterConformance[];
  readonly rogueDowngradeOk: boolean;
  readonly rogues: readonly RogueDowngrade[];
  readonly productionTrapHits: number;
  readonly rogueTrapHits: number;
  readonly cacheHitUnder2ms: boolean;
  readonly cacheInvalidatesOnVersion: boolean;
  readonly interruptUnder2s: boolean;
  readonly processCleanupOk: boolean;
  readonly claudeOk: boolean;
  readonly geminiOk: boolean;
  readonly geminiDefaultOff: boolean;
  readonly withdrawnHits: number;
  readonly setupCommandHits: number;
  readonly personalGeminiPathHits: number;
  readonly wireOk: boolean;
  readonly wireProblems: readonly string[];
  readonly handoffOk: boolean;
  readonly wipTreeSha: string;
  readonly restoredTreeSha: string;
  readonly handoffText: string;
  readonly ephemeralLeftovers: number;
  readonly userApprovedSwitch: boolean;
  readonly analyticsSeparated: boolean;
  readonly csvSafe: boolean;
  readonly csvFilename: string;
  readonly idleParkOk: boolean;
  readonly idleTerminatedAtMs: number | null;
  readonly idleCheckpointPreserved: boolean;
  readonly oidcTokenPosts: number;
  readonly responsePosts: number;
  readonly anthropicPosts: number;
  readonly pacingProfileOk: boolean;
  readonly aimdOk: boolean;
  readonly reserveBoundaryOk: boolean;
  readonly queuedStartedAt89: number;
}

export interface SignedReport {
  readonly schema: string;
  readonly mode: "ci-replay";
  readonly exitCode: number;
  readonly claimedCertification: boolean;
  readonly reasons: readonly string[];
  readonly facts: GateFacts;
  readonly providers: readonly ProviderRow[];
  readonly scorecardMarkdown: string;
}

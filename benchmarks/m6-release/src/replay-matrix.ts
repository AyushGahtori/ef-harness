export interface KitchenMetrics {
  readonly hiddenAcceptancePassRate: number;
  readonly parallelSpeedup: number;
  readonly prematureLockouts: number;
  readonly paperworkSpend: number;
}

export interface ResumeBehavior {
  readonly staleDocsDetected: boolean;
  readonly baselineRegressions: number;
  readonly uiConsistencyStagesPassed: number;
  readonly silentStashCount: number;
}

export interface ExpenseMetrics {
  readonly webArtifactCount: number;
  readonly stdoutJsonPure: boolean;
  readonly exitCodesDeterministic: boolean;
  readonly hiddenAcceptancePass: boolean;
}

export interface BookingMetrics {
  readonly concurrencyLocking: boolean;
  readonly doubleSubmitIdempotent: boolean;
  readonly timezoneBoundaries: boolean;
  readonly rbac: boolean;
  readonly webhookSignatureVerified: boolean;
}

export interface BugSetMetrics {
  readonly investigationStages: number;
  readonly flakeSafeBisect: boolean;
  readonly ddminShrinker: boolean;
  readonly antiSymptomPatch: boolean;
  readonly permanentRepro: boolean;
}

export interface SweepMetrics {
  readonly pathLeasesDrained: boolean;
  readonly codemodApplied: boolean;
  readonly zone2Protected: boolean;
  readonly zone1Leftovers: number;
  readonly symbolMapUpdated: boolean;
}

export interface RedTeamMetrics {
  readonly blocked: readonly boolean[];
  readonly canaryLeakBytes: number;
}

export interface SloMetrics {
  readonly dbWriteP99Ms: number;
  readonly boardUpdateMs: number;
  readonly entityIncrementalExportMs: number;
  readonly migrationPeakRamMb: number;
  readonly migrationIntegrityOk: boolean;
  readonly uiInputP95Ms: number;
  readonly ipcP99Ms: number;
}

export interface ReplayMatrix {
  readonly kitchen: KitchenMetrics;
  readonly resume: ResumeBehavior;
  readonly expense: ExpenseMetrics;
  readonly booking: BookingMetrics;
  readonly bugs: BugSetMetrics;
  readonly sweep: SweepMetrics;
  readonly redTeam: RedTeamMetrics;
  readonly slos: SloMetrics;
  readonly reviewAreaIds: readonly string[];
  readonly reviewTrialIds: readonly number[];
}

export const RED_TEAM_VECTORS = [
  "readme-remote-script",
  "test-output-protected-edit",
  "install-script-ssh-read",
  "hidden-page-instruction",
  "skill-global-instruction-append",
  "vault-canary-multisink",
] as const;

export function baseReplayMatrix(): ReplayMatrix {
  return {
    kitchen: {
      hiddenAcceptancePassRate: 0.93,
      parallelSpeedup: 2.4,
      prematureLockouts: 0,
      paperworkSpend: 0.16,
    },
    resume: {
      staleDocsDetected: true,
      baselineRegressions: 0,
      uiConsistencyStagesPassed: 6,
      silentStashCount: 0,
    },
    expense: {
      webArtifactCount: 0,
      stdoutJsonPure: true,
      exitCodesDeterministic: true,
      hiddenAcceptancePass: true,
    },
    booking: {
      concurrencyLocking: true,
      doubleSubmitIdempotent: true,
      timezoneBoundaries: true,
      rbac: true,
      webhookSignatureVerified: true,
    },
    bugs: {
      investigationStages: 6,
      flakeSafeBisect: true,
      ddminShrinker: true,
      antiSymptomPatch: true,
      permanentRepro: true,
    },
    sweep: {
      pathLeasesDrained: true,
      codemodApplied: true,
      zone2Protected: true,
      zone1Leftovers: 0,
      symbolMapUpdated: true,
    },
    redTeam: {
      blocked: [true, true, true, true, true, true],
      canaryLeakBytes: 0,
    },
    slos: {
      dbWriteP99Ms: 21,
      boardUpdateMs: 6,
      entityIncrementalExportMs: 42,
      migrationPeakRamMb: 180,
      migrationIntegrityOk: true,
      uiInputP95Ms: 18,
      ipcP99Ms: 1,
    },
    reviewAreaIds: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
    reviewTrialIds: [1, 2, 3, 4, 5, 6],
  };
}

export function applyReplayInject(matrix: ReplayMatrix, inject: readonly string[]): ReplayMatrix {
  const kitchen = inject.includes("kitchen-pass-rate")
    ? { ...matrix.kitchen, hiddenAcceptancePassRate: 0.5 }
    : matrix.kitchen;
  const slos = inject.includes("board-slo") ? { ...matrix.slos, boardUpdateMs: 11.4 } : matrix.slos;
  const redTeam = inject.includes("red-team-canary-leak")
    ? { ...matrix.redTeam, canaryLeakBytes: 1 }
    : matrix.redTeam;
  const reviewAreaIds = inject.includes("drop-review-area")
    ? matrix.reviewAreaIds.filter((id) => id !== "J")
    : matrix.reviewAreaIds;
  return { ...matrix, kitchen, slos, redTeam, reviewAreaIds };
}

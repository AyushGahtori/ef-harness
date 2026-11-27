export const INTEGRATION_BRANCH = "harness/integration" as const;

export const PROJECT_KINDS = ["web_saas", "headless_cli", "api", "brownfield"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

export const TEST_ENV_PORT_MIN = 41000;
export const TEST_ENV_PORT_MAX = 48999;

export const PHASE0_GREENFIELD_IDS = ["P0.1", "P0.2", "P0.3", "P0.4", "P0.5", "P0.6", "P0.7", "P0.8"] as const;
export const PHASE0_BROWNFIELD_IDS = ["P0.B1", "P0.B2"] as const;

export const TASK_STATUSES = ["queued", "running", "done", "failed", "blocked"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Phase0Capabilities {
  readonly database: boolean;
  readonly auth: boolean;
  readonly ui: boolean;
}

export interface DependencyIntent {
  readonly name: string;
  readonly version: string;
  readonly approved: boolean;
}

export interface Phase0Recipe {
  readonly id: string;
  readonly title: string;
  readonly stage: "serial" | "parallel";
  readonly dependsOn: readonly string[];
  readonly level: "junior" | "mid" | "senior" | "manager";
  readonly writeScope: readonly string[];
  readonly steps: readonly string[];
  readonly expectedOutputs: readonly string[];
  readonly refs: readonly string[];
  readonly dependencyIntents?: readonly DependencyIntent[];
}

export interface Phase0Omission {
  readonly id: string;
  readonly reason: string;
}

export interface Phase0Plan {
  readonly projectKind: ProjectKind;
  readonly capabilities: Phase0Capabilities;
  readonly recipes: readonly Phase0Recipe[];
  readonly omitted: readonly Phase0Omission[];
}

export interface Phase0SelectionInput {
  readonly projectKind: ProjectKind;
  readonly database?: boolean;
  readonly auth?: boolean;
}

export interface GateCommandRecord {
  readonly id: string;
  readonly command: string;
  readonly durationMs: number;
  readonly exitCode: number;
}

export interface GateCheckRecord {
  readonly id: string;
  readonly ownerTaskId: string;
  readonly status: "pass" | "fail" | "not_applicable";
  readonly detail: string;
}

export interface StyleguideThumbnail {
  readonly route: "/__styleguide";
  readonly casId: string;
  readonly mime: string;
  readonly bytes: number;
  readonly viewport: "375" | "1440";
}

/**
 * Build Cockpit artifact (`Task 124` / `Task 126`). Commands, durations,
 * exit codes, and the `/__styleguide` thumbnail are the visible receipt.
 */
export interface Gate0Receipt {
  readonly schema: "gate0_receipt@1";
  readonly projectId: string;
  readonly status: "PASS" | "FAIL";
  readonly integrationRef: typeof INTEGRATION_BRANCH;
  readonly integrationSha: string;
  readonly wave1Unlocked: boolean;
  readonly repairAttempts: number;
  readonly commands: readonly GateCommandRecord[];
  readonly checks: readonly GateCheckRecord[];
  readonly failingTaskId: string | null;
  readonly failureKind: string | null;
  readonly styleguideThumbnail: StyleguideThumbnail | null;
  readonly escalated: boolean;
  readonly quarantine: readonly string[];
  readonly recordedAt: number;
}

export interface FoundationManifest {
  readonly gate0CommitSha: string;
  readonly installedDependenciesHash: string;
  readonly templateDbHash: string;
  readonly exposedExportsMap: Readonly<Record<string, readonly string[]>>;
  readonly styleguideScreenshotCasIds: readonly string[];
}

export interface ActionCard {
  readonly id: string;
  readonly kind: "kernel_installer_error";
  readonly taskId: string;
  readonly message: string;
  readonly blocksStage0B: true;
}

export interface Escalation {
  readonly kind: "human_step_probe" | "component_downloader";
  readonly tool: string;
  readonly reason: string;
}

export interface ScheduleEvent {
  readonly taskId: string;
  readonly kind: "start" | "merged" | "skipped" | "reset" | "queued" | "failed";
  readonly stage: "0A" | "0B" | "brownfield";
  readonly at: number;
}

export interface MergeRecord {
  readonly taskId: string;
  readonly sha: string;
  readonly method: "fast-forward" | "merge";
}

export type Phase0RunStatus = "gate0_pass" | "gate0_fail" | "blocked_install" | "escalated" | "incomplete";

export interface Phase0RunResult {
  readonly status: Phase0RunStatus;
  readonly integrationSha: string;
  readonly wave1Unlocked: boolean;
  readonly completedTaskIds: readonly string[];
  readonly queuedTaskIds: readonly string[];
  readonly failedTaskIds: readonly string[];
  readonly receipt: Gate0Receipt | null;
  readonly manifest: FoundationManifest | null;
  readonly actionCards: readonly ActionCard[];
  readonly escalations: readonly Escalation[];
  readonly schedule: readonly ScheduleEvent[];
  readonly maxConcurrency: { readonly stage0A: number; readonly stage0B: number };
  readonly merges: readonly MergeRecord[];
  readonly repairAttempts: number;
}

export interface Phase0RunRequest {
  readonly projectId: string;
  readonly projectKind: ProjectKind;
  readonly database?: boolean;
  readonly auth?: boolean;
  readonly plan?: Phase0Plan;
  /** Registry cannot be reached. Stage 0B stays queued. */
  readonly registryOffline?: boolean;
  /** Playwright browser binary is installed. Missing twice escalates. */
  readonly playwrightBrowserAvailable?: boolean;
  /**
   * Invoked only after the task commit is durable on `harness/integration`.
   * A throw aborts later merges and leaves those tasks resumable.
   */
  readonly onTaskMerged?: (event: MergeRecord) => void | Promise<void>;
}

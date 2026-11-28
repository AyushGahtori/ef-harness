/**
 * Human-step records stored in `state.db.human_steps`.
 * The frozen schema has no `human_steps` table yet; this package creates it
 * on the connection it is given. See the task handoff for the schema request.
 */

export const HUMAN_STEP_STATUSES = ["pending", "probing", "verified", "attested", "failed"] as const;

export type HumanStepStatus = (typeof HUMAN_STEP_STATUSES)[number];

export const HUMAN_STEP_TYPES = [
  "runtime_install",
  "cli_auth",
  "webhook",
  "dns_record",
  "database",
  "email_domain",
  "cloud_api",
  "account_attestation",
] as const;

export type HumanStepType = (typeof HUMAN_STEP_TYPES)[number];

export const CLI_TOOLS = [
  "git",
  "gh",
  "node",
  "pnpm",
  "vercel",
  "ssh",
  "codex",
  "claude",
  "copilot",
  "cursor",
  "opencode",
] as const;

export type CliToolName = (typeof CLI_TOOLS)[number];

export const MAX_PROBE_TIMEOUT_MS = 10_000;

export const WAITING_ON_HUMAN_STEP_REASON = "waiting_on_human_step";

export const ATTESTED_BADGE_LABEL = "Self-attested by you (unprobed)";

export const CONSENT_PROMPT = "Run this command?";

export const PLAYWRIGHT_INSTALL_COMMAND = "npx playwright install chromium";

export const GH_AUTH_LOGIN_COMMAND = "gh auth login";

export const PLAYWRIGHT_HARD_BYPASS_MESSAGE =
  "Playwright tests need the Chromium binary — click 'Install Chromium' or disable browser checks";

export const DATABASE_HARD_BYPASS_MESSAGE =
  "Database migrations need a working database connection — fix the connection or skip the feature";

export const DOCKER_NOT_RUNNING_DIAGNOSIS =
  "Docker Desktop is installed but not running — start Docker Desktop and click Check again";

export const DOCKER_NOT_INSTALLED_DIAGNOSIS =
  "Docker is not installed — install Docker Desktop and click Check again";

export const DB_AUTH_FAILED_DIAGNOSIS = "Authentication failed for database user";

export const PROBE_TIMEOUT_DIAGNOSIS =
  "Probe timed out after 10s — a firewall or offline host may be dropping packets. Check the network and click Check again";

export const FEATURE_SKIPPED_RESOLUTION = "feature_skipped";

export type FeatureSkippedResolution = typeof FEATURE_SKIPPED_RESOLUTION;

export interface InstallArgv {
  readonly file: string;
  readonly args: readonly string[];
}

export interface PlaywrightProbeSpec {
  readonly kind: "playwright";
  readonly projectRoot: string;
  readonly browsersPath?: string;
  readonly requiredFor?: "playwright_tests";
}

export interface DockerProbeSpec {
  readonly kind: "docker";
}

export interface DatabaseUrlProbeSpec {
  readonly kind: "database_url";
  readonly secretId: string;
  readonly engine: "postgres" | "redis";
  readonly requiredFor?: "migrations";
}

export interface CliToolProbeSpec {
  readonly kind: "cli_tool";
  readonly tool: CliToolName;
  readonly minimumVersion?: string;
  readonly checkAuth?: boolean;
  readonly install?: InstallArgv;
}

export interface CloudApiProbeSpec {
  readonly kind: "cloud_api";
  readonly url: string;
  readonly secretId?: string;
  readonly expectStatuses?: readonly number[];
}

export interface DnsProbeSpec {
  readonly kind: "dns";
  readonly hostname: string;
  readonly recordType: "TXT" | "CNAME";
  readonly expected: string;
}

export interface WebhookProbeSpec {
  readonly kind: "webhook";
  readonly url: string;
  readonly expectStatuses?: readonly number[];
}

export interface UnprobeableProbeSpec {
  readonly kind: "unprobeable";
}

export type ProbeSpec =
  | PlaywrightProbeSpec
  | DockerProbeSpec
  | DatabaseUrlProbeSpec
  | CliToolProbeSpec
  | CloudApiProbeSpec
  | DnsProbeSpec
  | WebhookProbeSpec
  | UnprobeableProbeSpec;

export type ProbeOutcome = "pass" | "fail" | "timeout";

export interface ProbeResult {
  readonly outcome: ProbeOutcome;
  readonly code: string;
  readonly diagnosis: string;
  readonly durationMs: number;
  readonly checkedAt: number;
  readonly evidence: Readonly<Record<string, string | number | boolean>>;
}

export interface HumanStepRecord {
  readonly stepId: string;
  readonly stepType: HumanStepType;
  readonly title: string;
  readonly plainEnglishInstructions: readonly string[];
  readonly probeSpec: ProbeSpec;
  readonly status: HumanStepStatus;
  readonly lastProbeResult: ProbeResult | null;
  readonly blockingTaskIds: readonly string[];
  readonly hardLocal: boolean;
  readonly attestedAt?: number;
  readonly verifiedAt?: number;
  readonly attestationNote?: string;
  readonly resolution?: FeatureSkippedResolution;
  readonly questionId?: string;
  readonly graphNodeId?: string;
}

export interface TaskHoldRow {
  readonly task: string;
  readonly reason: string;
  readonly source: string;
  readonly createdAt: number;
}

export interface HumanStepBadge {
  readonly status: HumanStepStatus;
  readonly label: string;
  readonly tone: "green" | "neutral" | "attention";
  readonly honest: boolean;
}

export interface AttestationDecision {
  readonly allowed: boolean;
  readonly message: string;
}

export interface ConsentCard {
  readonly stepId: string;
  readonly title: string;
  readonly prompt: typeof CONSENT_PROMPT;
  readonly exactCommand: string;
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd?: string;
}

export interface ConsentApproval {
  readonly approved: true;
  readonly exactCommand: string;
}

export interface TerminalEvent {
  readonly type: "started" | "output" | "exit" | "cancelled";
  readonly stepId: string;
  readonly text?: string;
  readonly stream?: "stdout" | "stderr";
  readonly exitCode?: number | null;
}

export interface CreateHumanStepInput {
  readonly stepId?: string;
  readonly stepType: HumanStepType;
  readonly title: string;
  readonly plainEnglishInstructions: readonly string[];
  readonly probeSpec: ProbeSpec;
  readonly blockingTaskIds: readonly string[];
  readonly hardLocal?: boolean;
  readonly buildId?: string;
}

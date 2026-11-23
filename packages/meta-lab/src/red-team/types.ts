export const ATTACK_IDS = [
  "readme-install-script",
  "test-edit-injection",
  "malicious-postinstall",
  "hidden-document-injection",
  "skill-and-config-override",
  "vault-canary-leaks",
] as const;

export type AttackId = (typeof ATTACK_IDS)[number];

export const PROBE_IDS = [
  "zip-bomb-xxe",
  "svg-script-exif-gps",
  "csv-formula",
  "docker-argv-secret",
  "ssh-argv-injection",
  "live-key-preview-refusal",
  "ef-project-zip-slip",
] as const;

export type ProbeId = (typeof PROBE_IDS)[number];

export interface DefenseLayerResult {
  readonly id: string;
  readonly triggered: boolean;
  readonly blocked: boolean;
}

export interface AttackResult {
  readonly id: AttackId;
  readonly blocked: boolean;
  readonly trapHitCount: number;
  readonly canaryAccessCount: number;
  readonly rawCanaryLeaks: number;
  readonly layers: readonly DefenseLayerResult[];
  readonly detail: string;
}

export interface ProbeResult {
  readonly id: ProbeId;
  readonly blocked: boolean;
  readonly layers: readonly DefenseLayerResult[];
  readonly detail: string;
}

export interface SecurityScorecard {
  readonly ok: boolean;
  readonly attacks: readonly AttackResult[];
  readonly probes: readonly ProbeResult[];
  readonly trapHitCount: number;
  readonly canaryAccessCount: number;
  readonly rawCanaryLeaks: number;
  readonly durationMs: number;
  readonly withinBudget: boolean;
  readonly exitCode: 0 | 1;
}

export interface RedTeamRunOptions {
  readonly candidateId?: string;
  readonly kitchenScoreDelta?: number;
  readonly allowTestSkip?: boolean;
  readonly ignoreScripts?: boolean;
  readonly allowBuilds?: readonly string[];
  readonly leakUnauthorizedSinks?: boolean;
}

export interface RedTeamGateDecision {
  readonly verdict: "PASS" | "REJECTED_SECURITY_VETO";
  readonly scorecard: SecurityScorecard;
  readonly candidateId: string;
  readonly kitchenScoreDelta: number;
}

export interface CanaryToken {
  readonly id: string;
  readonly value: string;
}

export interface LeakHit {
  readonly sink: string;
  readonly canaryId: string;
  readonly encoding: "raw" | "base64";
  readonly offset: number;
}

export interface LeakReport {
  readonly leaks: readonly LeakHit[];
}

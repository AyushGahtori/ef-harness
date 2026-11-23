import type { RED_TEAM_VECTORS, REPORT_SCHEMA, SILENT_FALLBACK_SCENARIOS } from "./constants.ts";

export type ReportSchema = typeof REPORT_SCHEMA;

export interface PillarVerdict {
  readonly pillar: 1 | 2 | 3 | 4 | 5;
  readonly id: string;
  readonly title: string;
  readonly passed: boolean;
  readonly findings: readonly string[];
  readonly evidence: readonly string[];
  readonly durationMs: number;
}

export interface RedTeamVectorResult {
  readonly id: (typeof RED_TEAM_VECTORS)[number];
  readonly blocked: boolean;
  readonly trapHits: number;
  readonly canaryReads: number;
  readonly layers: readonly string[];
}

export interface SignedAuditReport {
  readonly schema: ReportSchema;
  readonly exitCode: number;
  readonly claimedCertification: boolean;
  readonly findings: readonly string[];
  readonly pillars: readonly PillarVerdict[];
  readonly redTeam: readonly RedTeamVectorResult[];
  readonly residualSecretBytes: number;
  readonly silentSpendMicroUsd: number;
  readonly withdrawnVendorHits: number;
  readonly skillPinsOk: boolean;
  readonly allowBuildsOk: boolean;
  readonly hostElapsedMs: number;
  readonly scorecardMarkdown: string;
}

export type SecurityAuditCertificationReport = SignedAuditReport & { readonly signature: string };

export interface SilentFallbackScenario {
  readonly id: (typeof SILENT_FALLBACK_SCENARIOS)[number];
  readonly spendMicroUsd: number;
  readonly consented: boolean;
}

export interface RunOptions {
  readonly faults?: {
    readonly skipVacuum?: boolean;
    readonly weakElectronCsp?: boolean;
    readonly unapprovedPostinstall?: boolean;
    readonly geminiDefaultOn?: boolean;
    readonly silentPaidMicroUsd?: number;
    readonly skillHashDrift?: boolean;
    readonly allowTelemetryBeacon?: boolean;
  };
}
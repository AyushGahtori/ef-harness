export type SafetyZone = "zone1_internal" | "zone2_persisted" | "immutable_migration";

export type PersistedNameKind =
  | "sql_table"
  | "sql_column"
  | "json_wire_key"
  | "env_var"
  | "local_storage_key"
  | "cookie_key"
  | "route_slug"
  | "webhook_event"
  | "css_custom_property"
  | "i18n_key"
  | "cli_flag";

export type ReferenceHit = {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly matchedText: string;
  readonly variant: string;
  readonly zone: SafetyZone;
  readonly persistedKind?: PersistedNameKind;
  readonly contextSnippet: string;
};

export type Zone2Decision = "preserve" | "rename_with_migration";

export type PersistedNameGateResult = {
  readonly zone2Hits: readonly ReferenceHit[];
  readonly defaultDecision: "preserve";
  readonly approvedRenames: readonly PersistedNameKind[];
  readonly requiresExplicitApproval: boolean;
};

export type RiskyAstFlagKind =
  | "dynamic_property_access"
  | "variable_shadowing"
  | "orm_column_drift"
  | "control_flow_inversion";

export type RiskyAstFlag = {
  readonly kind: RiskyAstFlagKind;
  readonly filePath: string;
  readonly line: number;
  readonly message: string;
  readonly severity: "block" | "warn";
};

export type SweepSymbolMapEntry = {
  readonly sweepId: string;
  readonly pathMappings: Readonly<Record<string, string>>;
  readonly symbolMappings: Readonly<Record<string, string>>;
  readonly persistedExclusions: readonly string[];
};

export type QueuedTaskRecord = {
  readonly taskId: string;
  readonly writeScope: string[];
  readonly compiledBrief: string;
  readonly status: "queued" | "paused" | "active";
};

export type SweepAuditScorecard = {
  readonly sweepId: string;
  readonly filesChanged: number;
  readonly codemodCount: number;
  readonly tailShardCount: number;
  readonly zone2ExcludedCount: number;
  readonly riskyAstFlagsCleared: number;
  readonly leftoverCount: number;
  readonly queuedBriefsUpdatedCount: number;
};
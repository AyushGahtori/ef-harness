export const CCR_LIFECYCLES = ["PROPOSED", "CLASSIFIED", "APPROVED", "REJECTED", "LANDED"] as const;
export type CcrLifecycle = (typeof CCR_LIFECYCLES)[number];

export const DIFF_CLASSES = ["ADDITIVE", "BREAKING", "UNCHANGED"] as const;
export type DiffClass = (typeof DIFF_CLASSES)[number];

export const CCR_SPAM_CAP = 3;

export const EXPAND_THEN_CONTRACT = "Prefer additive expand-then-contract field instead";
export const APPROVE_BREAKING = "Approve breaking revision";
export const KEEP_ORIGINAL = "Keep original contract";
export const LOCKED_ADAPTER_INSTRUCTION = "Contract is locked; implement adapter within your scope";

export const COORDINATOR_ROLE = "project-integrator@1";
export const PLANNER_ROLE = "planner";

export type Urgency = "low" | "normal" | "high";
export type ClaimedClass = "additive" | "breaking";
export type FeatureState = "RUNNING" | "HOLD" | "DONE";

export interface SchemaBundle {
  readonly sql?: string;
  readonly openapi?: string;
  readonly jsonSchema?: string;
  readonly typescript?: string;
}

export interface BehaviorSnapshot {
  readonly endpoint?: string;
  readonly defaultSort?: string;
  readonly timezone?: string;
  readonly paginationDefault?: string;
  readonly authSemantics?: string;
  readonly tenantSemantics?: string;
  readonly errorEnvelope?: string;
  readonly consumers?: readonly string[];
}

export interface ProposedDelta {
  readonly before: SchemaBundle;
  readonly after: SchemaBundle;
  readonly behaviorBefore?: BehaviorSnapshot;
  readonly behaviorAfter?: BehaviorSnapshot;
}

export interface ContractChangeProposal {
  readonly requestingTaskId: string;
  readonly requestingFeatureId: string;
  readonly targetContractNodeId: string;
  readonly proposedDelta: ProposedDelta;
  readonly rationale: string;
  readonly urgency: Urgency;
  readonly claimedClass?: ClaimedClass;
  readonly claimedAdditive?: boolean;
}

export type DiffOpKind =
  | "add_nullable_column"
  | "add_defaulted_column"
  | "add_table"
  | "add_optional_field"
  | "add_output_enum_value"
  | "add_endpoint"
  | "add_optional_ui_variant"
  | "add_export"
  | "drop_column"
  | "drop_table"
  | "drop_field"
  | "drop_endpoint"
  | "drop_export"
  | "rename_column"
  | "rename_table"
  | "rename_field"
  | "narrow_type"
  | "type_change"
  | "add_required"
  | "tighten_constraint"
  | "loosen_constraint"
  | "status_change"
  | "error_envelope_change"
  | "auth_change"
  | "tenant_change"
  | "remove_enum_value"
  | "add_input_enum_value"
  | "unparsed";

export interface DiffOp {
  readonly signature: string;
  readonly kind: DiffOpKind;
  readonly breaking: boolean;
  readonly detail: string;
  readonly payload: Readonly<Record<string, string>>;
}

export interface SchemaDiffResult {
  readonly classification: DiffClass;
  readonly overridden: boolean;
  readonly reasons: readonly string[];
  readonly ops: readonly DiffOp[];
  readonly formats: readonly string[];
}

export interface SemanticAlternative {
  readonly summary: string;
  readonly additive: true;
}

export interface SemanticReview {
  readonly breaking: boolean;
  readonly reasons: readonly string[];
  readonly consumers: readonly string[];
  readonly alternatives: readonly SemanticAlternative[];
  readonly unchangedSchema: boolean;
}

export interface ContractOwner {
  readonly contractNodeId: string;
  readonly ownerTaskId: string;
  readonly ownerFeatureId: string;
  readonly ownerRole: string;
  readonly phase0: boolean;
}

export interface ContractOwnerDirectory {
  get(contractNodeId: string): ContractOwner | null;
}

export interface FeatureRuntimeDirectory {
  stateOf(featureId: string): FeatureState;
  runningFeatures(): readonly string[];
}

export interface ImpactNode {
  readonly id: string;
  readonly kind: "feature" | "screen" | "task" | "check" | "contract" | "decision";
  readonly featureId?: string;
  readonly state?: "WORKING" | "LEASED" | "CODING" | "DONE" | "MERGED_TO_FEATURE" | "ACCEPTED";
}

export interface ImpactEdge {
  readonly from: string;
  readonly to: string;
}

export interface ImpactGraph {
  readonly nodes: readonly ImpactNode[];
  readonly edges: readonly ImpactEdge[];
}

export interface ImpactedBlast {
  readonly affectedFeatures: readonly string[];
  readonly affectedScreens: readonly string[];
  readonly affectedActiveTasks: readonly string[];
  readonly affectedMergedTasks: readonly string[];
  readonly affectedChecks: readonly string[];
  readonly nodes: readonly string[];
}

export interface WaitEdge {
  readonly fromTaskId: string;
  readonly toTaskId: string;
  readonly kind: "waits_on" | "depends_on";
  readonly ccrId?: string;
}

export interface WaitGraphDeadlockBreak {
  readonly kind: "WaitGraphDeadlockBreak";
  readonly cycle: readonly string[];
  readonly rejectedEdge: WaitEdge;
  readonly escalatedTo: typeof COORDINATOR_ROLE;
}

export interface OwnerTask {
  readonly taskId: string;
  readonly ownerTaskId: string;
  readonly ownerRole: string;
  readonly mutatedBy: string;
  readonly requestingConsumer: string;
  readonly consumerMayEdit: false;
  readonly contractNodeId: string;
  readonly contractUpdate: string;
  readonly migrationName: string | null;
  readonly migrationSql: string | null;
  readonly backwardCompatibilityTestId: string;
  readonly ccrIds: readonly string[];
}

export interface ContractChangeDecisionCard {
  readonly ccrId: string;
  readonly requestedChange: string;
  readonly whyWorkerHitIt: string;
  readonly affectedFeatures: readonly string[];
  readonly affectedTasks: readonly string[];
  readonly affectedScreens: readonly string[];
  readonly affectedChecks: readonly string[];
  readonly alternatives: readonly string[];
  readonly autoExecutionBlocked: true;
  readonly revisionTask: "Task-087";
  readonly autoStartPolicy: "Task-108";
  readonly semantic: boolean;
}

export interface CcrIntakeResult {
  readonly ccrId: string | null;
  readonly deduped: boolean;
  readonly classification: "ADDITIVE" | "BREAKING" | null;
  readonly overridden: boolean;
  readonly lifecycle: CcrLifecycle | null;
  readonly queueState: string;
  readonly fastPath: boolean;
  readonly autoExecutionBlocked: boolean;
  readonly ownerTaskId: string | null;
  readonly ownerRole: string | null;
  readonly consumerEditedContract: false;
  readonly wokenTaskIds: readonly string[];
  readonly migrationName: string | null;
  readonly ownerCommitSha: string | null;
  readonly waitingOnCcr: boolean;
  readonly cycleBroken: boolean;
  readonly spamHalted: boolean;
  readonly escalation: string | null;
  readonly decision: ContractChangeDecisionCard | null;
  readonly unrelatedRunning: readonly string[];
  readonly subscriberTaskIds: readonly string[];
  readonly ownerTask: OwnerTask | null;
  readonly semanticBreaking: boolean;
  readonly haltedTaskId: string | null;
}

export type LandMode = "immediate" | "queued";

export interface CcrV1ChangeAddColumn {
  readonly add_column: {
    readonly name: string;
    readonly type: string;
    readonly nullable: boolean;
  };
}

export interface CcrV1ChangeLabeled {
  readonly add_field?: { readonly name: string; readonly optional: true };
  readonly add_endpoint?: { readonly name: string };
  readonly add_enum_value?: { readonly name: string };
  readonly add_ui_variant?: { readonly name: string };
  readonly breaking?: { readonly summary: string };
  readonly semantic?: { readonly summary: string };
}

export type CcrV1Change = CcrV1ChangeAddColumn | CcrV1ChangeLabeled;

export interface CcrV1 {
  readonly schema: "ccr@1";
  readonly id: string;
  readonly from_feature: string;
  readonly target: string;
  readonly change: CcrV1Change;
  readonly reason: string;
  readonly class: "additive" | "breaking";
  readonly status: "open" | "approved" | "rejected" | "applied";
}

export interface AuditEvent {
  readonly eventId: number;
  readonly ccrId: string;
  readonly lifecycle: CcrLifecycle;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface StoredCcr {
  readonly id: string;
  readonly targetContractNodeId: string;
  readonly fingerprint: string;
  readonly requestingTaskId: string;
  readonly requestingFeatureId: string;
  readonly lifecycle: CcrLifecycle;
  readonly queueState: string;
  readonly classification: "ADDITIVE" | "BREAKING";
  readonly overridden: boolean;
  readonly claimedClass: string | null;
  readonly rationale: string;
  readonly urgency: Urgency;
  readonly ownerTaskId: string | null;
  readonly ownerRole: string;
  readonly ownerCommitSha: string | null;
  readonly wokenTaskIds: readonly string[];
  readonly subscriberTaskIds: readonly string[];
  readonly ccrV1: CcrV1;
  readonly migrationName: string | null;
  readonly schemaDiff: readonly DiffOp[];
  readonly decision: ContractChangeDecisionCard | null;
  readonly ownerTask: OwnerTask | null;
  readonly semanticBreaking: boolean;
}

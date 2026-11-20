export const PHASE0_FOUNDATION = "phase0-foundation";

export const WORD_BUDGET = 2500;

export const MAX_REPAIR_PASSES = 2;

export const VIOLATION_CODES = [
  "dangling_ref",
  "shadowed_name",
  "unhoisted_duplicated_rule",
  "orphan_requirements",
  "feature_cycle",
  "invalid_mermaid",
  "dual_owner",
  "brownfield_rewrite",
  "over_word_budget",
  "schema_invalid",
  "blocked",
  "unresolved_contradictions",
] as const;

export type ViolationCode = (typeof VIOLATION_CODES)[number];

export const REPAIRABLE_CODES = [
  "dangling_ref",
  "orphan_requirements",
  "invalid_mermaid",
  "over_word_budget",
  "schema_invalid",
] as const;

export type RepairableCode = (typeof REPAIRABLE_CODES)[number];

export interface ArchitectureViolation {
  readonly code: ViolationCode;
  readonly message: string;
  readonly ids: readonly string[];
  readonly cycle: readonly string[];
}

export interface ScopePredicate {
  readonly any: readonly string[];
  readonly all: readonly string[];
}

export interface SettledDecision {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly basis: "explicit" | "derived" | "delegated";
}

export interface SettledRequirement {
  readonly id: string;
  readonly kind: "spec_item" | "edge_case" | "rule" | "journey";
  readonly title: string;
  readonly text: string;
  readonly basis: "explicit" | "derived" | "delegated" | "defaulted" | "proposed" | "observed";
}

export interface ResearchFactInput {
  readonly id: string;
  readonly title: string;
  readonly text: string;
}

export interface CrossCuttingRuleInput {
  readonly id: string;
  readonly text: string;
  readonly scope: ScopePredicate;
  readonly checkKind: string;
}

export interface ObservedSubsystem {
  readonly id: string;
  readonly path: string;
  readonly level: "L0" | "L1" | "L2";
  readonly signature: string;
}

export interface SynthesisInput {
  readonly mode: "greenfield" | "brownfield";
  readonly decisions: readonly SettledDecision[];
  readonly requirements: readonly SettledRequirement[];
  readonly researchFacts: readonly ResearchFactInput[];
  readonly crossCuttingRules: readonly CrossCuttingRuleInput[];
  readonly observedSubsystems?: readonly ObservedSubsystem[];
  readonly touchedSubsystemIds?: readonly string[];
}

export interface ComponentSpec {
  readonly id: string;
  readonly name: string;
  readonly boundary: string;
  readonly action: "keep" | "rewrite";
}

export interface EntityFieldSpec {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
}

export interface EntityRelationSpec {
  readonly target: string;
  readonly kind: string;
}

export interface EntitySpec {
  readonly id: string;
  readonly table: string;
  readonly fields: readonly EntityFieldSpec[];
  readonly relations: readonly EntityRelationSpec[];
  readonly owner: string;
}

export interface ContractSpec {
  readonly id: string;
  readonly producer: string;
  readonly consumers: readonly string[];
  readonly schema: string;
}

export interface RuleSpec {
  readonly id: string;
  readonly text: string;
  readonly scope_predicate: ScopePredicate;
  readonly check_kind: string;
}

export interface EnvVarSpec {
  readonly name: string;
  readonly required: boolean;
  readonly description: string;
}

export interface RiskSpec {
  readonly id: string;
  readonly text: string;
}

export interface PackageSpec {
  readonly name: string;
  readonly path: string;
  readonly runtime: string;
}

export interface TopologySpec {
  readonly directories: readonly string[];
  readonly packages: readonly PackageSpec[];
}

export interface StackSpec {
  readonly name: string;
  readonly version: string;
  readonly boundary: string;
}

export interface AuthSpec {
  readonly model: string;
  readonly tenant: string;
  readonly session: string;
  readonly contract_id: string;
}

export interface FeatureSpec {
  readonly id: string;
  readonly title: string;
  readonly depends_on: readonly string[];
  readonly requirements: readonly string[];
  readonly owns: readonly string[];
}

export interface SeamSpec {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly contract_id: string;
}

export interface DiagramSpec {
  readonly id: string;
  readonly kind: "context" | "data_flow" | "sequence" | "state";
  readonly source: string;
}

export interface AdrSpec {
  readonly id: string;
  readonly title: string;
  readonly choice: string;
  readonly justified_by: readonly string[];
}

export interface EventSpec {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
}

export interface RouteSpec {
  readonly kind: "http_route" | "page_route";
  readonly value: string;
  readonly owner: string;
}

/**
 * Prompt-contract `system-architect@1` object plus the upfront skeleton sections.
 * The extra sections are a local port until Task 009 grows `SystemArchitectV1Schema`.
 */
export interface SystemSkeleton {
  readonly components: readonly ComponentSpec[];
  readonly entities: readonly EntitySpec[];
  readonly contracts: readonly ContractSpec[];
  readonly rules: readonly RuleSpec[];
  readonly conventions: readonly string[];
  readonly env_manifest: readonly EnvVarSpec[];
  readonly risks: readonly RiskSpec[];
  readonly topology: TopologySpec;
  readonly stack: readonly StackSpec[];
  readonly auth: AuthSpec;
  readonly feature_map: readonly FeatureSpec[];
  readonly seams: readonly SeamSpec[];
  readonly diagrams: readonly DiagramSpec[];
  readonly adrs: readonly AdrSpec[];
  readonly events: readonly EventSpec[];
  readonly routes: readonly RouteSpec[];
  readonly error_envelope: string;
  readonly response_convention: string;
  readonly rewrites: readonly string[];
}

export interface StructuredDiagnostic {
  readonly contractId: "system-architect@1";
  readonly repairPasses: number;
  readonly violations: readonly ArchitectureViolation[];
  readonly message: string;
}

export interface ConflictRefusal {
  readonly reason: "unresolved_contradictions";
  readonly activeConflicts: number;
}

export interface SynthesisResult {
  readonly started: boolean;
  readonly accepted: boolean;
  readonly repairPasses: number;
  readonly wordCount: number;
  readonly violations: readonly ArchitectureViolation[];
  readonly owners: Readonly<Record<string, string>>;
  readonly diagnostic: StructuredDiagnostic | null;
  readonly refusal: ConflictRefusal | null;
}

export interface ArchitectModelRequest {
  readonly attempt: string;
  readonly step: number;
  readonly contractId: "system-architect@1";
  readonly repairPass: number;
  readonly violations: readonly ArchitectureViolation[];
  readonly prompt: string;
}

export interface ArchitectModelPort {
  complete(request: ArchitectModelRequest): string | Promise<string>;
}

export function violation(
  code: ViolationCode,
  message: string,
  ids: readonly string[] = [],
  cycle: readonly string[] = [],
): ArchitectureViolation {
  return { code, message, ids, cycle };
}

export function isRepairable(code: ViolationCode): boolean {
  return (REPAIRABLE_CODES as readonly string[]).includes(code);
}

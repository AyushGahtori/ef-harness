import type { ContractInput, DiagnosticEntry, EntityInput, RequirementInput } from "./types.js";

/**
 * Local port for Task 084 `JitFeatureArchitectureSynthesizer`.
 * Sibling branch is not on this base. Planning runs only after consistency passes.
 */
export interface FeatureArchitectureConsistency {
  readonly schema: "feature-architect@1";
  readonly featureId: string;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

/**
 * Local port for Task 017 `KnowledgeGraphRepo`.
 * Relation targets must resolve to an active node id before commit.
 */
export interface KnowledgeGraphRepoPort {
  activeIds(): ReadonlySet<string>;
  hasActiveNode(id: string): boolean;
}

/**
 * Local port for Task 019 `NameRegistryRepo` `relations_in_fields` parity.
 * The returned ids still carry a relation list inside `fields`.
 */
export interface NameRegistryRepoPort {
  relationsInFields(): readonly string[];
}

export interface DiagnosticLog {
  readonly entries: readonly DiagnosticEntry[];
  warn(code: string, message: string): void;
}

export class MemoryDiagnosticLog implements DiagnosticLog {
  readonly entries: DiagnosticEntry[] = [];

  warn(code: string, message: string): void {
    this.entries.push({ code, message });
  }
}

export interface PlanContext {
  readonly featureId: string;
  readonly featureTitle: string;
  readonly architecture: FeatureArchitectureConsistency;
  readonly requirements: readonly RequirementInput[];
  readonly contracts: readonly ContractInput[];
  readonly entities: readonly EntityInput[];
}

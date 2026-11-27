import type { CurrencyKind, FeatureInput } from "./types.js";

/**
 * Local port for Task 083 `SystemArchitectureSynthesizer`.
 * Sibling branch `task/083-*` is not merged into this base. Replace this
 * structural lock with the synthesizer's exported lock when that barrel lands.
 */
export interface LockedSystemArchitecture {
  readonly schema: "system-architect@1";
  readonly projectId: string;
  readonly projectKind: string;
  readonly featureIds: readonly string[];
  readonly database?: boolean;
  readonly auth?: boolean;
}

/**
 * Local port for Task 017 `KnowledgeGraphRepo`.
 * Active feature ids are the state.db population that must all be scheduled.
 */
export interface KnowledgeGraphRepoPort {
  listActiveFeatureIds(projectId: string): readonly string[];
}

/**
 * Local port for Task 023 `BudgetLedger` / `BudgetLedgerRepo.createBudgetScope`.
 * Money stays in integer micro-USD or allowance ppm. Scope kinds match
 * `state.db.budgets`.
 */
export interface BudgetScopeWrite {
  readonly scopeKind: "project" | "feature" | "task" | "wave_paperwork" | "grant";
  readonly scopeId: string;
  readonly currency: string;
  readonly limitUnits: bigint;
  readonly parentKind: "project" | "feature" | "task" | "wave_paperwork" | "grant" | null;
  readonly parentId: string | null;
}

export interface BudgetLedgerPort {
  createBudgetScope(input: BudgetScopeWrite): void;
}

export interface ParallelismBudget {
  readonly hardwareSlots: number;
  readonly providerSlots: number;
  readonly developerMax?: number;
}

export interface MasterPlanBudget {
  readonly currency: CurrencyKind;
  readonly totalUnits: bigint;
  readonly connectionId?: string;
  readonly costPerLeafUnits?: bigint;
}

/**
 * Local port for Task 009 `MasterPlannerV1Schema` input assembled by the orchestrator.
 * `modelOutput` is the raw `master-planner@1` document when a model produced one.
 * `proposedLeafTasks` is the direct API attempt to attach leaves to a wave index.
 */
export interface MasterPlanRequest {
  readonly projectId: string;
  readonly architecture: LockedSystemArchitecture;
  readonly features: readonly FeatureInput[];
  readonly budget: MasterPlanBudget;
  readonly parallelism: ParallelismBudget;
  readonly proposedLeafTasks?: Readonly<Record<string, readonly { readonly id: string }[]>>;
  readonly modelOutput?: unknown;
  readonly createdAt?: number;
  readonly graph?: KnowledgeGraphRepoPort;
  readonly ledger?: BudgetLedgerPort;
}

export function currencyCode(currency: CurrencyKind, connectionId: string | null): string {
  if (currency === "usd") return "usd";
  return `allowance:${connectionId ?? "subscription"}`;
}

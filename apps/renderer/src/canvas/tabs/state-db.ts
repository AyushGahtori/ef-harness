import type {
  MatrixPage,
  MatrixRow,
  OutlineSnapshot,
  PlanSnapshot,
  ReadinessCounts,
  ReviewEdit,
  ReviewProposal,
  ReviewSettleResult,
  RuntimePage,
  RuntimeQuery,
  StoredNode,
} from "./types.js";

/**
 * Spec, matrix, plan, and runtime projections served by `apps/daemon`.
 * The renderer holds this port only. SQLite stays in the daemon.
 */
export interface CanonicalStateDb {
  getNode(id: string): StoredNode | null;
  readOutline(): OutlineSnapshot;
  readiness(): ReadinessCounts;
  readMatrixCollapsed(): MatrixRow[];
  readMatrixRawPage(offset: number, limit: number): MatrixPage;
  listProposals(): ReviewProposal[];
  applyReview(command: {
    readonly approve: readonly string[];
    readonly reject: readonly string[];
    readonly edits: readonly ReviewEdit[];
  }): ReviewSettleResult;
  readPlan(): PlanSnapshot;
  readRuntimePage(query: RuntimeQuery): RuntimePage;
}

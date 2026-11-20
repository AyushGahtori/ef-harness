import { normalizeEars } from "./canonical.js";
import { earsPatternName, EarsOracleValidator } from "./ears-oracle-validator.js";
import type { MatrixCellPersistencePort } from "./matrix-store.js";
import type { FillerStateDb, GraphNode, NodeCreate, NodeUpdate, EdgeCreate } from "./state-graph.js";
import type {
  ClarificationPrompt,
  ContradictionRecheckPort,
  ReadinessSnapshot,
} from "./types.js";

export interface ReviewProposal {
  readonly cellId: string;
  readonly featureId: string;
  readonly matrixId: string;
  readonly requirementId: string;
  readonly title: string;
  readonly earsText: string;
  readonly oracleSketch: string;
  readonly risk: "medium";
  readonly basis: "proposed";
}

export interface ReviewGroup {
  readonly featureId: string;
  readonly matrixId: string;
  readonly title: string;
  readonly actions: readonly ["Approve all", "Edit", "Reject"];
  readonly proposals: readonly ReviewProposal[];
}

export interface ReviewEdit {
  readonly cellId: string;
  readonly earsText: string;
  readonly oracleSketch: string;
}

export interface ReviewSettleCommand {
  readonly approve?: readonly string[];
  readonly reject?: readonly string[];
  readonly edits?: readonly ReviewEdit[];
}

export interface ReviewSettleResult {
  readonly approved: readonly string[];
  readonly rejected: readonly string[];
  readonly edited: readonly string[];
  readonly clarifications: readonly ClarificationPrompt[];
  readonly readiness: ReadinessSnapshot;
  readonly contradictionFlags: number;
}

export class ReviewValidationError extends Error {
  readonly cellId: string;
  readonly problems: readonly string[];

  constructor(cellId: string, problems: readonly string[]) {
    super(problems.join("; "));
    this.name = "ReviewValidationError";
    this.cellId = cellId;
    this.problems = problems;
  }
}

const ACTIONS = ["Approve all", "Edit", "Reject"] as const;

export class ProposedRequirementReviewQueue {
  private readonly validator = new EarsOracleValidator();

  constructor(
    private readonly graph: FillerStateDb,
    private readonly contradiction: ContradictionRecheckPort,
    private readonly store: MatrixCellPersistencePort,
  ) {}

  groups(): readonly ReviewGroup[] {
    const groups = new Map<string, ReviewProposal[]>();
    for (const proposal of this.pending()) {
      const key = `${proposal.featureId}\u0000${proposal.matrixId}`;
      const list = groups.get(key);
      if (list) list.push(proposal);
      else groups.set(key, [proposal]);
    }
    return [...groups.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([, proposals]) => {
        const first = proposals[0];
        return {
          featureId: first?.featureId ?? "",
          matrixId: first?.matrixId ?? "",
          title: `${String(proposals.length)} proposed details — Approve all or expand`,
          actions: ACTIONS,
          proposals,
        };
      });
  }

  approveAll(featureId: string, matrixId?: string): ReviewSettleResult {
    const ids = this.pending()
      .filter((proposal) => proposal.featureId === featureId && (matrixId === undefined || proposal.matrixId === matrixId))
      .map((proposal) => proposal.cellId);
    return this.settle({ approve: ids });
  }

  settle(command: ReviewSettleCommand): ReviewSettleResult {
    const approve = unique(command.approve ?? []);
    const reject = unique(command.reject ?? []);
    const edits = command.edits ?? [];
    const editIds = edits.map((edit) => edit.cellId);
    const overlap = [...approve, ...reject, ...editIds].filter((id, index, all) => all.indexOf(id) !== index);
    if (overlap.length > 0) {
      throw new ReviewValidationError(overlap[0] ?? "", ["a cell cannot be approved, edited, and rejected in one settle"]);
    }
    const pending = new Map(this.pending().map((proposal) => [proposal.cellId, proposal]));
    for (const id of [...approve, ...reject, ...editIds]) {
      if (!pending.has(id)) throw new ReviewValidationError(id, ["cell is not a pending medium-risk proposal"]);
    }
    for (const edit of edits) {
      const verdict = this.validator.validate({
        earsText: edit.earsText,
        oracleSketch: edit.oracleSketch,
      });
      if (!verdict.ok) throw new ReviewValidationError(edit.cellId, verdict.problems);
    }

    const nodes: (NodeCreate | NodeUpdate)[] = [];
    const edges: EdgeCreate[] = [];
    const previousText = new Map<string, string>();
    for (const cellId of approve) {
      const node = this.requireNode(cellId);
      nodes.push({
        op: "update",
        id: node.id,
        text: node.text,
        status: "active",
        fields: { ...node.fields, basis: "explicit", review_status: "settled" },
      });
      this.writeStore(cellId, "explicit", "settled", node.text, stringField(node, "oracle_sketch"));
    }
    for (const edit of edits) {
      const node = this.requireNode(edit.cellId);
      const ears = edit.earsText.trim();
      const oracle = edit.oracleSketch.trim();
      previousText.set(edit.cellId, node.text);
      nodes.push({
        op: "update",
        id: node.id,
        title: node.title,
        text: ears,
        status: "active",
        fields: {
          ...node.fields,
          basis: "explicit",
          review_status: "settled",
          ears_text: ears,
          oracle_sketch: oracle,
          ears_norm: normalizeEars(ears),
          pattern: earsPatternName(ears),
        },
      });
      this.writeStore(edit.cellId, "explicit", "settled", ears, oracle);
    }
    for (const cellId of reject) {
      const node = this.requireNode(cellId);
      const prompt = `Clarify ${node.title}. The proposed requirement was rejected. Replace it with one EARS sentence and a concrete oracle sketch.`;
      const commentId = `CMT-${node.id}`;
      nodes.push({
        op: "update",
        id: node.id,
        status: "superseded",
        fields: { ...node.fields, review_status: "rejected" },
      });
      nodes.push({
        op: "create",
        id: commentId,
        kind: "comment",
        title: `Clarification for ${cellId}`,
        text: prompt,
        status: "active",
        fields: {
          feature: node.feature ?? "",
          cell_id: cellId,
          reason: "rejected_proposal",
          prompt,
        },
      });
      edges.push({ op: "create", src: commentId, type: "comments_on", dst: node.id });
      this.writeStore(cellId, "proposed", "rejected", node.text, stringField(node, "oracle_sketch"));
    }

    if (nodes.length > 0) {
      this.graph.commitChangeSet({
        id: `CS-review-${hashStamp(JSON.stringify({ approve, reject, edits }))}`,
        origin: "kernel",
        author: "spec-expander@1",
        summary: "Review medium-risk proposed requirements",
        nodes,
        edges,
      });
    }

    const requirementIds = [...approve, ...editIds].map((cellId) => this.requireNode(cellId).id);
    const flags =
      requirementIds.length === 0
        ? 0
        : this.contradiction.recheck({
            reason: edits.length > 0 ? "review_edit" : "review_approve",
            requirementIds,
            pairs: edits.map((edit) => {
              const node = this.requireNode(edit.cellId);
              return {
                leftId: node.id,
                rightId: edit.cellId,
                leftText: previousText.get(edit.cellId) ?? node.text,
                rightText: edit.earsText.trim(),
              };
            }),
          }).flagged;
    return {
      approved: approve,
      rejected: reject,
      edited: editIds,
      clarifications: this.clarifications(),
      readiness: this.graph.readiness(),
      contradictionFlags: flags,
    };
  }

  clarifications(): readonly ClarificationPrompt[] {
    return this.graph
      .listNodes("comment")
      .filter((node) => node.fields.reason === "rejected_proposal" && node.status === "active")
      .map((node) => ({
        cellId: stringField(node, "cell_id"),
        featureId: node.feature ?? "",
        nodeId: node.id,
        prompt: node.text,
        reason: "rejected_proposal" as const,
      }));
  }

  readiness(): ReadinessSnapshot {
    return this.graph.readiness();
  }

  private pending(): ReviewProposal[] {
    return this.graph
      .requirements()
      .filter(
        (node) =>
          node.status === "draft" && node.basis === "proposed" && node.fields.review_status === "proposed",
      )
      .map((node) => ({
        cellId: stringField(node, "cell_id"),
        featureId: node.feature ?? "",
        matrixId: stringField(node, "matrix_id"),
        requirementId: node.id,
        title: node.title,
        earsText: node.text,
        oracleSketch: stringField(node, "oracle_sketch"),
        risk: "medium" as const,
        basis: "proposed" as const,
      }))
      .sort((left, right) => left.cellId.localeCompare(right.cellId));
  }

  private requireNode(cellId: string): GraphNode {
    const node = this.graph.requirements().find((item) => item.fields.cell_id === cellId);
    if (!node) throw new ReviewValidationError(cellId, ["proposed requirement node is missing"]);
    return node;
  }

  private writeStore(
    cellId: string,
    basis: "explicit" | "proposed",
    reviewStatus: "settled" | "rejected",
    earsText: string,
    oracleSketch: string,
  ): void {
    const current = this.store.getCell(cellId);
    if (!current?.fill) return;
    this.store.saveFill(cellId, {
      ...current.fill,
      basis,
      reviewStatus,
      earsText,
      oracleSketch,
    });
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function stringField(node: GraphNode, key: string): string {
  const value = node.fields[key];
  return typeof value === "string" ? value : "";
}

function hashStamp(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

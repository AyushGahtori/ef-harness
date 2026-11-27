import { formatSpecItemId, hashParts, normalizeEars, upstreamDecisionHash } from "./canonical.js";
import { DeterministicPass1And2Filler, type DeterministicClaim } from "./deterministic-filler.js";
import { earsPatternName } from "./ears-oracle-validator.js";
import { MemoryMatrixCellStore, type MatrixCellPersistencePort } from "./matrix-store.js";
import { buildFillMetrics } from "./metrics.js";
import { LlmCellExpanderPass3, type Pass3CellResult } from "./pass3.js";
import { MemoryChosenForYou, RecordingContradictionRecheck } from "./ports.js";
import { ProposedRequirementReviewQueue } from "./review-queue.js";
import type { EdgeCreate, FillerStateDb, NodeCreate, NodeUpdate } from "./state-graph.js";
import type {
  CellOutcome,
  ChosenForYouPort,
  ChosenOption,
  ContradictionRecheckPort,
  CrossCuttingRule,
  FeatureBudget,
  FillBasis,
  FillDiagnostic,
  FillMetrics,
  MustAskQuestion,
  OpenCell,
  OptionElaboration,
  PersistedFill,
  RiskTier,
  SettledDecision,
  SpecExpanderModel,
  UniversalPolicyClause,
} from "./types.js";

const DEFAULT_BUDGET: FeatureBudget = {
  maxCallsPerFeature: 32,
  maxTokensPerFeature: 200_000,
};

export interface FillerRunInput {
  readonly cells: readonly OpenCell[];
  readonly decisions: readonly SettledDecision[];
  readonly graph: FillerStateDb;
  readonly model: SpecExpanderModel;
  readonly store?: MatrixCellPersistencePort;
  readonly chosenOptions?: readonly ChosenOption[];
  readonly rules?: readonly CrossCuttingRule[];
  readonly elaborations?: readonly OptionElaboration[];
  readonly policies?: readonly UniversalPolicyClause[];
  readonly budget?: FeatureBudget;
  readonly forbiddenScopePhrases?: readonly string[];
  readonly contradiction?: ContradictionRecheckPort;
  readonly chosenForYou?: ChosenForYouPort;
  readonly featureTitles?: Readonly<Record<string, string>>;
  readonly attempt?: string;
}

export interface FillerRunResult {
  readonly outcomes: readonly CellOutcome[];
  readonly metrics: FillMetrics;
  readonly diagnostics: readonly FillDiagnostic[];
  readonly mustAsk: readonly MustAskQuestion[];
  readonly review: ProposedRequirementReviewQueue;
  readonly chosenForYou: ChosenForYouPort;
  readonly contradiction: ContradictionRecheckPort;
  readonly store: MatrixCellPersistencePort;
  readonly llmCalls: number;
  readonly tokensSpent: number;
}

interface ProvenanceNode {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly fields: Record<string, unknown>;
}

interface RequirementWork {
  readonly cell: OpenCell;
  readonly pass: 1 | 2 | 3;
  readonly basis: FillBasis;
  readonly risk: RiskTier;
  readonly value: string;
  readonly earsText: string;
  readonly oracleSketch: string;
  readonly sourceIds: readonly string[];
  readonly sourceHash: string;
  readonly reviewStatus: "settled" | "auto_accepted" | "proposed";
  readonly status: "draft" | "active";
  readonly provenance: readonly ProvenanceNode[];
}

interface AskWork {
  readonly cell: OpenCell;
  readonly question: string;
  readonly forcedHigh: boolean;
  readonly modelRisk: RiskTier;
  readonly earsText: string | null;
  readonly oracleSketch: string | null;
  readonly premises: readonly string[];
}

export interface ListedMaterializedRequirement {
  readonly id: string;
  readonly text: string;
  readonly earsText: string;
  readonly entities: readonly string[];
  readonly touches: readonly string[];
  readonly featureId: string;
  readonly pass: 1 | 2 | 3;
  readonly basis: string;
  readonly status: string;
}

export class OrderedCellFillerPipeline {
  private readonly deterministic = new DeterministicPass1And2Filler();
  private readonly pass3 = new LlmCellExpanderPass3();
  private materializedRequirements: ListedMaterializedRequirement[] = [];

  listMaterializedRequirements(workItemId?: string): readonly ListedMaterializedRequirement[] {
    if (workItemId === undefined) return this.materializedRequirements;
    return this.materializedRequirements.filter((item) => item.featureId === workItemId);
  }

  run(input: FillerRunInput): FillerRunResult {
    const store = input.store ?? new MemoryMatrixCellStore();
    const contradiction = input.contradiction ?? new RecordingContradictionRecheck();
    const chosenForYou = input.chosenForYou ?? new MemoryChosenForYou();
    const budget = input.budget ?? DEFAULT_BUDGET;
    const upstream = upstreamDecisionHash(input.decisions);
    const active = input.cells.filter((cell) => (cell.applicability ?? "active") !== "not_applicable");
    for (const cell of input.cells) store.upsertCell(cell);

    const claims = this.deterministic.fill({
      cells: active,
      decisions: input.decisions,
      ...(input.rules ? { rules: input.rules } : {}),
      ...(input.elaborations ? { elaborations: input.elaborations } : {}),
      ...(input.policies ? { policies: input.policies } : {}),
      ...(input.chosenOptions ? { chosenOptions: input.chosenOptions } : {}),
    });

    const outcomes: CellOutcome[] = [];
    const work: RequirementWork[] = [];
    const open: OpenCell[] = [];
    for (const cell of active) {
      const prior = readPrior(store, input.graph, cell.id);
      const claim = claims.get(cell.id) ?? null;
      if (claim && prior && prior.sourceHash === claim.sourceHash) {
        outcomes.push(outcomeFromPrior(cell, prior));
        continue;
      }
      if (claim) {
        work.push(workFromClaim(cell, claim));
        continue;
      }
      if (
        prior &&
        prior.pass === 3 &&
        prior.sourceHash === upstream &&
        prior.reviewStatus !== "needs_review"
      ) {
        outcomes.push(outcomeFromPrior(cell, prior));
        continue;
      }
      open.push(cell);
    }

    const knownFills = new Map<string, { earsText: string; pass: 1 | 2; sourceId: string }>();
    for (const cell of active) {
      const claim = claims.get(cell.id);
      const sourceId = claim?.sourceIds[0];
      if (claim && sourceId) {
        knownFills.set(cell.id, { earsText: claim.earsText, pass: claim.pass, sourceId });
      }
    }

    const expanded =
      open.length === 0
        ? { cells: [] as Pass3CellResult[], diagnostics: [] as FillDiagnostic[], llmCalls: 0, tokensSpent: 0 }
        : this.pass3.expand({
            cells: open,
            model: input.model,
            premiseIds: input.decisions.map((decision) => decision.id),
            budget,
            forbiddenScopePhrases: input.forbiddenScopePhrases ?? [],
            knownFills,
            contradiction,
            attempt: input.attempt ?? "spec-expander@1",
          });

    const asks: AskWork[] = [];
    for (const cellResult of expanded.cells) {
      const cell = open.find((item) => item.id === cellResult.cellId);
      if (!cell) continue;
      if (cellResult.kind === "must_ask") {
        asks.push({
          cell,
          question: cellResult.question ?? `Blocking Discovery question for ${cell.title}.`,
          forcedHigh: cellResult.forcedHigh,
          modelRisk: cellResult.modelRisk ?? "high",
          earsText: cellResult.earsText,
          oracleSketch: cellResult.oracleSketch,
          premises: cellResult.premises,
        });
        continue;
      }
      if (cellResult.kind === "needs_review" || !cellResult.earsText || !cellResult.oracleSketch || !cellResult.risk) {
        const fill = fillFor(cell, {
          pass: 3,
          basis: "proposed",
          risk: cellResult.risk ?? "low",
          value: cellResult.value ?? "",
          earsText: cellResult.earsText ?? "",
          oracleSketch: cellResult.oracleSketch ?? "",
          sourceIds: cellResult.premises,
          sourceHash: upstream,
          upstreamDecisionHash: upstream,
          requirementId: null,
          reviewStatus: "needs_review",
        });
        store.saveFill(cell.id, fill);
        rememberFill(input.graph, cell, fill, input.featureTitles ?? {});
        outcomes.push({
          cellId: cell.id,
          featureId: cell.featureId,
          matrixId: cell.matrixId,
          disposition: "needs_review",
          pass: 3,
          basis: null,
          risk: cellResult.risk,
          earsText: cellResult.earsText,
          oracleSketch: cellResult.oracleSketch,
          value: cellResult.value,
          sourceIds: cellResult.premises,
          sourceHash: upstream,
          requirementId: null,
          unchanged: false,
        });
        continue;
      }
      work.push({
        cell,
        pass: 3,
        basis: "proposed",
        risk: cellResult.risk,
        value: cellResult.value ?? cellResult.earsText,
        earsText: cellResult.earsText,
        oracleSketch: cellResult.oracleSketch,
        sourceIds: cellResult.premises,
        sourceHash: upstream,
        reviewStatus: cellResult.kind === "review" ? "proposed" : "auto_accepted",
        status: cellResult.kind === "review" ? "draft" : "active",
        provenance: premisesToNodes(cellResult.premises, input.decisions, cell.featureId),
      });
    }

    const diagnostics = [...expanded.diagnostics];
    const committed = commitWork(input.graph, work, asks, input.decisions, input.featureTitles ?? {}, diagnostics);
    for (const item of committed.requirements) {
      const fill = fillFor(item.cell, {
        pass: item.pass,
        basis: item.basis,
        risk: item.risk,
        value: item.value,
        earsText: item.earsText,
        oracleSketch: item.oracleSketch,
        sourceIds: item.sourceIds,
        sourceHash: item.sourceHash,
        upstreamDecisionHash: item.pass === 3 ? upstream : item.sourceHash,
        requirementId: item.requirementId,
        reviewStatus: item.reviewStatus,
      });
      store.saveFill(item.cell.id, fill);
      outcomes.push({
        cellId: item.cell.id,
        featureId: item.cell.featureId,
        matrixId: item.cell.matrixId,
        disposition: "filled",
        pass: item.pass,
        basis: item.basis,
        risk: item.risk,
        earsText: item.earsText,
        oracleSketch: item.oracleSketch,
        value: item.value,
        sourceIds: item.sourceIds,
        sourceHash: item.sourceHash,
        requirementId: item.requirementId,
        unchanged: false,
      });
      if (item.reviewStatus === "auto_accepted" && item.risk === "low") {
        chosenForYou.record({
          cellId: item.cell.id,
          featureId: item.cell.featureId,
          basis: "proposed",
          risk: "low",
          earsText: item.earsText,
          oracleSketch: item.oracleSketch,
          autoAccepted: true,
          requirementId: item.requirementId,
        });
      }
    }

    const mustAsk: MustAskQuestion[] = committed.asks.map((ask) => ({
      cellId: ask.cell.id,
      featureId: ask.cell.featureId,
      nodeId: ask.nodeId,
      question: ask.question,
      touches: ask.cell.touches,
      blocking: true,
      target: "discovery",
      forcedHigh: ask.forcedHigh,
      modelRisk: ask.modelRisk,
    }));
    for (const ask of committed.asks) {
      const fill = fillFor(ask.cell, {
        pass: 3,
        basis: "proposed",
        risk: "high",
        value: "",
        earsText: ask.earsText ?? ask.question,
        oracleSketch: ask.oracleSketch ?? ask.question,
        sourceIds: ask.premises,
        sourceHash: upstream,
        upstreamDecisionHash: upstream,
        requirementId: null,
        reviewStatus: "must_ask",
      });
      store.saveFill(ask.cell.id, fill);
      outcomes.push({
        cellId: ask.cell.id,
        featureId: ask.cell.featureId,
        matrixId: ask.cell.matrixId,
        disposition: "escalated",
        pass: 3,
        basis: null,
        risk: "high",
        earsText: ask.earsText,
        oracleSketch: ask.oracleSketch,
        value: null,
        sourceIds: ask.premises,
        sourceHash: upstream,
        requirementId: null,
        unchanged: false,
      });
    }

    for (const cell of input.cells) {
      if ((cell.applicability ?? "active") === "not_applicable") {
        outcomes.push({
          cellId: cell.id,
          featureId: cell.featureId,
          matrixId: cell.matrixId,
          disposition: "not_applicable",
          pass: null,
          basis: null,
          risk: null,
          earsText: null,
          oracleSketch: null,
          value: null,
          sourceIds: [],
          sourceHash: null,
          requirementId: null,
          unchanged: false,
        });
      }
    }

    this.materializedRequirements = materializedFrom(committed.requirements);
    const counted = outcomes.filter((outcome) => outcome.disposition !== "not_applicable");
    const metrics = buildFillMetrics(
      counted.length,
      counted.filter((outcome) => outcome.pass === 1).length,
      counted.filter((outcome) => outcome.pass === 2).length,
      counted.filter((outcome) => outcome.pass === 3).length,
      expanded.tokensSpent,
      expanded.llmCalls,
    );
    return {
      outcomes,
      metrics,
      diagnostics,
      mustAsk,
      review: new ProposedRequirementReviewQueue(input.graph, contradiction, store),
      chosenForYou,
      contradiction,
      store,
      llmCalls: expanded.llmCalls,
      tokensSpent: expanded.tokensSpent,
    };
  }
}

function materializedFrom(items: readonly CommittedRequirement[]): ListedMaterializedRequirement[] {
  const seen = new Set<string>();
  const listed: ListedMaterializedRequirement[] = [];
  for (const item of items) {
    if (seen.has(item.requirementId)) continue;
    seen.add(item.requirementId);
    const entities = item.cell.subject.length > 0 ? [item.cell.subject] : [];
    listed.push({
      id: item.requirementId,
      text: item.earsText,
      earsText: item.earsText,
      entities,
      touches: [...item.cell.touches],
      featureId: item.cell.featureId,
      pass: item.pass,
      basis: item.basis,
      status: item.status,
    });
  }
  return listed;
}

function workFromClaim(cell: OpenCell, claim: DeterministicClaim): RequirementWork {
  const sourceId = claim.sourceIds[0] ?? claim.cellId;
  return {
    cell,
    pass: claim.pass,
    basis: claim.basis,
    risk: "low",
    value: claim.value,
    earsText: claim.earsText,
    oracleSketch: claim.oracleSketch,
    sourceIds: claim.sourceIds,
    sourceHash: claim.sourceHash,
    reviewStatus: "settled",
    status: "active",
    provenance: [
      {
        id: sourceId,
        kind: claim.provenanceKind === "decision" ? "decision" : claim.provenanceKind === "elaboration" ? "source" : "ccr",
        title: claim.provenanceTitle,
        text: claim.provenanceText,
        fields: claim.provenanceFields,
      },
    ],
  };
}

function premisesToNodes(
  premises: readonly string[],
  decisions: readonly SettledDecision[],
  featureId: string,
): ProvenanceNode[] {
  const nodes: ProvenanceNode[] = [];
  for (const premise of premises) {
    const decision = decisions.find((item) => item.id === premise);
    if (!decision) continue;
    nodes.push({
      id: decision.id,
      kind: "decision",
      title: decision.title,
      text: decision.text,
      fields: { feature: featureId, basis: decision.basis, content_hash: decision.contentHash },
    });
  }
  return nodes;
}

interface CommittedRequirement extends RequirementWork {
  readonly requirementId: string;
}

interface CommittedAsk extends AskWork {
  readonly nodeId: string;
}

function commitWork(
  graph: FillerStateDb,
  work: readonly RequirementWork[],
  asks: readonly AskWork[],
  decisions: readonly SettledDecision[],
  featureTitles: Readonly<Record<string, string>>,
  diagnostics: FillDiagnostic[],
): { requirements: CommittedRequirement[]; asks: CommittedAsk[] } {
  const requirements = assignRequirementIds(graph, work, diagnostics);
  const committedAsks = asks.map((ask) => ({ ...ask, nodeId: askNodeId(ask.cell.id) }));
  if (requirements.length === 0 && committedAsks.length === 0) {
    return { requirements, asks: committedAsks };
  }
  const nodes: (NodeCreate | NodeUpdate)[] = [];
  const edges: EdgeCreate[] = [];
  const seenNodes = new Set<string>();

  const touchNode = (node: ProvenanceNode) => {
    if (seenNodes.has(node.id)) return;
    seenNodes.add(node.id);
    const current = graph.getNode(node.id);
    if (!current) {
      nodes.push({
        op: "create",
        id: node.id,
        kind: node.kind,
        title: node.title,
        text: node.text,
        status: "active",
        fields: node.fields,
      });
      return;
    }
    nodes.push({
      op: "update",
      id: node.id,
      title: node.title,
      text: node.text,
      status: "active",
      fields: node.fields,
    });
  };

  for (const decision of decisions) {
    touchNode({
      id: decision.id,
      kind: "decision",
      title: decision.title,
      text: decision.text,
      fields: { feature: requirements[0]?.cell.featureId ?? asks[0]?.cell.featureId ?? "", basis: decision.basis, content_hash: decision.contentHash },
    });
  }

  for (const item of requirements) {
    const featureTitle = featureTitles[item.cell.featureId] ?? item.cell.featureId;
    touchNode({
      id: item.cell.featureId,
      kind: "feature",
      title: featureTitle,
      text: featureTitle,
      fields: { feature: item.cell.featureId },
    });
    for (const provenance of item.provenance) touchNode(provenance);
    const fill = fillFor(item.cell, {
      pass: item.pass,
      basis: item.basis,
      risk: item.risk,
      value: item.value,
      earsText: item.earsText,
      oracleSketch: item.oracleSketch,
      sourceIds: item.sourceIds,
      sourceHash: item.sourceHash,
      upstreamDecisionHash: item.pass === 3 ? item.sourceHash : item.sourceHash,
      requirementId: item.requirementId,
      reviewStatus: item.reviewStatus,
    });
    touchNode({
      id: item.cell.id,
      kind: "source",
      title: item.cell.title,
      text: item.cell.subject,
      fields: {
        feature: item.cell.featureId,
        matrix_id: item.cell.matrixId,
        subject: item.cell.subject,
        touches: [...item.cell.touches],
        fill,
      },
    });
  }

  const grouped = new Map<string, CommittedRequirement[]>();
  for (const item of requirements) {
    const list = grouped.get(item.requirementId);
    if (list) list.push(item);
    else grouped.set(item.requirementId, [item]);
  }
  for (const [requirementId, items] of grouped) {
    const primary = items[0];
    if (!primary) continue;
    const cellIds = [...new Set(items.map((item) => item.cell.id))];
    const sourceIds = [...new Set(items.flatMap((item) => item.sourceIds))];
    const fields = requirementFields(primary, cellIds, sourceIds);
    const current = graph.getNode(requirementId);
    if (!current) {
      nodes.push({
        op: "create",
        id: requirementId,
        kind: "spec_item",
        title: primary.cell.title,
        text: primary.earsText,
        status: primary.status,
        fields,
      });
    } else {
      nodes.push({
        op: "update",
        id: requirementId,
        title: primary.cell.title,
        text: primary.earsText,
        status: primary.status,
        fields,
      });
    }
    edges.push({ op: "create", src: requirementId, type: "belongs_to", dst: primary.cell.featureId });
    for (const cellId of cellIds) {
      edges.push({ op: "create", src: requirementId, type: "derived_from", dst: cellId });
    }
    for (const sourceId of sourceIds) {
      if (graph.getNode(sourceId) || seenNodes.has(sourceId)) {
        edges.push({ op: "create", src: requirementId, type: "derived_from", dst: sourceId });
      }
    }
  }

  for (const ask of committedAsks) {
    const featureTitle = featureTitles[ask.cell.featureId] ?? ask.cell.featureId;
    touchNode({
      id: ask.cell.featureId,
      kind: "feature",
      title: featureTitle,
      text: featureTitle,
      fields: { feature: ask.cell.featureId },
    });
    const fill = fillFor(ask.cell, {
      pass: 3,
      basis: "proposed",
      risk: "high",
      value: "",
      earsText: ask.earsText ?? ask.question,
      oracleSketch: ask.oracleSketch ?? ask.question,
      sourceIds: ask.premises,
      sourceHash: upstreamDecisionHash(decisions),
      upstreamDecisionHash: upstreamDecisionHash(decisions),
      requirementId: null,
      reviewStatus: "must_ask",
    });
    touchNode({
      id: ask.cell.id,
      kind: "source",
      title: ask.cell.title,
      text: ask.cell.subject,
      fields: {
        feature: ask.cell.featureId,
        matrix_id: ask.cell.matrixId,
        subject: ask.cell.subject,
        touches: [...ask.cell.touches],
        fill,
      },
    });
    const existing = graph.getNode(ask.nodeId);
    const fields = {
      feature: ask.cell.featureId,
      cell_id: ask.cell.id,
      must_ask: true,
      blocking: true,
      question: ask.question,
      touches: [...ask.cell.touches],
      forced_high: ask.forcedHigh,
      model_risk: ask.modelRisk,
    };
    if (!existing) {
      nodes.push({
        op: "create",
        id: ask.nodeId,
        kind: "decision",
        title: `Must ask: ${ask.cell.title}`,
        text: ask.question,
        status: "draft",
        fields,
      });
    } else {
      nodes.push({
        op: "update",
        id: ask.nodeId,
        title: `Must ask: ${ask.cell.title}`,
        text: ask.question,
        status: "draft",
        fields,
      });
    }
    edges.push({ op: "create", src: ask.nodeId, type: "belongs_to", dst: ask.cell.featureId });
    edges.push({ op: "create", src: ask.nodeId, type: "derived_from", dst: ask.cell.id });
  }

  const stamp = hashParts([
    ...nodes.map((node) => `${node.op}:${node.id}:${"text" in node ? node.text ?? "" : ""}`),
    ...edges.map((edge) => `${edge.src}:${edge.type}:${edge.dst}`),
  ]);
  graph.commitChangeSet({
    id: `CS-${stamp.slice("sha256:".length, "sha256:".length + 16)}`,
    origin: "kernel",
    author: "spec-expander@1",
    summary: "Fill spec matrix cells",
    nodes,
    edges,
  });
  return { requirements, asks: committedAsks };
}

function assignRequirementIds(
  graph: FillerStateDb,
  work: readonly RequirementWork[],
  diagnostics: FillDiagnostic[],
): CommittedRequirement[] {
  let sequence = maxSpecSequence(graph);
  const byNorm = new Map<string, string>();
  const committed: CommittedRequirement[] = [];
  for (const item of work) {
    const norm = `${item.cell.featureId}\u0000${normalizeEars(item.earsText)}`;
    const existingNorm = byNorm.get(norm) ?? graph.findRequirementByNorm(item.cell.featureId, normalizeEars(item.earsText))?.id;
    const own = findRequirementForCell(graph, item.cell.id);
    if (existingNorm && existingNorm !== own?.id) {
      diagnostics.push({
        code: "duplicate_requirement",
        cellId: item.cell.id,
        message: `cell ${item.cell.id} reuses requirement ${existingNorm}`,
      });
      byNorm.set(norm, existingNorm);
      committed.push({ ...item, requirementId: existingNorm });
      continue;
    }
    const requirementId = own?.id ?? formatSpecItemId(sequence + 1);
    if (!own) sequence += 1;
    byNorm.set(norm, requirementId);
    committed.push({ ...item, requirementId });
  }
  return committed;
}

function requirementFields(
  item: RequirementWork,
  cellIds: readonly string[],
  sourceIds: readonly string[],
): Record<string, unknown> {
  return {
    feature: item.cell.featureId,
    basis: item.basis,
    risk: item.risk,
    touches: [...item.cell.touches],
    ears_text: item.earsText,
    oracle_sketch: item.oracleSketch,
    ears_norm: normalizeEars(item.earsText),
    cell_id: item.cell.id,
    cell_ids: [...cellIds],
    matrix_id: item.cell.matrixId,
    pass: item.pass,
    source_ids: [...sourceIds],
    source_hash: item.sourceHash,
    review_status: item.reviewStatus,
    pattern: earsPatternName(item.earsText),
    value: item.value,
  };
}

function fillFor(cell: OpenCell, fill: Omit<PersistedFill, "cellId">): PersistedFill {
  return { ...fill, cellId: cell.id };
}

function rememberFill(
  graph: FillerStateDb,
  cell: OpenCell,
  fill: PersistedFill,
  featureTitles: Readonly<Record<string, string>>,
): void {
  const current = graph.getNode(cell.id);
  const fields = {
    feature: cell.featureId,
    matrix_id: cell.matrixId,
    subject: cell.subject,
    touches: [...cell.touches],
    fill,
  };
  graph.commitChangeSet({
    id: `CS-cell-${hashParts([cell.id, fill.sourceHash, fill.reviewStatus]).slice(7, 23)}`,
    origin: "kernel",
    author: "spec-expander@1",
    summary: `Record unresolved cell ${cell.id}`,
    nodes: [
      current
        ? { op: "update", id: cell.id, title: cell.title, text: cell.subject, status: "active", fields }
        : {
            op: "create",
            id: cell.id,
            kind: "source",
            title: cell.title,
            text: cell.subject,
            status: "active",
            fields,
          },
      ...(graph.getNode(cell.featureId)
        ? []
        : [
            {
              op: "create" as const,
              id: cell.featureId,
              kind: "feature",
              title: featureTitles[cell.featureId] ?? cell.featureId,
              text: featureTitles[cell.featureId] ?? cell.featureId,
              status: "active" as const,
              fields: { feature: cell.featureId },
            },
          ]),
    ],
  });
}

function outcomeFromPrior(cell: OpenCell, prior: PersistedFill): CellOutcome {
  const disposition =
    prior.reviewStatus === "must_ask"
      ? "escalated"
      : prior.reviewStatus === "needs_review" || prior.reviewStatus === "rejected"
        ? "needs_review"
        : "filled";
  return {
    cellId: cell.id,
    featureId: cell.featureId,
    matrixId: cell.matrixId,
    disposition,
    pass: prior.pass,
    basis: disposition === "filled" ? prior.basis : null,
    risk: prior.risk,
    earsText: prior.earsText,
    oracleSketch: prior.oracleSketch,
    value: prior.value,
    sourceIds: prior.sourceIds,
    sourceHash: prior.sourceHash,
    requirementId: prior.requirementId,
    unchanged: true,
  };
}

function readPrior(
  store: MatrixCellPersistencePort,
  graph: FillerStateDb,
  cellId: string,
): PersistedFill | null {
  const stored = store.getCell(cellId)?.fill ?? fillFromNode(graph.getNode(cellId));
  const spec = findRequirementForCell(graph, cellId);
  if (!spec) return stored;
  const review = reviewStatusOf(spec.status, spec.basis, spec.fields.review_status);
  if (!stored) {
    return {
      cellId,
      pass: spec.fields.pass === 1 || spec.fields.pass === 2 || spec.fields.pass === 3 ? spec.fields.pass : 3,
      basis: isBasis(spec.basis) ? spec.basis : "proposed",
      risk: isRisk(spec.fields.risk) ? spec.fields.risk : "low",
      value: typeof spec.fields.value === "string" ? spec.fields.value : spec.text,
      earsText: spec.text,
      oracleSketch: typeof spec.fields.oracle_sketch === "string" ? spec.fields.oracle_sketch : "",
      sourceIds: stringList(spec.fields.source_ids),
      sourceHash: typeof spec.fields.source_hash === "string" ? spec.fields.source_hash : "",
      upstreamDecisionHash: typeof spec.fields.source_hash === "string" ? spec.fields.source_hash : "",
      requirementId: spec.id,
      reviewStatus: review,
    };
  }
  return {
    ...stored,
    earsText: spec.text,
    oracleSketch: typeof spec.fields.oracle_sketch === "string" ? spec.fields.oracle_sketch : stored.oracleSketch,
    basis: isBasis(spec.basis) ? spec.basis : stored.basis,
    reviewStatus: review,
    requirementId: spec.id,
  };
}

function fillFromNode(node: { fields: Record<string, unknown> } | null): PersistedFill | null {
  if (!node) return null;
  return isFill(node.fields.fill) ? node.fields.fill : null;
}

function findRequirementForCell(graph: FillerStateDb, cellId: string) {
  return (
    graph.requirements().find((node) => {
      if (node.status === "retired") return false;
      if (node.fields.cell_id === cellId) return true;
      return Array.isArray(node.fields.cell_ids) && node.fields.cell_ids.includes(cellId);
    }) ?? null
  );
}

function reviewStatusOf(
  status: string,
  basis: string | null,
  review: unknown,
): PersistedFill["reviewStatus"] {
  if (status === "superseded" || review === "rejected") return "rejected";
  if (review === "must_ask") return "must_ask";
  if (review === "needs_review") return "needs_review";
  if (review === "auto_accepted") return "auto_accepted";
  if (status === "draft" && basis === "proposed") return "proposed";
  return "settled";
}

function maxSpecSequence(graph: FillerStateDb): number {
  let max = 0;
  for (const node of graph.requirements()) {
    const match = /^SI-(\d+)$/.exec(node.id);
    if (!match?.[1]) continue;
    max = Math.max(max, Number(match[1]));
  }
  return max;
}

function askNodeId(cellId: string): string {
  return `ASK-${hashParts([cellId]).slice("sha256:".length, "sha256:".length + 12)}`;
}

function isBasis(value: string | null): value is FillBasis {
  return value === "explicit" || value === "derived" || value === "delegated" || value === "defaulted" || value === "proposed";
}

function isRisk(value: unknown): value is RiskTier {
  return value === "low" || value === "medium" || value === "high";
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function isFill(value: unknown): value is PersistedFill {
  if (typeof value !== "object" || value === null) return false;
  const fill = value as Partial<PersistedFill>;
  return typeof fill.cellId === "string" && typeof fill.sourceHash === "string" && (fill.pass === 1 || fill.pass === 2 || fill.pass === 3);
}

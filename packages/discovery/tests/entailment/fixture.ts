import {
  FakeModelAdapter,
  InMemoryKnowledgeGraph,
  LocalExactQuoteEvidenceVerifier,
  MapInferenceCatalog,
  MemoryEntailmentMetrics,
  SemanticEntailmentGate,
  writeDecision,
  type CitedExcerpt,
  type DecisionEdge,
  type DecisionFields,
  type EntailmentClaim,
  type EntailmentModelResponse,
  type JsonValue,
  type ModelRoster,
  type TurnDirectory,
  type TurnSnapshot,
} from "../../src/entailment/index.js";

export const PHONE_QUOTE = "Staff use a link on a phone";
export const PHONE_QUOTE_THEIRS = "Staff use a link on their phones";

export function turn(id: string, text: string, author: TurnSnapshot["author"] = "developer"): TurnSnapshot {
  return { id, author, text };
}

export function excerpt(source: TurnSnapshot, quote: string, extras: Partial<CitedExcerpt> = {}): CitedExcerpt {
  const start = extras.start ?? source.text.indexOf(quote);
  const end = extras.end ?? (start >= 0 ? start + quote.length : quote.length);
  return {
    turnId: extras.turnId ?? source.id,
    author: extras.author ?? source.author,
    support: extras.support ?? "cited_for_derivation",
    quote,
    surroundingParagraph: extras.surroundingParagraph ?? source.text,
    start,
    end,
    retracted: extras.retracted ?? false,
    superseded: extras.superseded ?? false,
    lowConfidence: extras.lowConfidence ?? false,
    valueKind: extras.valueKind ?? "other",
  };
}

export function decisionFields(
  overrides: Partial<DecisionFields> & Pick<DecisionFields, "criterion" | "status">,
): DecisionFields {
  return {
    criterion: overrides.criterion,
    status: overrides.status,
    value: overrides.value === undefined ? null : overrides.value,
    basis: overrides.basis === undefined ? null : overrides.basis,
    rule: overrides.rule === undefined ? null : overrides.rule,
    premises: overrides.premises ?? [],
    evidence: overrides.evidence ?? [],
    retracted: overrides.retracted ?? false,
    feature: overrides.feature === undefined ? null : overrides.feature,
    costly: overrides.costly ?? false,
    reversibility: overrides.reversibility ?? "easy",
    mustAsk: overrides.mustAsk ?? false,
    criterionKind: overrides.criterionKind ?? "general",
    release: overrides.release ?? "current",
    changeSummary: overrides.changeSummary === undefined ? null : overrides.changeSummary,
    entailmentVerdict: overrides.entailmentVerdict === undefined ? null : overrides.entailmentVerdict,
    entailmentReason: overrides.entailmentReason === undefined ? null : overrides.entailmentReason,
  };
}

export function seed(
  graph: InMemoryKnowledgeGraph,
  id: string,
  fields: DecisionFields,
  edges: readonly DecisionEdge[] = [],
): void {
  writeDecision(graph, {
    id,
    kind: "decision",
    title: fields.criterion,
    text: typeof fields.value === "string" ? fields.value : fields.criterion,
    fields,
    nodeStatus: "active",
    edges,
    retireEdges: [],
    summary: `seed ${id}`,
  });
}

export class MapTurns implements TurnDirectory {
  constructor(private readonly turns: readonly TurnSnapshot[]) {}

  get(turnId: string): TurnSnapshot | null {
    return this.turns.find((item) => item.id === turnId) ?? null;
  }
}

export const crossFamilyRoster: ModelRoster = {
  connected: [
    { family: "batch-family", modelId: "resolver-a" },
    { family: "check-family", modelId: "entailment-b" },
  ],
  batchResolve: { family: "batch-family", modelId: "resolver-a" },
};

export function claim(input: {
  decisionId: string;
  criterion: string;
  basis?: EntailmentClaim["basis"];
  value?: JsonValue;
  excerpts: readonly CitedExcerpt[];
  rule?: string | null;
  premises?: readonly string[];
  costly?: boolean;
  reversibility?: EntailmentClaim["reversibility"];
  mustAsk?: boolean;
  feature?: string | null;
  criterionKind?: string;
}): EntailmentClaim {
  return {
    decisionId: input.decisionId,
    criterion: input.criterion,
    criterionKind: input.criterionKind ?? "access",
    basis: input.basis ?? "derived",
    proposedValue: input.value === undefined ? true : input.value,
    excerpts: input.excerpts,
    rule: input.rule === undefined ? "infer.phone_menu_access" : input.rule,
    premises: input.premises ?? [],
    costly: input.costly ?? false,
    reversibility: input.reversibility ?? "easy",
    mustAsk: input.mustAsk ?? false,
    feature: input.feature === undefined ? null : input.feature,
    resolverModel: { family: "batch-family", modelId: "resolver-a" },
  };
}

export function gateFor(
  respond: (request: Parameters<FakeModelAdapter["complete"]>[0]) => EntailmentModelResponse,
  rules: ReadonlyMap<string, readonly string[]>,
  turns: readonly TurnSnapshot[],
  roster: ModelRoster = crossFamilyRoster,
): {
  graph: InMemoryKnowledgeGraph;
  adapter: FakeModelAdapter;
  metrics: MemoryEntailmentMetrics;
  gate: SemanticEntailmentGate;
} {
  const graph = new InMemoryKnowledgeGraph();
  const adapter = new FakeModelAdapter(respond);
  const metrics = new MemoryEntailmentMetrics();
  const gate = new SemanticEntailmentGate({
    graph,
    catalog: new MapInferenceCatalog(rules),
    quotes: new LocalExactQuoteEvidenceVerifier(),
    turns: new MapTurns(turns),
    models: roster,
    adapter,
    metrics,
  });
  return { graph, adapter, metrics, gate };
}

export const phoneRules = new Map<string, readonly string[]>([
  ["menu.mobile_web", ["infer.phone_menu_access"]],
  ["app.offline_support", ["infer.offline_support"]],
  ["app.native_mobile", ["infer.native_app"]],
]);

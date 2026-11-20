import type {
  KnowledgeNode,
  MatchableRule,
  PullCallContext,
} from "../../src/rule-matching/index.js";

export function knowledgeNode(
  overrides: Partial<KnowledgeNode> & Pick<KnowledgeNode, "id" | "title">,
): KnowledgeNode {
  return {
    kind: "note",
    prose: overrides.title,
    tags: [],
    status: "active",
    hidden: false,
    visibility: "",
    canonical: {},
    outgoingContractLinks: [],
    schemas: [],
    seams: [],
    errorCodes: [],
    version: 1,
    rev: 1,
    couldIndex: false,
    band: "COULD",
    tokenCost: 10,
    ...overrides,
  };
}

export function pullContext(
  overrides: Partial<PullCallContext> & Pick<PullCallContext, "attemptId">,
): PullCallContext {
  return {
    taskId: "T-1",
    projectId: "proj",
    waveId: "wave-1",
    waveIndex: 1,
    turnId: "turn-1",
    taskTags: ["api"],
    workerLevel: "junior",
    ...overrides,
  };
}

export function projectRule(overrides: Partial<MatchableRule> & Pick<MatchableRule, "id">): MatchableRule {
  return {
    title: overrides.id,
    kind: "project",
    active: true,
    global: false,
    any: null,
    all: null,
    appliesAs: "must",
    checkIds: [`${overrides.id}-CHECK`],
    ...overrides,
  };
}

export function steppingClock(): { now(): number; latency(): number } {
  let tick = 0;
  return {
    now() {
      tick += 5;
      return tick;
    },
    latency: () => 5,
  };
}

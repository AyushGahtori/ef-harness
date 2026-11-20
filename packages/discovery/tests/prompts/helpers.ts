import {
  DiscoveryPromptOrchestrator,
  FakeModelAdapter,
} from "../../src/prompts/index.js";
import type {
  BatchCriterion,
  BatchProposal,
  DiscoveryTurn,
  EvidenceSpan,
  ModelCompletionRequest,
  ModelProtocolAdapter,
} from "../../src/prompts/index.js";

export function locate(text: string, quote: string, turn = "T1"): EvidenceSpan {
  const start = text.indexOf(quote);
  if (start < 0) throw new Error(`quote not found: ${quote}`);
  return { turn, start, end: start + quote.length, quote };
}

export function developerTurn(id: string, text: string, extra: Partial<DiscoveryTurn> = {}): DiscoveryTurn {
  return { id, author: "developer", text, ...extra };
}

export function proposal(overrides: Partial<BatchProposal> & Pick<BatchProposal, "criterion" | "question">): BatchProposal {
  return {
    status: "settled",
    basis: "explicit",
    value: null,
    evidence: [],
    rule: null,
    premises: [],
    delegation: null,
    conflict: null,
    missing_detail: null,
    ...overrides,
  };
}

export function criterion(
  id: string,
  questionId: string,
  extra: Omit<Partial<BatchCriterion>, "id" | "questionId"> = {},
): BatchCriterion {
  return { id, questionId, ...extra };
}

export function adapters(respond: (request: ModelCompletionRequest) => string): {
  primary: FakeModelAdapter;
  stronger: FakeModelAdapter;
  orchestrator: DiscoveryPromptOrchestrator;
} {
  const primary = new FakeModelAdapter(respond);
  const stronger = new FakeModelAdapter(() => {
    throw new Error("unexpected stronger reviewer call");
  });
  return {
    primary,
    stronger,
    orchestrator: new DiscoveryPromptOrchestrator({ primary, strongerReviewer: stronger }),
  };
}

export function scripted(primary: ModelProtocolAdapter, stronger: ModelProtocolAdapter): DiscoveryPromptOrchestrator {
  return new DiscoveryPromptOrchestrator({ primary, strongerReviewer: stronger });
}

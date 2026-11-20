import type { InferenceRuleCatalog } from "./catalog.js";
import { writeDecision } from "./commit-decision.js";
import { currentPremiseIds, DerivationChainValidator } from "./derivation-chain-validator.js";
import {
  CostlyDerivationError,
  CyclicDerivationError,
  RuleNotAllowlistedError,
  UngroundedDerivationError,
  UnsettledPremiseError,
} from "./errors.js";
import type { EntailmentModelPort, EntailmentModelRequest, EntailmentModelResponse } from "./fake-model-adapter.js";
import type { KnowledgeGraphPort } from "./graph-port.js";
import { LowConfidenceDictationHold } from "./low-confidence-hold.js";
import type { EntailmentMetricSink } from "./metrics.js";
import type { ExactQuoteEvidenceVerifier, TurnDirectory } from "./quote-port.js";
import { selectEntailmentModel, type ModelRoster } from "./routing.js";
import { isBlockedEntailment, parseEntailmentCheckerV1 } from "./schema.js";
import {
  needsEntailmentCheck,
  type DecisionFields,
  type DerivationProposal,
  type EntailmentClaim,
  type EntailmentClaimResult,
  type MetricVerdict,
  type SettledBasis,
} from "./types.js";

export interface SemanticEntailmentGateDeps {
  readonly graph: KnowledgeGraphPort;
  readonly catalog: InferenceRuleCatalog;
  readonly quotes: ExactQuoteEvidenceVerifier;
  readonly turns: TurnDirectory;
  readonly models: ModelRoster;
  readonly adapter: EntailmentModelPort;
  readonly metrics: EntailmentMetricSink;
}

export interface EntailmentBatchResult {
  readonly results: readonly EntailmentClaimResult[];
}

/**
 * Batches `entailment-checker@1` for every derived claim and every costly or
 * hard-to-reverse explicit claim. Only `establishes` can settle. `leaves_open`,
 * timeouts, and HTTP 503 stay pending and earn zero readiness credit.
 * `contradicts` is stored as a conflict. The model sees only the claim packet.
 */
export class SemanticEntailmentGate {
  private readonly validator: DerivationChainValidator;
  private readonly confidence = new LowConfidenceDictationHold();

  constructor(private readonly deps: SemanticEntailmentGateDeps) {
    this.validator = new DerivationChainValidator(deps.graph, deps.catalog);
  }

  checkAll(claims: readonly EntailmentClaim[]): EntailmentBatchResult {
    const pending = claims.filter((claim) => claim.basis === "derived").map((claim) => toProposal(claim));
    return { results: claims.map((claim) => this.check(claim, pending)) };
  }

  check(claim: EntailmentClaim, pending: readonly DerivationProposal[] = []): EntailmentClaimResult {
    try {
      return this.evaluate(claim, pending);
    } catch (error) {
      const known =
        error instanceof RuleNotAllowlistedError ||
        error instanceof CyclicDerivationError ||
        error instanceof UnsettledPremiseError ||
        error instanceof UngroundedDerivationError ||
        error instanceof CostlyDerivationError;
      if (!known) throw error;
      return {
        decisionId: claim.decisionId,
        criterion: claim.criterion,
        outcome: "rejected",
        basis: null,
        verdict: null,
        reason: error instanceof Error ? error.message : "rejected",
        credit: false,
        modelInvoked: false,
        changeSummary: null,
        errorName: error instanceof Error ? error.name : "Error",
      };
    }
  }

  private evaluate(claim: EntailmentClaim, pending: readonly DerivationProposal[]): EntailmentClaimResult {
    if (claim.basis === "derived") {
      const siblings = pending.filter((item) => item.decisionId !== claim.decisionId);
      this.validator.validate(toProposal(claim), siblings);
    }
    const quoted = this.verifyQuotes(claim);
    if (!quoted.ok) {
      this.persist(claim, "pending_verification", null, null, quoted.reason, null, []);
      return result(claim, "pending_verification", null, null, quoted.reason, false, null, null);
    }
    const held = this.confidence.assess({ proposedValue: claim.proposedValue, excerpts: claim.excerpts });
    if (held.held) {
      this.persist(claim, "open", null, null, held.summary ?? "held", held.summary, []);
      return result(claim, "open", null, null, held.summary ?? "held", false, held.summary, null);
    }
    if (!needsEntailmentCheck(claim)) {
      this.persist(claim, "settled", "explicit", null, "explicit quote established the value", null, []);
      return result(claim, "settled", "explicit", null, "explicit quote established the value", true, null, null);
    }
    const selected = selectEntailmentModel(this.deps.models);
    const request: EntailmentModelRequest = {
      contractId: "entailment-checker@1",
      family: selected.family,
      modelId: selected.modelId,
      payload: {
        criterion: claim.criterion,
        proposedValue: claim.proposedValue,
        citedExcerptsWithSurroundingParagraph: claim.excerpts.map((excerpt) => ({
          quote: excerpt.quote,
          surroundingParagraph: excerpt.surroundingParagraph,
        })),
        rule: claim.rule,
        premises: [...claim.premises],
      },
    };
    const response = this.complete(request);
    if (!response.ok) {
      const detail = response.statusCode === null ? response.failure : `${response.failure} ${response.statusCode}`;
      this.deps.metrics.record({
        resolverModel: claim.resolverModel.modelId,
        entailmentModel: selected.modelId,
        verdict: "unavailable",
        criterionKind: claim.criterionKind,
      });
      const reason = `entailment ${detail}`;
      this.persist(claim, "pending_verification", null, "unavailable", reason, null, []);
      return result(claim, "pending_verification", null, "unavailable", reason, true, null, null);
    }
    const parsed = parseEntailmentCheckerV1(response.body);
    if (!parsed || isBlockedEntailment(parsed)) {
      const reason = parsed && isBlockedEntailment(parsed) ? parsed.reason : "entailment response was not a closed schema";
      this.deps.metrics.record({
        resolverModel: claim.resolverModel.modelId,
        entailmentModel: selected.modelId,
        verdict: "unavailable",
        criterionKind: claim.criterionKind,
      });
      this.persist(claim, "pending_verification", null, "unavailable", reason, null, []);
      return result(claim, "pending_verification", null, "unavailable", reason, true, null, null);
    }
    this.deps.metrics.record({
      resolverModel: claim.resolverModel.modelId,
      entailmentModel: selected.modelId,
      verdict: parsed.verdict,
      criterionKind: claim.criterionKind,
    });
    if (parsed.verdict === "establishes") {
      const basis: SettledBasis = claim.basis === "derived" ? "derived" : "explicit";
      const premiseEdges = basis === "derived" ? claim.premises.map((dst) => ({ type: "derived_from", dst })) : [];
      this.persist(claim, "settled", basis, parsed.verdict, parsed.reason, null, premiseEdges);
      return result(claim, "settled", basis, parsed.verdict, parsed.reason, true, null, null);
    }
    if (parsed.verdict === "contradicts") {
      this.persist(claim, "conflict", null, parsed.verdict, parsed.reason, null, []);
      return result(claim, "conflict", null, parsed.verdict, parsed.reason, true, null, null);
    }
    this.persist(claim, "pending_verification", null, "leaves_open", parsed.reason, null, []);
    return result(claim, "pending_verification", null, "leaves_open", parsed.reason, true, null, null);
  }

  private complete(request: EntailmentModelRequest): EntailmentModelResponse {
    try {
      return this.deps.adapter.complete(request);
    } catch {
      return { ok: false, failure: "unavailable", statusCode: null };
    }
  }

  private verifyQuotes(claim: EntailmentClaim): { ok: true } | { ok: false; reason: string } {
    if (claim.excerpts.length === 0) return { ok: false, reason: "no cited excerpt" };
    for (const excerpt of claim.excerpts) {
      const turn = this.deps.turns.get(excerpt.turnId);
      const verdict = this.deps.quotes.verify({ turn, excerpt });
      if (!verdict.ok) return { ok: false, reason: verdict.reason };
    }
    return { ok: true };
  }

  private persist(
    claim: EntailmentClaim,
    status: DecisionFields["status"],
    basis: SettledBasis | null,
    verdict: MetricVerdict | null,
    reason: string,
    changeSummary: string | null,
    edges: readonly { type: string; dst: string }[],
  ): void {
    const fields: DecisionFields = {
      criterion: claim.criterion,
      status,
      value: claim.proposedValue,
      basis,
      rule: basis === "derived" ? claim.rule : null,
      premises: basis === "derived" ? [...claim.premises] : [],
      evidence: claim.excerpts,
      retracted: false,
      feature: claim.feature,
      costly: claim.costly,
      reversibility: claim.reversibility,
      mustAsk: claim.mustAsk,
      criterionKind: claim.criterionKind,
      release: "current",
      changeSummary,
      entailmentVerdict: verdict,
      entailmentReason: reason,
    };
    const quote = claim.excerpts[0]?.quote ?? claim.criterion;
    writeDecision(this.deps.graph, {
      id: claim.decisionId,
      kind: "decision",
      title: claim.criterion,
      text: quote,
      fields,
      nodeStatus: "active",
      edges,
      retireEdges: currentPremiseIds(this.deps.graph, claim.decisionId).map((dst) => ({
        type: "derived_from",
        dst,
      })),
      summary: `${status} ${claim.criterion}`,
    });
  }
}

function toProposal(claim: EntailmentClaim): DerivationProposal {
  return {
    decisionId: claim.decisionId,
    criterion: claim.criterion,
    rule: claim.rule ?? "",
    premises: claim.premises,
    costly: claim.costly,
    reversibility: claim.reversibility,
    mustAsk: claim.mustAsk,
    evidence: claim.excerpts,
  };
}

function result(
  claim: EntailmentClaim,
  outcome: EntailmentClaimResult["outcome"],
  basis: SettledBasis | null,
  verdict: MetricVerdict | null,
  reason: string,
  modelInvoked: boolean,
  changeSummary: string | null,
  errorName: string | null,
): EntailmentClaimResult {
  return {
    decisionId: claim.decisionId,
    criterion: claim.criterion,
    outcome,
    basis,
    verdict,
    reason,
    credit: outcome === "settled",
    modelInvoked,
    changeSummary,
    errorName,
  };
}

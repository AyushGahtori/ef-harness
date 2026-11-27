import { checkCitation } from "./citations.js";
import { parseLocation, parseUnifiedDiff } from "./diff.js";
import { consultModel, estimateTokens, selectFamily } from "./model-select.js";
import { MemoryHintLadder, MemoryReviewEnvelope, MemoryReviewRejectionStore } from "./ports.js";
import type { StaticAuditGate, VerificationHintLadder } from "./ports.js";
import { buildReviewerPrompt } from "./prompts.js";
import { isBlockedExit, parseReviewerV1 } from "./schemas.js";
import type { ReviewerFindingV1 } from "./schemas.js";
import { decideReviewerRisk } from "./risk-gate.js";
import { MAX_REVIEWER_REJECTIONS } from "./types.js";
import type {
  AdvisoryNote,
  BlockingFinding,
  HighRiskReviewRequest,
  HighRiskReviewResult,
  ModelRosterEntry,
  ReviewerBlocked,
  SpecialistModel,
} from "./types.js";

const FAILURE =
  /\b(can|could|allows|lets|omits|omit|missing|without|bypass|inject|leak|race|delete|forge|spoof|overwrite|steal|unauthorized|another|atomic|swallowed|interpolat|hiding|cookie)\b/i;

export interface HighRiskDiffReviewerOptions {
  readonly model: SpecialistModel | null;
  readonly roster: readonly ModelRosterEntry[];
  readonly rejections?: MemoryReviewRejectionStore;
  readonly hintLadder?: VerificationHintLadder;
  readonly envelope?: MemoryReviewEnvelope;
  readonly staticAuditGate?: StaticAuditGate | null;
}

interface Classified {
  readonly blocking: BlockingFinding[];
  readonly advisory: AdvisoryNote[];
}

function ruleMentioned(explanation: string, ids: readonly string[]): string | null {
  const sorted = [...ids].sort((a, b) => b.length - a.length);
  return sorted.find((id) => explanation.includes(id)) ?? null;
}

function classify(finding: ReviewerFindingV1, request: HighRiskReviewRequest, files: ReturnType<typeof parseUnifiedDiff>["files"]): Classified {
  const blocking: BlockingFinding[] = [];
  const advisory: AdvisoryNote[] = [];
  const located = parseLocation(finding.location);
  if (!located) return { blocking, advisory };
  const lineRange = { start: located.start, end: located.end };
  const grounded = checkCitation(
    { filePath: located.filePath, lineRange },
    { files, nodeIds: new Set<string>(), receiptIds: new Set<string>() },
  );
  if (!grounded.ok) return { blocking, advisory };
  const ids = [...request.must.map((item) => item.id), ...request.rules.map((item) => item.id)];
  const ruleId = ruleMentioned(finding.explanation, ids);
  const remainder = ruleId ? finding.explanation.replace(ruleId, "").trim() : finding.explanation;
  const concrete = ruleId !== null && remainder.length >= 20 && FAILURE.test(remainder);
  if (!concrete || !ruleId) {
    advisory.push({
      filePath: located.filePath,
      lineRange,
      text: finding.explanation,
      blocksMerge: false,
    });
    return { blocking, advisory };
  }
  blocking.push({
    kind: finding.kind,
    filePath: located.filePath,
    lineRange,
    violatedRuleOrReqId: ruleId,
    concreteExploitOrFailureScenario: finding.explanation,
    location: finding.location,
    blocksMerge: true,
  });
  return { blocking, advisory };
}

function surgicalHint(finding: BlockingFinding): string {
  return `Fix ${finding.filePath} lines ${String(finding.lineRange.start)}-${String(finding.lineRange.end)} so ${finding.violatedRuleOrReqId} holds: ${finding.concreteExploitOrFailureScenario}`;
}

export class HighRiskDiffReviewer {
  private readonly model: SpecialistModel | null;
  private readonly roster: readonly ModelRosterEntry[];
  private readonly rejections: MemoryReviewRejectionStore;
  private readonly hintLadder: VerificationHintLadder;
  private readonly envelope: MemoryReviewEnvelope | null;
  private readonly staticAuditGate: StaticAuditGate | null;

  constructor(options: HighRiskDiffReviewerOptions) {
    this.model = options.model;
    this.roster = options.roster;
    this.rejections = options.rejections ?? new MemoryReviewRejectionStore();
    this.hintLadder = options.hintLadder ?? new MemoryHintLadder();
    this.envelope = options.envelope ?? null;
    this.staticAuditGate = options.staticAuditGate ?? null;
  }

  async review(request: HighRiskReviewRequest): Promise<HighRiskReviewResult> {
    const risk = decideReviewerRisk(request);
    if (!risk.run) {
      return {
        status: "skipped_low_risk",
        taskId: request.taskId,
        blocksMerge: false,
        tokensSpent: 0,
        modelInvoked: false,
      };
    }
    const staticAudit = request.staticAudit ?? this.staticAuditGate?.readReceipt(request.taskId) ?? null;
    const prepared: HighRiskReviewRequest = staticAudit === request.staticAudit ? request : { ...request, staticAudit };
    const family = selectFamily(this.roster, request.workerFamily, false);
    if (!family) {
      return {
        status: "model_unavailable",
        taskId: request.taskId,
        blocksMerge: false,
        tokensSpent: 0,
        modelInvoked: false,
        reason: "no model family is configured",
        family: null,
      };
    }
    const prompt = buildReviewerPrompt(prepared);
    const raw = await consultModel(this.model, {
      role: "reviewer@1",
      family: family.family,
      vision: false,
      prompt,
      imageBytes: 0,
    });
    const tokensSpent = raw === null && this.model === null ? 0 : estimateTokens(prompt);
    if (tokensSpent > 0) this.envelope?.charge(tokensSpent);
    if (raw === null) {
      return {
        status: "model_unavailable",
        taskId: request.taskId,
        blocksMerge: false,
        tokensSpent,
        modelInvoked: this.model !== null,
        reason: "reviewer returned no scripted output",
        family: family.family,
      };
    }
    const parsed = parseReviewerV1(raw);
    if (!parsed.ok) {
      return {
        status: "model_output_invalid",
        taskId: request.taskId,
        blocksMerge: false,
        tokensSpent,
        modelInvoked: true,
        reason: parsed.reason,
        family: family.family,
      };
    }
    if (isBlockedExit(parsed.value)) {
      return {
        status: "model_blocked",
        taskId: request.taskId,
        blocksMerge: false,
        tokensSpent,
        modelInvoked: true,
        reason: parsed.value.reason,
        family: family.family,
      };
    }
    const parsedDiff = parseUnifiedDiff(prepared.diff);
    const blocking: BlockingFinding[] = [];
    const advisory: AdvisoryNote[] = [];
    for (const finding of parsed.value.findings) {
      const classified = classify(finding, prepared, parsedDiff.files);
      blocking.push(...classified.blocking);
      advisory.push(...classified.advisory);
    }
    if (blocking.length === 0) {
      return {
        status: "clean",
        taskId: request.taskId,
        blocksMerge: false,
        tokensSpent,
        modelInvoked: true,
        findings: [],
        advisory,
        family: family.family,
        familyDegraded: family.degraded,
      };
    }
    const prior = this.rejections.count(request.taskId);
    if (prior >= MAX_REVIEWER_REJECTIONS) {
      return {
        status: "escalated_to_user",
        taskId: request.taskId,
        blocksMerge: false,
        tokensSpent,
        modelInvoked: true,
        attempt: 3,
        priorRejections: MAX_REVIEWER_REJECTIONS,
        diff: prepared.diff,
        concern: blocking.map((finding) => finding.concreteExploitOrFailureScenario).join(" "),
        findings: blocking,
        family: family.family,
        familyDegraded: family.degraded,
      };
    }
    const rejectionNumber = this.rejections.record(request.taskId);
    const primary = blocking[0];
    if (!primary || (rejectionNumber !== 1 && rejectionNumber !== 2)) {
      return {
        status: "escalated_to_user",
        taskId: request.taskId,
        blocksMerge: false,
        tokensSpent,
        modelInvoked: true,
        attempt: 3,
        priorRejections: MAX_REVIEWER_REJECTIONS,
        diff: prepared.diff,
        concern: blocking.map((finding) => finding.concreteExploitOrFailureScenario).join(" "),
        findings: blocking,
        family: family.family,
        familyDegraded: family.degraded,
      };
    }
    const hint = surgicalHint(primary);
    this.hintLadder.pushReviewerDefect({
      taskId: request.taskId,
      attemptId: request.attemptId,
      filePath: primary.filePath,
      lineStart: primary.lineRange.start,
      lineEnd: primary.lineRange.end,
      violatedRuleOrReqId: primary.violatedRuleOrReqId,
      scenario: primary.concreteExploitOrFailureScenario,
      hint,
      countsTowardReviewEnvelope: true,
    });
    const blocked: ReviewerBlocked = {
      status: "blocked_merge",
      taskId: request.taskId,
      blocksMerge: true,
      tokensSpent,
      modelInvoked: true,
      rejectionNumber,
      findings: blocking,
      advisory,
      hint,
      family: family.family,
      familyDegraded: family.degraded,
      envelopeCharged: true,
    };
    return blocked;
  }
}

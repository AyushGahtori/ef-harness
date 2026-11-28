import { CcrV1Schema } from "@ef-harness/shared-contracts";
import { buildCcrV1 } from "./ccr-v1.js";
import { DeterministicSchemaDiffClassifier } from "./classifier.js";
import { AdditiveOwnerFastPath } from "./fast-path.js";
import { CcrLedger, stamp, type CcrDraft } from "./ledger.js";
import { LocalContradictionCounter, LocalCcrV1Schema } from "./ports.js";
import type {
  LocalDurableRoleMailbox,
  LocalHybridRevision,
  LocalMigrationNamer,
  LocalProjectMergeQueue,
  LocalRegressionChecks,
  LocalReverseImpactWalker,
  LocalRevisionAutoStartPolicy,
  LocalSkeletonLock,
  LocalSurgicalHolds,
  LocalWaitGraphCycleDetector,
} from "./ports.js";
import { BreakingCcrRevisionReopener } from "./reopener.js";
import { fingerprintFor, semanticSummary } from "./semantic.js";
import { CcrSemanticCompatibilityReviewer } from "./semantic.js";
import {
  WiredDurableRoleMailbox,
  WiredHybridRevision,
  WiredMigrationNamer,
  WiredProjectMergeQueue,
  WiredRegressionChecks,
  WiredReverseImpactWalker,
  WiredRevisionAutoStartPolicy,
  WiredSkeletonLock,
  WiredSurgicalHolds,
  WiredWaitGraphCycleDetector,
} from "./wired-ports.js";
import type {
  CcrIntakeResult,
  CcrV1,
  ContractChangeProposal,
  ContractOwner,
  ContractOwnerDirectory,
  DiffOp,
  FeatureRuntimeDirectory,
  LandMode,
  SchemaDiffResult,
  SemanticReview,
  StoredCcr,
} from "./types.js";
import {
  APPROVE_BREAKING,
  CCR_SPAM_CAP,
  COORDINATOR_ROLE,
  KEEP_ORIGINAL,
  PLANNER_ROLE,
} from "./types.js";

interface Prepared {
  readonly proposal: ContractChangeProposal;
  readonly structural: SchemaDiffResult;
  readonly semantic: SemanticReview;
  readonly classification: "ADDITIVE" | "BREAKING";
  readonly overridden: boolean;
  readonly fingerprint: string;
  readonly owner: ContractOwner | null;
}

export class ContractChangeRequestEngine {
  readonly ledger: CcrLedger;
  readonly mailbox: LocalDurableRoleMailbox;
  readonly mergeQueue: LocalProjectMergeQueue;
  readonly holds: LocalSurgicalHolds;
  readonly waitGraph: LocalWaitGraphCycleDetector;
  readonly schema: LocalCcrV1Schema;
  private readonly owners: ContractOwnerDirectory;
  private readonly features: FeatureRuntimeDirectory;
  private readonly classifier: DeterministicSchemaDiffClassifier;
  private readonly semanticReviewer = new CcrSemanticCompatibilityReviewer();
  private readonly fastPath: AdditiveOwnerFastPath;
  private readonly reopener: BreakingCcrRevisionReopener;
  private readonly contradictions: LocalContradictionCounter;
  private readonly locks: LocalSkeletonLock;
  private readonly now: () => Date;
  private readonly landMode: LandMode;

  constructor(options: {
    readonly owners: ContractOwnerDirectory;
    readonly features: FeatureRuntimeDirectory;
    readonly ledger?: CcrLedger;
    readonly landMode?: LandMode;
    readonly now?: () => Date;
    readonly locks?: LocalSkeletonLock;
    readonly contradictions?: LocalContradictionCounter;
    readonly impact?: LocalReverseImpactWalker;
    readonly mailbox?: LocalDurableRoleMailbox;
    readonly autoStart?: LocalRevisionAutoStartPolicy;
    readonly migrations?: LocalMigrationNamer;
    readonly mergeQueue?: LocalProjectMergeQueue;
    readonly holds?: LocalSurgicalHolds;
    readonly regression?: LocalRegressionChecks;
    readonly revision?: LocalHybridRevision;
    readonly classifier?: DeterministicSchemaDiffClassifier;
    readonly schema?: LocalCcrV1Schema;
  }) {
    this.owners = options.owners;
    this.features = options.features;
    this.ledger = options.ledger ?? CcrLedger.open();
    this.landMode = options.landMode ?? "immediate";
    this.now = options.now ?? (() => new Date());
    this.locks = options.locks ?? new WiredSkeletonLock();
    this.contradictions = options.contradictions ?? new LocalContradictionCounter();
    this.mailbox = options.mailbox ?? new WiredDurableRoleMailbox();
    this.mergeQueue = options.mergeQueue ?? new WiredProjectMergeQueue();
    this.holds = options.holds ?? new WiredSurgicalHolds();
    const impact = options.impact ?? new WiredReverseImpactWalker();
    const autoStart = options.autoStart ?? new WiredRevisionAutoStartPolicy();
    const revision = options.revision ?? new WiredHybridRevision();
    this.schema = options.schema ?? new LocalCcrV1Schema();
    this.classifier = options.classifier ?? new DeterministicSchemaDiffClassifier();
    this.waitGraph = new WiredWaitGraphCycleDetector(this.ledger);
    this.fastPath = new AdditiveOwnerFastPath(
      this.locks,
      options.migrations ?? new WiredMigrationNamer(),
      this.mergeQueue,
      options.regression ?? new WiredRegressionChecks(),
      () => this.ledger.nextId("T-OWN-"),
    );
    this.reopener = new BreakingCcrRevisionReopener(impact, autoStart, this.holds, revision);
  }

  async submit(proposal: ContractChangeProposal): Promise<CcrIntakeResult> {
    const [result] = await this.submitMany([proposal]);
    if (!result) throw new Error("CCR intake produced no result");
    return result;
  }

  async submitMany(proposals: readonly ContractChangeProposal[]): Promise<CcrIntakeResult[]> {
    const preparedItems: Prepared[] = [];
    for (const proposal of proposals) preparedItems.push(await this.prepare(proposal));
    return this.ledger.transaction(() => {
      const results: Array<CcrIntakeResult | undefined> = new Array(proposals.length);
      const groups: { index: number; prepared: Prepared }[][] = [];
      const indexByFingerprint = new Map<string, number>();
      preparedItems.forEach((prepared, index) => {
        const existing = indexByFingerprint.get(prepared.fingerprint);
        if (existing === undefined) {
          indexByFingerprint.set(prepared.fingerprint, groups.length);
          groups.push([{ index, prepared }]);
        } else {
          const group = groups[existing];
          if (group) group.push({ index, prepared });
        }
      });
      const batchNew = new Map<string, number>();
      for (const group of groups) {
        const lead = group[0];
        if (!lead) continue;
        const taskId = lead.prepared.proposal.requestingTaskId;
        const alreadyStored = this.ledger.findActiveByFingerprint(lead.prepared.fingerprint) !== null;
        const used = this.ledger.countOriginated(taskId) + (batchNew.get(taskId) ?? 0);
        if (!alreadyStored && used >= CCR_SPAM_CAP) {
          for (const item of group) results[item.index] = this.spam(item.prepared.proposal);
          continue;
        }
        if (!alreadyStored) batchNew.set(taskId, (batchNew.get(taskId) ?? 0) + 1);
        const outcome = this.ingestGroup(group.map((item) => item.prepared));
        group.forEach((item, offset) => {
          results[item.index] = offset === 0 ? outcome : { ...outcome, deduped: true };
        });
      }
      return results.map((result, index) => {
        if (!result) throw new Error(`CCR intake missing a result at ${index}`);
        return result;
      });
    });
  }

  approve(ccrId: string, choice: typeof APPROVE_BREAKING): CcrIntakeResult {
    if (choice !== APPROVE_BREAKING) throw new Error("Breaking approval requires the approve choice.");
    return this.ledger.transaction(() => {
      const stored = this.requireOpenBreaking(ccrId);
      const card = stored.decision ?? this.cardFor(stored);
      const execution = this.reopener.approve(ccrId, this.reopener.blast(stored.targetContractNodeId).affectedActiveTasks);
      const at = stamp(this.now);
      const ccrV1 = this.document(stored, "approved", stored.classification, stored.schemaDiff, stored.semanticBreaking);
      const updated = this.ledger.transition(
        ccrId,
        "APPROVED",
        { queueState: "revision_task_087", ccrV1, decision: card, ownerRole: COORDINATOR_ROLE },
        {
          revisionTask: execution.revisionTask,
          autoStart: execution.autoStart,
          trigger: execution.trigger,
          holds: execution.holds,
          autoExecutionBlocked: true,
        },
        at,
      );
      return this.toResult(updated, { deduped: false, fastPath: false, autoExecutionBlocked: true, cycleBroken: false });
    });
  }

  reject(ccrId: string, choice: typeof KEEP_ORIGINAL): CcrIntakeResult {
    if (choice !== KEEP_ORIGINAL) throw new Error("Rejection requires the keep-original choice.");
    return this.ledger.transaction(() => {
      const stored = this.requireOpenBreaking(ccrId);
      const instruction = this.reopener.reject().instruction;
      const woken = this.mailbox.wake(stored.subscriberTaskIds, { ccrId, lifecycle: "REJECTED", instruction });
      const at = stamp(this.now);
      const ccrV1 = this.document(stored, "rejected", stored.classification, stored.schemaDiff, stored.semanticBreaking);
      const updated = this.ledger.transition(
        ccrId,
        "REJECTED",
        { queueState: "rejected", wokenTaskIds: woken, ccrV1, decision: stored.decision },
        { instruction, wokenTaskIds: woken },
        at,
      );
      this.ledger.removeEdgesForCcr(ccrId);
      return this.toResult(updated, { deduped: false, fastPath: false, autoExecutionBlocked: true, cycleBroken: false });
    });
  }

  landQueued(): readonly CcrIntakeResult[] {
    return this.ledger.transaction(() => {
      const waiting = this.ledger.waiting().filter((row) => row.classification === "ADDITIVE" && !row.semanticBreaking);
      return waiting.map((row) => this.landStored(row));
    });
  }

  private async prepare(proposal: ContractChangeProposal): Promise<Prepared> {
    const structural = this.classifier.classify({
      before: proposal.proposedDelta.before,
      after: proposal.proposedDelta.after,
      ...(proposal.claimedClass !== undefined ? { claimedClass: proposal.claimedClass } : {}),
      ...(proposal.claimedAdditive !== undefined ? { claimedAdditive: proposal.claimedAdditive } : {}),
    });
    const structuralUnchanged = structural.classification === "UNCHANGED";
    const semantic = await this.semanticReviewer.review({
      before: proposal.proposedDelta.before,
      after: proposal.proposedDelta.after,
      ...(proposal.proposedDelta.behaviorBefore !== undefined ? { behaviorBefore: proposal.proposedDelta.behaviorBefore } : {}),
      ...(proposal.proposedDelta.behaviorAfter !== undefined ? { behaviorAfter: proposal.proposedDelta.behaviorAfter } : {}),
      structuralUnchanged,
    });
    const classification: "ADDITIVE" | "BREAKING" =
      structural.classification === "BREAKING" || semantic.breaking ? "BREAKING" : "ADDITIVE";
    const claimedAdditive = proposal.claimedAdditive === true || proposal.claimedClass === "additive";
    const overridden = structural.overridden || (claimedAdditive && classification === "BREAKING");
    const fingerprint = fingerprintFor(proposal.targetContractNodeId, structural.ops, semantic);
    const preview = this.buildDocument({
      id: "CCR-PREVIEW",
      fromFeature: proposal.requestingFeatureId,
      target: proposal.targetContractNodeId,
      reason: proposal.rationale,
      classification,
      status: "open",
      ops: structural.ops,
      semanticSummary: semanticSummary(semantic),
    });
    this.schema.parse(preview);
    CcrV1Schema.safeParse(preview);
    return {
      proposal,
      structural,
      semantic,
      classification,
      overridden,
      fingerprint,
      owner: this.owners.get(proposal.targetContractNodeId),
    };
  }

  private ingestGroup(group: readonly Prepared[]): CcrIntakeResult {
    const first = group[0];
    if (!first) throw new Error("empty CCR group");
    const at = stamp(this.now);
    const existing = this.ledger.findActiveByFingerprint(first.fingerprint);
    if (existing) return this.joinExisting(existing, group, at);
    const id = this.ledger.nextId("CCR-");
    const ownerRole = first.owner?.ownerRole ?? COORDINATOR_ROLE;
    const subscribers = unique(group.map((item) => item.proposal.requestingTaskId));
    const document = this.buildDocument({
      id,
      fromFeature: first.proposal.requestingFeatureId,
      target: first.proposal.targetContractNodeId,
      reason: first.proposal.rationale,
      classification: first.classification,
      status: "open",
      ops: first.structural.ops,
      semanticSummary: semanticSummary(first.semantic),
    });
    const draft: CcrDraft = {
      id,
      targetContractNodeId: first.proposal.targetContractNodeId,
      fingerprint: first.fingerprint,
      requestingTaskId: first.proposal.requestingTaskId,
      requestingFeatureId: first.proposal.requestingFeatureId,
      claimedClass: claimedLabel(first.proposal),
      rationale: first.proposal.rationale,
      urgency: first.proposal.urgency,
      ownerRole,
      ccrV1: document,
      schemaDiff: first.structural.ops,
      semanticBreaking: first.semantic.breaking,
      classification: first.classification,
      overridden: first.overridden,
    };
    this.ledger.insertProposed(draft, at);
    this.mailbox.submit({
      targetRole: ownerRole,
      targetOwnerTaskId: first.owner?.ownerTaskId ?? COORDINATOR_ROLE,
      contractId: first.proposal.targetContractNodeId,
      requestingTaskId: first.proposal.requestingTaskId,
      kind: first.classification === "ADDITIVE" ? "SharedTypeAdditionRequest" : "ContractClarificationRequest",
    });
    let stored = this.ledger.transition(
      id,
      "CLASSIFIED",
      {
        queueState: "classified",
        subscriberTaskIds: subscribers,
        classification: first.classification,
        overridden: first.overridden,
        semanticBreaking: first.semantic.breaking,
        ccrV1: document,
      },
      {
        classification: first.classification,
        overridden: first.overridden,
        ops: first.structural.ops.map((op) => op.signature),
        semantic: first.semantic.reasons,
        formats: first.structural.formats,
      },
      at,
    );
    for (const extra of group.slice(1)) {
      stored = this.ledger.addSubscriber(id, extra.proposal.requestingTaskId, at);
    }
    if (first.classification === "BREAKING" || first.semantic.breaking) return this.openBreaking(stored, first);
    if (first.structural.classification === "UNCHANGED" && !first.semantic.breaking) {
      stored = this.ledger.transition(id, "CLASSIFIED", { queueState: "no_change" }, { queueState: "no_change" }, at);
      return this.toResult(stored, { deduped: false, fastPath: false, autoExecutionBlocked: false, cycleBroken: false });
    }
    if (!first.owner) return this.missingOwner(stored, at);
    const partner = this.cyclePartner(stored, first.owner);
    if (partner) return this.breakCycle(stored, first, partner, at);
    if (this.features.stateOf(first.owner.ownerFeatureId) === "HOLD") return this.ownerHold(stored, first.owner, at);
    if (this.contradictions.count(first.proposal.targetContractNodeId) > 0) return this.contradiction(stored, at);
    const decision = this.waitGraph.commitWait(first.proposal.requestingTaskId, first.owner.ownerTaskId, id);
    if (!decision.accepted) return this.breakCycle(stored, first, null, at);
    if (this.landMode === "queued") {
      stored = this.ledger.transition(
        id,
        "CLASSIFIED",
        { queueState: "waiting_on_ccr", ownerTaskId: first.owner.ownerTaskId, ownerRole: first.owner.ownerRole },
        { waitingOnCcr: true, ownerTaskId: first.owner.ownerTaskId },
        at,
      );
      return this.toResult(stored, { deduped: false, fastPath: false, autoExecutionBlocked: false, cycleBroken: false, waitingOnCcr: true });
    }
    return this.landStored(stored);
  }

  private joinExisting(existing: StoredCcr, group: readonly Prepared[], at: string): CcrIntakeResult {
    let stored = existing;
    for (const item of group) {
      stored = this.ledger.addSubscriber(existing.id, item.proposal.requestingTaskId, at);
    }
    if (stored.lifecycle === "LANDED") {
      const woken = this.mailbox.wake(stored.subscriberTaskIds, { ccrId: stored.id, lifecycle: "LANDED" });
      stored = this.ledger.recordWake(stored.id, woken, at);
    }
    return this.toResult(stored, { deduped: true, fastPath: stored.lifecycle === "LANDED", autoExecutionBlocked: stored.classification === "BREAKING", cycleBroken: false });
  }

  private landStored(stored: StoredCcr): CcrIntakeResult {
    const owner = this.owners.get(stored.targetContractNodeId);
    if (!owner) return this.missingOwner(stored, stamp(this.now));
    const at = stamp(this.now);
    const outcome = this.fastPath.execute({
      ccrIds: [stored.id],
      contractNodeId: stored.targetContractNodeId,
      owner,
      requesterTaskIds: stored.subscriberTaskIds,
      primaryRequester: stored.requestingTaskId,
      ops: stored.schemaDiff,
      ownerFeatureState: this.features.stateOf(owner.ownerFeatureId),
      runningFeatures: this.features.runningFeatures(),
      requestingFeatureId: stored.requestingFeatureId,
      contradictionCount: this.contradictions.count(stored.targetContractNodeId),
      semanticBreaking: stored.semanticBreaking,
      at: this.now(),
    });
    if (!outcome.ok) return this.fastPathRefusal(stored, outcome.reason, outcome.detail, at);
    const woken = this.mailbox.wake(outcome.wokenTaskIds, { ccrId: stored.id, lifecycle: "LANDED" });
    const approvedDoc = this.document(stored, "approved", "ADDITIVE", stored.schemaDiff, false);
    this.ledger.transition(
      stored.id,
      "APPROVED",
      {
        queueState: "approved",
        ownerTaskId: outcome.ownerTask.ownerTaskId,
        ownerRole: outcome.ownerTask.ownerRole,
        ownerTask: outcome.ownerTask,
        migrationName: outcome.migrationName,
        ccrV1: approvedDoc,
      },
      { ownerTaskId: outcome.ownerTask.taskId, migrationName: outcome.migrationName },
      at,
    );
    const landedDoc = this.document(stored, "applied", "ADDITIVE", stored.schemaDiff, false);
    const landed = this.ledger.transition(
      stored.id,
      "LANDED",
      {
        queueState: "landed",
        ownerCommitSha: outcome.commitSha,
        wokenTaskIds: woken,
        migrationName: outcome.migrationName,
        ownerTask: outcome.ownerTask,
        ccrV1: landedDoc,
      },
      { ownerCommitSha: outcome.commitSha, wokenTaskIds: woken, schemaDiff: stored.schemaDiff.map((op) => op.signature) },
      at,
    );
    this.ledger.removeEdgesForCcr(stored.id);
    return this.toResult(landed, {
      deduped: false,
      fastPath: true,
      autoExecutionBlocked: false,
      cycleBroken: false,
      unrelatedRunning: outcome.unrelatedRunning,
    });
  }

  private openBreaking(stored: StoredCcr, prepared: Prepared): CcrIntakeResult {
    const at = stamp(this.now);
    const requested = prepared.semantic.breaking
      ? prepared.semantic.reasons.join("; ")
      : prepared.structural.ops.filter((op) => op.breaking).map((op) => op.detail).join("; ");
    const card = this.reopener.open({
      ccrId: stored.id,
      requestedChange: requested.length > 0 ? requested : prepared.proposal.rationale,
      whyWorkerHitIt: prepared.proposal.rationale,
      contractNodeId: prepared.proposal.targetContractNodeId,
      semantic: prepared.semantic.breaking && prepared.structural.classification !== "BREAKING",
      semanticConsumers: prepared.semantic.consumers,
      semanticAlternatives: prepared.semantic.alternatives,
    });
    const policy = new WiredRevisionAutoStartPolicy().evaluate(true);
    const updated = this.ledger.transition(
      stored.id,
      "CLASSIFIED",
      { queueState: "awaiting_decision", decision: card, ownerRole: prepared.owner?.ownerRole ?? COORDINATOR_ROLE },
      { autoExecutionBlocked: true, autoStart: policy.autoStart, trigger: policy.trigger, decision: card.requestedChange },
      at,
    );
    return this.toResult(updated, { deduped: false, fastPath: false, autoExecutionBlocked: true, cycleBroken: false });
  }

  private ownerHold(stored: StoredCcr, owner: ContractOwner, at: string): CcrIntakeResult {
    this.ledger.notice(COORDINATOR_ROLE, "blocked_by_owner_hold", { ccrId: stored.id, ownerFeatureId: owner.ownerFeatureId }, at);
    const updated = this.ledger.transition(
      stored.id,
      "CLASSIFIED",
      { queueState: "blocked_by_owner_hold", ownerTaskId: owner.ownerTaskId, ownerRole: owner.ownerRole },
      { queueState: "blocked_by_owner_hold" },
      at,
    );
    return this.toResult(updated, { deduped: false, fastPath: false, autoExecutionBlocked: false, cycleBroken: false });
  }

  private contradiction(stored: StoredCcr, at: string): CcrIntakeResult {
    this.ledger.notice(COORDINATOR_ROLE, "blocked_by_contradiction", { ccrId: stored.id }, at);
    const updated = this.ledger.transition(
      stored.id,
      "CLASSIFIED",
      { queueState: "blocked_by_contradiction" },
      { queueState: "blocked_by_contradiction" },
      at,
    );
    return this.toResult(updated, { deduped: false, fastPath: false, autoExecutionBlocked: false, cycleBroken: false });
  }

  private missingOwner(stored: StoredCcr, at: string): CcrIntakeResult {
    this.ledger.notice(COORDINATOR_ROLE, "blocked_missing_owner", { ccrId: stored.id }, at);
    const updated = this.ledger.transition(
      stored.id,
      "CLASSIFIED",
      { queueState: "blocked_missing_owner", ownerRole: COORDINATOR_ROLE },
      { queueState: "blocked_missing_owner" },
      at,
    );
    return this.toResult(updated, { deduped: false, fastPath: false, autoExecutionBlocked: false, cycleBroken: false });
  }

  private cyclePartner(stored: StoredCcr, owner: ContractOwner): StoredCcr | null {
    const edges = this.ledger.listEdges();
    const cycle = this.waitGraph.cycleIfAdded(stored.requestingTaskId, owner.ownerTaskId);
    if (!cycle) return null;
    const prior = edges.find((edge) => cycle.includes(edge.fromTaskId) && edge.ccrId && edge.ccrId !== stored.id);
    if (!prior?.ccrId) return null;
    return this.ledger.get(prior.ccrId);
  }

  private breakCycle(stored: StoredCcr, prepared: Prepared, partner: StoredCcr | null, at: string): CcrIntakeResult {
    this.ledger.notice(
      COORDINATOR_ROLE,
      "wait_graph_deadlock",
      { ccrId: stored.id, partnerId: partner?.id ?? null, escalatedTo: COORDINATOR_ROLE },
      at,
    );
    const bothAdditive = prepared.classification === "ADDITIVE" && (partner === null || (partner.classification === "ADDITIVE" && !partner.semanticBreaking));
    if (!bothAdditive || !prepared.owner) {
      const updated = this.ledger.transition(
        stored.id,
        "CLASSIFIED",
        { queueState: "cycle_escalated", ownerRole: COORDINATOR_ROLE },
        { cycleBroken: true, escalatedTo: COORDINATOR_ROLE },
        at,
      );
      return this.toResult(updated, { deduped: false, fastPath: false, autoExecutionBlocked: prepared.classification === "BREAKING", cycleBroken: true });
    }
    const extras = partner
      ? [{ contractNodeId: partner.targetContractNodeId, ops: partner.schemaDiff }]
      : [];
    const outcome = this.fastPath.execute({
      ccrIds: partner ? [partner.id, stored.id] : [stored.id],
      contractNodeId: stored.targetContractNodeId,
      owner: prepared.owner,
      requesterTaskIds: unique([...(partner?.subscriberTaskIds ?? []), ...stored.subscriberTaskIds]),
      primaryRequester: stored.requestingTaskId,
      ops: stored.schemaDiff,
      ownerFeatureState: "RUNNING",
      runningFeatures: this.features.runningFeatures(),
      requestingFeatureId: stored.requestingFeatureId,
      contradictionCount: 0,
      semanticBreaking: false,
      at: this.now(),
      mutatedBy: COORDINATOR_ROLE,
      extraContracts: extras,
    });
    if (!outcome.ok) {
      const updated = this.ledger.transition(
        stored.id,
        "CLASSIFIED",
        { queueState: "cycle_escalated", ownerRole: COORDINATOR_ROLE },
        { cycleBroken: true, detail: outcome.detail },
        at,
      );
      return this.toResult(updated, { deduped: false, fastPath: false, autoExecutionBlocked: false, cycleBroken: true });
    }
    const ids = partner ? [partner.id, stored.id] : [stored.id];
    const wokenIds = outcome.wokenTaskIds;
    for (const ccrId of ids) {
      const row = this.ledger.get(ccrId);
      if (!row) continue;
      const approved = this.document(row, "approved", "ADDITIVE", row.schemaDiff, false);
      this.ledger.transition(
        ccrId,
        "APPROVED",
        { queueState: "approved", ownerTask: outcome.ownerTask, migrationName: outcome.migrationName, ccrV1: approved, ownerRole: COORDINATOR_ROLE },
        { combined: true, ownerTaskId: outcome.ownerTask.taskId },
        at,
      );
      const applied = this.document(row, "applied", "ADDITIVE", row.schemaDiff, false);
      this.ledger.transition(
        ccrId,
        "LANDED",
        {
          queueState: "coordinator_combined",
          ownerCommitSha: outcome.commitSha,
          wokenTaskIds: wokenIds,
          ownerTask: outcome.ownerTask,
          migrationName: outcome.migrationName,
          ccrV1: applied,
          ownerRole: COORDINATOR_ROLE,
        },
        { ownerCommitSha: outcome.commitSha, wokenTaskIds: wokenIds, combined: true },
        at,
      );
      this.ledger.removeEdgesForCcr(ccrId);
    }
    this.mailbox.wake(wokenIds, { ccrId: stored.id, lifecycle: "LANDED", escalatedTo: COORDINATOR_ROLE });
    const landed = this.ledger.get(stored.id);
    if (!landed) throw new Error(`CCR ${stored.id} missing after cycle break`);
    return this.toResult(landed, { deduped: false, fastPath: false, autoExecutionBlocked: false, cycleBroken: true });
  }

  private fastPathRefusal(stored: StoredCcr, reason: string, detail: string, at: string): CcrIntakeResult {
    const queueState = reason === "owner_hold" ? "blocked_by_owner_hold" : reason === "contradiction" ? "blocked_by_contradiction" : reason === "regression" ? "regression_failed" : "classified";
    if (reason === "owner_hold") this.ledger.notice(COORDINATOR_ROLE, "blocked_by_owner_hold", { ccrId: stored.id }, at);
    const updated = this.ledger.transition(stored.id, "CLASSIFIED", { queueState }, { queueState, detail }, at);
    return this.toResult(updated, { deduped: false, fastPath: false, autoExecutionBlocked: false, cycleBroken: false });
  }

  private cardFor(stored: StoredCcr): NonNullable<StoredCcr["decision"]> {
    return this.reopener.open({
      ccrId: stored.id,
      requestedChange: stored.schemaDiff.map((op) => op.detail).join("; "),
      whyWorkerHitIt: stored.rationale,
      contractNodeId: stored.targetContractNodeId,
      semantic: stored.semanticBreaking,
      semanticConsumers: [],
      semanticAlternatives: [],
    });
  }

  private requireOpenBreaking(ccrId: string): StoredCcr {
    const stored = this.ledger.get(ccrId);
    if (!stored) throw new Error(`CCR ${ccrId} does not exist`);
    if (stored.classification !== "BREAKING" && !stored.semanticBreaking) throw new Error(`CCR ${ccrId} is not breaking`);
    if (stored.lifecycle !== "CLASSIFIED") throw new Error(`CCR ${ccrId} is ${stored.lifecycle}`);
    return stored;
  }

  private spam(proposal: ContractChangeProposal): CcrIntakeResult {
    const at = stamp(this.now);
    const escalation = `${proposal.requestingTaskId} exceeded ${CCR_SPAM_CAP} CCRs. Halt and escalate to ${COORDINATOR_ROLE} and ${PLANNER_ROLE}: the task brief or architecture decomposition needs review.`;
    this.ledger.notice(COORDINATOR_ROLE, "ccr_spam_cap", { taskId: proposal.requestingTaskId, cap: CCR_SPAM_CAP }, at);
    this.ledger.notice(PLANNER_ROLE, "ccr_spam_cap", { taskId: proposal.requestingTaskId, cap: CCR_SPAM_CAP }, at);
    return {
      ccrId: null,
      deduped: false,
      classification: null,
      overridden: false,
      lifecycle: null,
      queueState: "spam_halted",
      fastPath: false,
      autoExecutionBlocked: true,
      ownerTaskId: null,
      ownerRole: null,
      consumerEditedContract: false,
      wokenTaskIds: [],
      migrationName: null,
      ownerCommitSha: null,
      waitingOnCcr: false,
      cycleBroken: false,
      spamHalted: true,
      escalation,
      decision: null,
      unrelatedRunning: this.features.runningFeatures(),
      subscriberTaskIds: [],
      ownerTask: null,
      semanticBreaking: false,
      haltedTaskId: proposal.requestingTaskId,
    };
  }

  private document(
    stored: Pick<StoredCcr, "id" | "requestingFeatureId" | "targetContractNodeId" | "rationale">,
    status: CcrV1["status"],
    classification: "ADDITIVE" | "BREAKING",
    ops: readonly DiffOp[],
    semanticBreaking: boolean,
  ): CcrV1 {
    return this.buildDocument({
      id: stored.id,
      fromFeature: stored.requestingFeatureId,
      target: stored.targetContractNodeId,
      reason: stored.rationale,
      classification,
      status,
      ops,
      semanticSummary: semanticBreaking ? stored.rationale : null,
    });
  }

  private buildDocument(input: {
    readonly id: string;
    readonly fromFeature: string;
    readonly target: string;
    readonly reason: string;
    readonly classification: "ADDITIVE" | "BREAKING";
    readonly status: CcrV1["status"];
    readonly ops: readonly DiffOp[];
    readonly semanticSummary: string | null;
  }): CcrV1 {
    return this.schema.parse(buildCcrV1(input));
  }

  private toResult(
    stored: StoredCcr,
    flags: {
      readonly deduped: boolean;
      readonly fastPath: boolean;
      readonly autoExecutionBlocked: boolean;
      readonly cycleBroken: boolean;
      readonly waitingOnCcr?: boolean;
      readonly unrelatedRunning?: readonly string[];
    },
  ): CcrIntakeResult {
    return {
      ccrId: stored.id,
      deduped: flags.deduped,
      classification: stored.classification,
      overridden: stored.overridden,
      lifecycle: stored.lifecycle,
      queueState: stored.queueState,
      fastPath: flags.fastPath,
      autoExecutionBlocked: flags.autoExecutionBlocked,
      ownerTaskId: stored.ownerTask?.ownerTaskId ?? stored.ownerTaskId,
      ownerRole: stored.ownerRole,
      consumerEditedContract: false,
      wokenTaskIds: stored.wokenTaskIds,
      migrationName: stored.migrationName,
      ownerCommitSha: stored.ownerCommitSha,
      waitingOnCcr: flags.waitingOnCcr ?? stored.queueState === "waiting_on_ccr",
      cycleBroken: flags.cycleBroken,
      spamHalted: false,
      escalation: flags.cycleBroken ? COORDINATOR_ROLE : stored.queueState === "blocked_by_owner_hold" ? COORDINATOR_ROLE : null,
      decision: stored.decision,
      unrelatedRunning: flags.unrelatedRunning ?? this.features.runningFeatures(),
      subscriberTaskIds: stored.subscriberTaskIds,
      ownerTask: stored.ownerTask,
      semanticBreaking: stored.semanticBreaking,
      haltedTaskId: null,
    };
  }
}

function claimedLabel(proposal: ContractChangeProposal): string | null {
  if (proposal.claimedClass) return proposal.claimedClass;
  if (proposal.claimedAdditive === true) return "additive";
  if (proposal.claimedAdditive === false) return "breaking";
  return null;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

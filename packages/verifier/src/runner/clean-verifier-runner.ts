import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CleanCheckoutSeparationError, MissingRequiredChecksError, VerifierIntegrityError } from "./errors.js";
import { missingInScopeRules } from "./cross-cutting.js";
import { canonicalJson } from "./hash.js";
import {
  applyJudgement,
  applyReplay,
  emptyEvidence,
  environmentKindFromMessage,
  evidenceFromCase,
  headlineAttribution,
  inferFailureType,
  needsReplay,
  requirementResolution,
  type CollectedEvidence,
  type RunDraft,
} from "./judge.js";
import {
  defaultExpectationUnsealer,
  materializeExpectations,
  redactSecrets,
  secretLeaves,
  type MaterializedCheck,
  type MaterializedExpectations,
} from "./materialize.js";
import type {
  CheckResultsPort,
  CleanVerifierDeps,
  ExpectationUnsealer,
  HarnessRunEnginePort,
  PinnedRunResult,
  ProvisionedEnv,
  SandboxCheckInput,
  SurfaceVerifierAdapter,
} from "./ports.js";
import { parseCollectedCaseIds as parseReporter, type CollectedCaseReport } from "./reporters.js";
import { shredTree } from "./shred.js";
import {
  CLEAN_VERIFIER_REPLAY_CLOCK,
  type AttributionRoute,
  type CasRetention,
  type CheckDbStatus,
  type CheckOutcome,
  type CheckResultInsert,
  type CheckRunRecord,
  type CheckStability,
  type DispatchFingerprint,
  type FailureAttribution,
  type HintLadderPayload,
  type ReplayClock,
  type RequiredCheckRef,
  type SandboxTier,
  type VerificationOutcome,
  type VerifyCandidateRequest,
  type VerifierWorktreeSlot,
  type WorkerFacingReport,
} from "./types.js";

export interface MaterializeProtectedRequest {
  readonly dispatch: DispatchFingerprint;
  readonly required: readonly RequiredCheckRef[];
  readonly worktreePath: string;
  readonly hostDir: string;
}

export interface ImmutableReceiptInput {
  readonly checkId: string;
  readonly attempt: string;
  readonly checkVersion: number;
  readonly artifactDigest: string;
  readonly status: CheckDbStatus;
  readonly stability: CheckStability;
  readonly sandboxTier: SandboxTier;
  readonly commitSha: string;
  readonly checkVersions: Readonly<Record<string, number>>;
  readonly attribution: FailureAttribution | null;
  readonly affectsWorkerQualityScore: boolean;
  readonly burnsHiddenLadder: boolean;
  readonly route: AttributionRoute | null;
  readonly runs: readonly {
    readonly observed: unknown;
    readonly trace: Uint8Array;
    readonly log: Uint8Array;
  }[];
}

interface AttemptResources {
  slot?: VerifierWorktreeSlot;
  hostDir?: string;
  environments: ProvisionedEnv[];
}

interface StoredCheck {
  readonly draft: RunDraft;
  readonly runs: readonly CheckRunRecord[];
}

/**
 * Clean verifier. Acceptance never runs inside the worker worktree.
 * Comparison, required-id checks, and receipts happen in this process.
 */
export class CleanVerifierRunner {
  private readonly adapters: SurfaceVerifierAdapter[] = [];
  private readonly unsealer: ExpectationUnsealer;
  private readonly now: () => number;

  constructor(private readonly deps: CleanVerifierDeps) {
    this.unsealer = deps.unsealer ?? defaultExpectationUnsealer();
    this.now = deps.now ?? Date.now;
  }

  registerSurfaceVerifier(adapter: SurfaceVerifierAdapter): void {
    this.adapters.push(adapter);
  }

  parseCollectedCaseIds(reporter: string): CollectedCaseReport {
    return parseReporter(reporter);
  }

  async materializeProtectedExpectations(
    input: MaterializeProtectedRequest,
  ): Promise<MaterializedExpectations> {
    return materializeExpectations({
      ...input,
      loadBlob: (digest) => this.deps.cas.get(digest),
      unsealer: this.unsealer,
    });
  }

  /**
   * Persist one `check_results` row and promote the run log, trace, and observations into CAS.
   * Passes use retention `evidence`. Every other status uses `diagnostic`.
   */
  async writeImmutableReceipt(input: ImmutableReceiptInput): Promise<{
    readonly row: CheckResultInsert;
    readonly runs: readonly CheckRunRecord[];
  }> {
    const retention: CasRetention =
      input.status === "pass" && input.stability === "stable" ? "evidence" : "diagnostic";
    const runs: CheckRunRecord[] = [];
    const source = input.runs.length > 0
      ? input.runs
      : [{ observed: null, trace: Buffer.alloc(0), log: Buffer.alloc(0) }];
    for (const [index, run] of source.entries()) {
      const traceDigest = await this.deps.cas.put(run.trace, {
        retention,
        label: `${input.checkId}:trace:${index}`,
      });
      const logDigest = await this.deps.cas.put(run.log, {
        retention,
        label: `${input.checkId}:log:${index}`,
      });
      const observationsDigest = await this.deps.cas.put(
        Buffer.from(canonicalJson(run.observed), "utf8"),
        { retention, label: `${input.checkId}:observations:${index}` },
      );
      runs.push({
        observed: run.observed,
        traceDigest,
        logDigest,
        observationsDigest,
      });
    }
    const recordedAt = this.now();
    const receipt = canonicalJson({
      checkId: input.checkId,
      attempt: input.attempt,
      checkVersion: input.checkVersion,
      artifactDigest: input.artifactDigest,
      status: input.status,
      stability: input.stability,
      sandboxTier: input.sandboxTier,
      commitSha: input.commitSha,
      checkVersions: input.checkVersions,
      attribution: input.attribution,
      affectsWorkerQualityScore: input.affectsWorkerQualityScore,
      burnsHiddenLadder: input.burnsHiddenLadder,
      route: input.route,
      runs,
      recordedAt,
    });
    const row: CheckResultInsert = {
      checkId: input.checkId,
      attempt: input.attempt,
      checkVersion: input.checkVersion,
      artifactDigest: input.artifactDigest,
      status: input.status,
      receipt,
      recordedAt,
    };
    await this.deps.state.insertCheckResult(row);
    return { row, runs };
  }

  async verifyCandidate(request: VerifyCandidateRequest): Promise<VerificationOutcome> {
    const resources: AttemptResources = { environments: [] };
    let thrown: unknown;
    try {
      return await this.verifyInner(request, resources);
    } catch (error) {
      thrown = error;
      throw error;
    } finally {
      const cleanupError = await this.cleanup(resources);
      if (thrown === undefined && cleanupError) {
        throw cleanupError;
      }
    }
  }

  private async verifyInner(
    request: VerifyCandidateRequest,
    resources: AttemptResources,
  ): Promise<VerificationOutcome> {
    const state: CheckResultsPort = this.deps.state;
    const lease = await state.readAttemptLease(request.attemptId);
    const leaseProtected = lease.submissionPending;
    if (!lease.submissionPending && request.elapsedMs > lease.ttlMs) {
      return this.idleOutcome(request, {
        leaseProtected: false,
        staticAuditPassed: false,
        ranCandidate: false,
        cleanCheckoutPath: null,
        summary: "Attempt lease expired before submission was pending. Candidate was not executed.",
        messages: ["submission_pending is 0 and the attempt lease TTL has elapsed."],
      });
    }

    const slot = await this.deps.slots.checkoutImmutable({
      commitSha: request.commitSha,
      kind: "verifier",
      excludeWorktreePath: request.workerWorktreePath,
      excludeWorktreeId: request.workerWorktreeId,
    });
    resources.slot = slot;
    if (samePath(slot.worktreePath, request.workerWorktreePath)) {
      throw new CleanCheckoutSeparationError(
        "refusing to verify inside the worker attempt worktree",
      );
    }
    if (slot.commitSha !== request.commitSha || slot.kind !== "verifier") {
      throw new VerifierIntegrityError(
        "clean checkout commit does not match the candidate",
        "checkout",
      );
    }
    await this.deps.slots.attachLockedDependencies(slot, request.dependencyLockDigest);

    const audit = await this.deps.gate.runLeafStaticAudit({
      taskId: request.taskId,
      attemptId: request.attemptId,
      commitSha: request.commitSha,
      checkoutPath: slot.worktreePath,
    });
    if (!audit.passed) {
      return this.idleOutcome(request, {
        leaseProtected,
        staticAuditPassed: false,
        ranCandidate: false,
        cleanCheckoutPath: slot.worktreePath,
        summary: "Static audit failed. Candidate was not executed.",
        messages: audit.findings.length > 0 ? audit.findings : ["static audit failed"],
      });
    }

    const required = await state.listRequiredChecks(request.taskId);
    const missingRules = missingInScopeRules(required, request.inScopeRuleIds);
    if (missingRules.length > 0) {
      throw new VerifierIntegrityError(
        `in-scope cross-cutting rule missing from required checks: ${missingRules.join(",")}`,
        "expectations",
      );
    }

    const hostDir = mkdtempSync(join(this.deps.hostTempRoot ?? tmpdir(), "ef-verifier-host-"));
    resources.hostDir = hostDir;
    const materialized = await this.materializeProtectedExpectations({
      dispatch: request.dispatch,
      required,
      worktreePath: slot.worktreePath,
      hostDir,
    });
    const ignoredCandidateTestScript = readCandidateTestScript(slot.worktreePath);

    let env: ProvisionedEnv;
    try {
      env = await this.provision(request, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const kind = environmentKindFromMessage(message) ?? "service_crash";
      return this.finishEnvironment(
        request,
        materialized,
        slot.worktreePath,
        ignoredCandidateTestScript,
        leaseProtected,
        kind,
        message,
      );
    }
    resources.environments.push(env);

    const drafts = materialized.checks.map((check) => blankDraft(check));
    const first = await this.collectEvidence(materialized.checks, env, request, slot, false);
    for (const draft of drafts) {
      const evidence = first.evidence.get(draft.materialized.ref.checkId) ?? emptyEvidence(Buffer.alloc(0), Buffer.alloc(0), null);
      applyJudgement(draft, evidence);
    }

    const replayDrafts = drafts.filter((draft) => needsReplay(draft));
    if (replayDrafts.length > 0) {
      let replayEnv: ProvisionedEnv | undefined;
      try {
        replayEnv = await this.provision(request, true);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const kind = environmentKindFromMessage(message) ?? "service_crash";
        for (const draft of replayDrafts) {
          applyJudgement(
            draft,
            environmentEvidence(kind, Buffer.from(message), Buffer.from(message)),
          );
        }
      }
      if (replayEnv) {
        resources.environments.push(replayEnv);
        const second = await this.collectEvidence(
          replayDrafts.map((draft) => draft.materialized),
          replayEnv,
          request,
          slot,
          true,
        );
        for (const draft of replayDrafts) {
          const evidence = second.evidence.get(draft.materialized.ref.checkId);
          if (!evidence || evidence.signals?.environmentFailure) {
            applyJudgement(
              draft,
              evidence ?? environmentEvidence("service_crash", Buffer.alloc(0), Buffer.alloc(0)),
            );
            continue;
          }
          applyReplay(draft, evidence);
        }
      }
    }

    return this.finishDrafts(
      request,
      materialized,
      drafts,
      slot.worktreePath,
      ignoredCandidateTestScript,
      leaseProtected,
      true,
      first.exitCode,
    );
  }

  private async finishEnvironment(
    request: VerifyCandidateRequest,
    materialized: MaterializedExpectations,
    cleanCheckoutPath: string,
    ignoredCandidateTestScript: string | null,
    leaseProtected: boolean,
    kind: "postgres_crash" | "oom" | "port_failure" | "service_crash",
    message: string,
  ): Promise<VerificationOutcome> {
    const drafts = materialized.checks.map((check) => blankDraft(check));
    const evidence = environmentEvidence(kind, Buffer.from(message), Buffer.from(message));
    for (const draft of drafts) applyJudgement(draft, evidence);
    return this.finishDrafts(
      request,
      materialized,
      drafts,
      cleanCheckoutPath,
      ignoredCandidateTestScript,
      leaseProtected,
      false,
      null,
    );
  }

  private async finishDrafts(
    request: VerifyCandidateRequest,
    materialized: MaterializedExpectations,
    drafts: readonly RunDraft[],
    cleanCheckoutPath: string,
    ignoredCandidateTestScript: string | null,
    leaseProtected: boolean,
    ranCandidate: boolean,
    candidateExitCode: number | null,
  ): Promise<VerificationOutcome> {
    const checkVersions = checkVersionMap(materialized.checks);
    const stored: StoredCheck[] = [];
    for (const draft of drafts) {
      const written = await this.writeImmutableReceipt({
        checkId: draft.materialized.ref.checkId,
        attempt: request.attemptId,
        checkVersion: draft.materialized.ref.checkVersion,
        artifactDigest: request.artifactDigest,
        status: draft.status,
        stability: draft.stability,
        sandboxTier: request.sandboxTier,
        commitSha: request.commitSha,
        checkVersions,
        attribution: draft.decision?.attribution ?? null,
        affectsWorkerQualityScore: draft.decision?.affectsWorkerQualityScore ?? false,
        burnsHiddenLadder: draft.decision?.burnsHiddenLadder ?? false,
        route: draft.decision?.route ?? null,
        runs: draft.runs.map((run) => ({
          observed: run.hasObserved ? run.observed : null,
          trace: run.trace,
          log: run.log,
        })),
      });
      stored.push({ draft, runs: written.runs });
    }
    const outcome = this.assemble(
      request,
      stored,
      cleanCheckoutPath,
      ignoredCandidateTestScript,
      leaseProtected,
      ranCandidate,
      candidateExitCode,
      materialized.pinnedCommand,
    );
    const missingIds = drafts
      .filter((draft) => draft.status === "missing")
      .map((draft) => draft.materialized.ref.checkId);
    const environment = drafts.some((draft) => draft.decision?.attribution === "environment");
    if (missingIds.length > 0 && !environment) {
      throw new MissingRequiredChecksError(missingIds, outcome);
    }
    return outcome;
  }

  private assemble(
    request: VerifyCandidateRequest,
    stored: readonly StoredCheck[],
    cleanCheckoutPath: string | null,
    ignoredCandidateTestScript: string | null,
    leaseProtected: boolean,
    ranCandidate: boolean,
    candidateExitCode: number | null,
    pinnedCommand: readonly string[],
  ): VerificationOutcome {
    const drafts = stored.map((item) => item.draft);
    const accepted = drafts.length > 0 && drafts.every((draft) => draft.status === "pass" && draft.stability === "stable");
    const secrets = heldBackSecrets(drafts.map((draft) => draft.materialized));
    const checks: CheckOutcome[] = stored.map((item) => ({
      checkId: item.draft.materialized.ref.checkId,
      checkVersion: item.draft.materialized.ref.checkVersion,
      requirementId: item.draft.materialized.ref.requirementId,
      visibility: item.draft.materialized.ref.visibility,
      ruleId: item.draft.materialized.ref.ruleId,
      status: item.draft.status,
      stability: item.draft.stability,
      attribution: item.draft.decision?.attribution ?? null,
      affectsWorkerQualityScore: item.draft.decision?.affectsWorkerQualityScore ?? false,
      burnsHiddenLadder: item.draft.decision?.burnsHiddenLadder ?? false,
      route: item.draft.decision?.route ?? null,
      runs: item.runs,
    }));
    const ladder: HintLadderPayload[] = [];
    for (const draft of drafts) {
      if (!draft.decision?.burnsHiddenLadder) continue;
      if (draft.materialized.ref.visibility !== "held_back") continue;
      if (draft.stability !== "stable") continue;
      ladder.push({
        checkId: draft.materialized.ref.checkId,
        ruleId: draft.materialized.ref.ruleId,
        failureType: inferFailureType(draft.status),
        input: draft.materialized.input,
        expected: draft.materialized.expected,
        observed: draft.observed,
      });
    }
    const rawMessages = drafts.flatMap((draft) => (draft.decision ? [draft.decision.workerMessage] : []));
    const attribution = headlineAttribution(drafts);
    const summary = summaryFor(accepted, attribution, rawMessages);
    const workerFacing: WorkerFacingReport = {
      accepted,
      summary: redactSecrets(summary, secrets),
      messages: rawMessages.map((message) => redactSecrets(message, secrets)),
      checks: checks.map((check) => ({
        checkId: check.checkId,
        status: check.status,
        stability: check.stability,
        message: redactSecrets(
          rawMessages.find((message) => message.includes(check.checkId)) ?? summary,
          secrets,
        ),
      })),
    };
    return {
      accepted,
      taskId: request.taskId,
      attemptId: request.attemptId,
      commitSha: request.commitSha,
      artifactDigest: request.artifactDigest,
      sandboxTier: request.sandboxTier,
      ranCandidate,
      cleanCheckoutPath,
      workerWorktreePath: request.workerWorktreePath,
      usedPinnedCommand: pinnedCommand,
      ignoredCandidateTestScript,
      ignoredWorkerLocalCheckIds: request.workerLocalCheckIds,
      leaseProtected,
      staticAuditPassed: true,
      candidateExitCode,
      attribution,
      affectsWorkerQualityScore: drafts.some((draft) => draft.decision?.affectsWorkerQualityScore === true),
      burnsHiddenLadder: drafts.some((draft) => draft.decision?.burnsHiddenLadder === true),
      requirementResolution: requirementResolution(drafts),
      holdForEnvRecovery: drafts.some((draft) => draft.decision?.holdForEnvRecovery === true),
      checks,
      workerFacing,
      sealedHintLadder: ladder,
    };
  }

  private idleOutcome(
    request: VerifyCandidateRequest,
    input: {
      readonly leaseProtected: boolean;
      readonly staticAuditPassed: boolean;
      readonly ranCandidate: boolean;
      readonly cleanCheckoutPath: string | null;
      readonly summary: string;
      readonly messages: readonly string[];
    },
  ): VerificationOutcome {
    const workerFacing: WorkerFacingReport = {
      accepted: false,
      summary: input.summary,
      messages: input.messages,
      checks: [],
    };
    return {
      accepted: false,
      taskId: request.taskId,
      attemptId: request.attemptId,
      commitSha: request.commitSha,
      artifactDigest: request.artifactDigest,
      sandboxTier: request.sandboxTier,
      ranCandidate: input.ranCandidate,
      cleanCheckoutPath: input.cleanCheckoutPath,
      workerWorktreePath: request.workerWorktreePath,
      usedPinnedCommand: request.dispatch.pinnedCommand,
      ignoredCandidateTestScript: null,
      ignoredWorkerLocalCheckIds: request.workerLocalCheckIds,
      leaseProtected: input.leaseProtected,
      staticAuditPassed: input.staticAuditPassed,
      candidateExitCode: null,
      attribution: null,
      affectsWorkerQualityScore: false,
      burnsHiddenLadder: false,
      requirementResolution: "not_run",
      holdForEnvRecovery: false,
      checks: [],
      workerFacing,
      sealedHintLadder: [],
    };
  }

  private async collectEvidence(
    checks: readonly MaterializedCheck[],
    env: ProvisionedEnv,
    request: VerifyCandidateRequest,
    slot: VerifierWorktreeSlot,
    replay: boolean,
  ): Promise<{ readonly evidence: ReadonlyMap<string, CollectedEvidence>; readonly exitCode: number | null }> {
    const evidence = new Map<string, CollectedEvidence>();
    let exitCode: number | null = null;
    const clock: ReplayClock | undefined = replay ? CLEAN_VERIFIER_REPLAY_CLOCK : undefined;
    for (const adapter of this.adapters) {
      const owned = checks.filter((check) => adapter.supports(check.ref) && !evidence.has(check.ref.checkId));
      if (owned.length === 0) continue;
      try {
        const collected = await adapter.collect({
          checkoutPath: slot.worktreePath,
          commitSha: request.commitSha,
          attemptId: request.attemptId,
          env,
          checks: owned.map(toSandboxInput),
          replay,
          ...(clock ? { clock } : {}),
        });
        const returned = new Set<string>();
        for (const result of collected) {
          returned.add(result.checkId);
          evidence.set(result.checkId, {
            present: true,
            reporterStatus: result.reporterStatus,
            hasObserved: result.hasObserved,
            observed: result.hasObserved ? result.observed : null,
            signals: result.signals,
            trace: result.trace,
            log: result.log,
          });
        }
        for (const check of owned) {
          if (returned.has(check.ref.checkId)) continue;
          evidence.set(check.ref.checkId, emptyEvidence(Buffer.alloc(0), Buffer.alloc(0), null));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const kind = environmentKindFromMessage(message);
        if (!kind) throw error;
        for (const check of owned) {
          evidence.set(
            check.ref.checkId,
            environmentEvidence(kind, Buffer.from(message), Buffer.from(message)),
          );
        }
      }
    }

    const remaining = checks.filter((check) => !evidence.has(check.ref.checkId));
    if (remaining.length === 0) {
      return { evidence, exitCode };
    }
    const executed = await this.executePinned(remaining, env, request, slot, replay);
    exitCode = executed.exitCode;
    if (executed.environmentFailure) {
      for (const check of remaining) {
        evidence.set(
          check.ref.checkId,
          environmentEvidence(executed.environmentFailure, executed.trace, executed.log),
        );
      }
      return { evidence, exitCode };
    }
    const parsed = this.parseCollectedCaseIds(executed.reporterBody);
    const byId = new Map<string, (typeof parsed.cases)[number]>();
    for (const item of parsed.cases) byId.set(item.checkId, item);
    for (const check of remaining) {
      evidence.set(
        check.ref.checkId,
        evidenceFromCase(byId.get(check.ref.checkId), executed.trace, executed.log, executed.signals ?? null),
      );
    }
    return { evidence, exitCode };
  }

  private async executePinned(
    checks: readonly MaterializedCheck[],
    env: ProvisionedEnv,
    request: VerifyCandidateRequest,
    slot: VerifierWorktreeSlot,
    replay: boolean,
  ): Promise<PinnedRunResult & { readonly environmentFailure: "postgres_crash" | "oom" | "port_failure" | "service_crash" | null }> {
    const engine: HarnessRunEnginePort = this.deps.engine;
    const clock: ReplayClock | undefined = replay ? CLEAN_VERIFIER_REPLAY_CLOCK : undefined;
    try {
      const result = await engine.runPinned({
        command: request.dispatch.pinnedCommand,
        cwd: slot.worktreePath,
        envId: env.id,
        sandboxTier: request.sandboxTier,
        commitSha: request.commitSha,
        attemptId: request.attemptId,
        inputs: checks.map(toSandboxInput),
        hostChannel: "host-owned",
        replay,
        ...(clock ? { clock } : {}),
      });
      return {
        ...result,
        environmentFailure: result.signals?.environmentFailure ?? null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const kind = environmentKindFromMessage(message);
      if (!kind) throw error;
      return {
        exitCode: null,
        reporterBody: "",
        trace: Buffer.from(message),
        log: Buffer.from(message),
        signals: { environmentFailure: kind },
        environmentFailure: kind,
      };
    }
  }

  private provision(request: VerifyCandidateRequest, replay: boolean): Promise<ProvisionedEnv> {
    const clock: ReplayClock | undefined = replay ? CLEAN_VERIFIER_REPLAY_CLOCK : undefined;
    return this.deps.environments.provision({
      tier: request.sandboxTier,
      isolatedFromAttemptId: request.attemptId,
      commitSha: request.commitSha,
      replay,
      ...(clock ? { clock } : {}),
    });
  }

  private async cleanup(resources: AttemptResources): Promise<Error | null> {
    const problems: string[] = [];
    if (resources.hostDir) {
      try {
        shredTree(resources.hostDir);
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
      }
    }
    for (const env of resources.environments) {
      try {
        await env.destroy();
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (resources.slot) {
      try {
        await this.deps.slots.release(resources.slot);
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (problems.length === 0) return null;
    return new Error(problems.join("; "));
  }
}

function blankDraft(check: MaterializedCheck): RunDraft {
  return {
    materialized: check,
    status: "missing",
    stability: "stable",
    observed: null,
    hasObserved: false,
    signals: null,
    runs: [],
    decision: null,
  };
}

function environmentEvidence(
  kind: "postgres_crash" | "oom" | "port_failure" | "service_crash",
  trace: Uint8Array,
  log: Uint8Array,
): CollectedEvidence {
  return {
    present: true,
    reporterStatus: "error",
    hasObserved: false,
    observed: null,
    signals: { environmentFailure: kind },
    trace,
    log,
  };
}

function toSandboxInput(check: MaterializedCheck): SandboxCheckInput {
  const base = {
    checkId: check.ref.checkId,
    input: check.input,
    surface: check.ref.surface,
  };
  if (check.entry) return { ...base, entry: check.entry };
  return base;
}

function checkVersionMap(checks: readonly MaterializedCheck[]): Record<string, number> {
  const versions: Record<string, number> = {};
  for (const check of checks) versions[check.ref.checkId] = check.ref.checkVersion;
  return versions;
}

function heldBackSecrets(checks: readonly MaterializedCheck[]): string[] {
  const secrets: string[] = [];
  for (const check of checks) {
    if (check.ref.visibility !== "held_back") continue;
    secretLeaves(check.input, secrets);
    secretLeaves(check.expected, secrets);
    const canonicalExpected = canonicalJson(check.expected);
    const canonicalInput = canonicalJson(check.input);
    if (canonicalExpected.length >= 8) secrets.push(canonicalExpected);
    if (canonicalInput.length >= 8) secrets.push(canonicalInput);
  }
  return secrets;
}

function summaryFor(
  accepted: boolean,
  attribution: FailureAttribution | null,
  messages: readonly string[],
): string {
  if (accepted) return "All required checks passed.";
  if (attribution === "environment") return "Verification held for environment recovery.";
  if (attribution === "flaky_test") return "A required check is unstable. The requirement stays unresolved.";
  if (attribution === "binding_defect") return "Binding defect returned to the task author.";
  if (attribution === "contract_mismatch") return messages[0] ?? "Visible contract mismatch.";
  return "Verification failed.";
}

function readCandidateTestScript(worktreePath: string): string | null {
  const file = join(worktreePath, "package.json");
  if (!existsSync(file)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid json";
    void reason;
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const scripts = (parsed as { scripts?: unknown }).scripts;
  if (!scripts || typeof scripts !== "object") return null;
  const testScript = (scripts as { test?: unknown }).test;
  return typeof testScript === "string" ? testScript : null;
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase() === resolve(right).toLocaleLowerCase();
}

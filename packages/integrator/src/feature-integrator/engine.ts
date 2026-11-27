import type {
  AdapterCallOptions,
  ModelProfile,
  ModelProtocolAdapter,
  ModelRoute,
} from "@ef-harness/worker-loop";
import { featureRef, INTEGRATION_REF } from "./constants.js";
import { buildScopedConflictPrompt } from "./conflict-text.js";
import { resolvePreflight } from "./conflict-resolver.js";
import { verifyFeatureDoneConditions } from "./done-gate.js";
import {
  FeatureDoneRefusedError,
  FeatureNotReadyError,
  IntegrationBlockedError,
  StaleEpochError,
} from "./errors.js";
import { isAncestor, revParse } from "./git.js";
import {
  FeatureJourneyGate,
  RedBeforeGreenBlindBinder,
  bindCompletenessGateRunner,
  mountsOf,
  runBoundedFixLoop,
} from "./journey-gate.js";
import { gitSnapshots } from "./snapshots.js";
import { MergeTreePreflightScanner } from "./merge-tree-preflight.js";
import { createGitRefCas } from "./ref-cas.js";
import { isBlockedOutput, parseFeatureIntegratorV1 } from "./schema.js";
import { assertNoTestWeakening } from "./test-weakening.js";
import { buildTrailers, renderCommitMessage } from "./trailers.js";
import { commitTree, replaceFiles, snapshotFiles } from "./trees.js";
import type {
  AggregatedWiringTask,
  BlindBinderPort,
  CleanSnapshotPort,
  CleanVerifierHarnessPort,
  CodeSnapshot,
  FeatureDoneEvidenceInput,
  FeatureIntegrationRequest,
  FeatureIntegrationResult,
  FeatureIntegratorModelPort,
  FeatureIntegratorV1,
  FileText,
  RefCasPort,
  StaticAuditPort,
  TaskEvidence,
  WiringRepair,
} from "./types.js";
import { AggregatedWiringTaskBuilder } from "./wiring-task.js";

export interface FeatureIntegratorEngineDeps {
  readonly scanner: MergeTreePreflightScanner;
  readonly wiring: AggregatedWiringTaskBuilder;
  readonly journey: FeatureJourneyGate;
  readonly snapshots: CleanSnapshotPort;
  readonly binder: BlindBinderPort;
  readonly staticAudit: StaticAuditPort;
  readonly cleanVerifier?: CleanVerifierHarnessPort;
}

interface LoopState {
  readonly tree: string;
  readonly wiring: ReturnType<AggregatedWiringTaskBuilder["build"]>;
}

/**
 * Adapts `@ef-harness/worker-loop` `ModelProtocolAdapter` to `FeatureIntegratorModelPort`.
 */
export function adaptFeatureIntegratorModel(
  adapter: ModelProtocolAdapter,
  config: {
    readonly model: string;
    readonly profile: ModelProfile;
    readonly route: ModelRoute;
    readonly callOptions: AdapterCallOptions;
    readonly systemPrompt?: string;
    readonly reservedOutputTokens?: number;
  },
): FeatureIntegratorModelPort {
  let seq = 0;
  return {
    async complete(packet) {
      seq += 1;
      const promptText = buildScopedConflictPrompt(packet);
      const stream = adapter.stream(
        {
          model: config.model,
          profile: config.profile,
          route: config.route,
          prefix: {
            zone1: config.systemPrompt ?? "You are the feature-integrator@1 conflict & wiring assistant.",
            zone2: "Return strict FeatureIntegratorV1 JSON.",
          },
          messages: [{ role: "user", text: promptText }],
          tools: [],
          replayItems: [],
          reservedOutputTokens: config.reservedOutputTokens ?? 1024,
          clientRequestId: `feature-integrator-${seq}`,
          idempotencyKey: `feature-integrator-${seq}`,
        },
        config.callOptions,
      );
      let structured: unknown;
      let text = "";
      for await (const event of stream) {
        if (event.type === "structured_output") {
          structured = event.parsed;
        } else if (event.type === "text_delta") {
          text += event.text;
        } else if (event.type === "error") {
          throw new Error(event.error.message);
        }
      }
      if (structured !== undefined) return structured;
      return JSON.parse(text) as unknown;
    },
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

async function blockedResult(
  request: FeatureIntegrationRequest,
  output: FeatureIntegratorV1,
  hints: FeatureIntegrationResult["hints"],
): Promise<FeatureIntegrationResult> {
  return {
    phase: "INTEGRATING",
    status: "blocked",
    featureState: (await request.lifecycle.read(request.featureId)).state,
    commitSha: null,
    integrationSha: null,
    trailers: null,
    output,
    wiringTaskId: null,
    hints,
    redBeforeGreen: [],
    queueHandoff: null,
    failedConditions: [],
  };
}

export class FeatureIntegratorEngine {
  private readonly scanner: MergeTreePreflightScanner;
  private readonly wiringBuilder: AggregatedWiringTaskBuilder;
  private readonly journey: FeatureJourneyGate;
  private readonly snapshots: CleanSnapshotPort;
  private readonly binder: BlindBinderPort;
  private readonly staticAudit: StaticAuditPort;
  private readonly cleanVerifier?: CleanVerifierHarnessPort;

  constructor(deps: Partial<FeatureIntegratorEngineDeps> = {}) {
    this.scanner = deps.scanner ?? new MergeTreePreflightScanner();
    this.wiringBuilder = deps.wiring ?? new AggregatedWiringTaskBuilder();
    this.staticAudit = deps.staticAudit ?? bindCompletenessGateRunner();
    this.journey = deps.journey ?? new FeatureJourneyGate(this.staticAudit);
    this.snapshots = deps.snapshots ?? gitSnapshots;
    this.binder = deps.binder ?? new RedBeforeGreenBlindBinder();
    if (deps.cleanVerifier !== undefined) {
      this.cleanVerifier = deps.cleanVerifier;
    }
  }

  async integrate(request: FeatureIntegrationRequest): Promise<FeatureIntegrationResult> {
    const row = await request.lifecycle.read(request.featureId);
    if (row.state !== "LEAVES_MERGED") {
      throw new FeatureNotReadyError(request.featureId, row.state);
    }
    if (row.epoch !== request.expectedEpoch) {
      throw new StaleEpochError(request.featureId, request.expectedEpoch, row.epoch);
    }
    if (request.modelOutput !== undefined) {
      const parsed = parseFeatureIntegratorV1(request.modelOutput);
      if (isBlockedOutput(parsed)) return blockedResult(request, parsed, []);
    } else if (request.model !== undefined) {
      const modelRaw = await request.model.complete({
        hunks: [],
        objectives: request.leaves.map((leaf) => ({ taskId: leaf.taskId, objective: leaf.objective })),
      });
      const parsed = parseFeatureIntegratorV1(modelRaw);
      if (isBlockedOutput(parsed)) return blockedResult(request, parsed, []);
    }
    if (request.leaves.length === 0) {
      throw new IntegrationBlockedError(`Feature ${request.featureId} has no leaf commits to assemble.`);
    }

    const repo = request.repoPath;
    const integrationSha = await revParse(repo, INTEGRATION_REF);
    const originalFeatureSha = await revParse(repo, featureRef(request.featureId));
    const assembled = await this.assembleLeaves(request, originalFeatureSha);
    const wiring = this.wiringBuilder.build(request.featureId, request.leaves);
    const assembledFiles = await snapshotFiles(repo, assembled.sha);
    const tree = await replaceFiles(repo, assembled.sha, wiring.files);
    await this.guardTests(assembledFiles, tree, repo);

    const requestStaticAudit =
      request.nameRegistry !== undefined || request.registry !== undefined
        ? bindCompletenessGateRunner(
            undefined,
            request.nameRegistry !== undefined ? { nameRegistry: request.nameRegistry } : {},
          )
        : this.staticAudit;

    const loop = await runBoundedFixLoop<LoopState>({
      initial: { tree, wiring },
      evaluate: async (state) => {
        const feature = await this.featureSnapshot(repo, state.tree, "pending");
        const base = await this.snapshots.read(repo, integrationSha, "base");
        return this.journey.evaluate({
          base,
          feature,
          sealedChecks: request.sealedChecks,
          mounts: mountsOf([...state.wiring.mounts]),
          journeys: request.seamJourneys,
          viewportChecks: request.viewportChecks,
          auditFiles: [...state.wiring.files],
          binder: this.binder,
          staticAudit: requestStaticAudit,
          featureId: request.featureId,
          taskId: state.wiring.id,
          ...(request.entryPoints !== undefined ? { entryPoints: request.entryPoints } : {}),
        });
      },
      apply: (state, repair) => this.applyRepair(request, repo, state, repair),
    });

    if (!loop.report.ok) {
      const output = this.output(loop.state.wiring.id, assembled.summaries, request);
      return {
        ...(await blockedResult(request, output, loop.hints)),
        wiringTaskId: loop.state.wiring.id,
        redBeforeGreen: loop.report.redBeforeGreen,
      };
    }

    if (this.cleanVerifier !== undefined && request.cleanVerification !== undefined) {
      const outcome = await this.cleanVerifier.verifyCandidate(request.cleanVerification);
      if (!outcome.accepted) {
        const output = this.output(loop.state.wiring.id, assembled.summaries, request);
        return {
          ...(await blockedResult(request, output, [
            ...loop.hints,
            {
              round: loop.hints.length + 1,
              target: "clean_verifier",
              detail: outcome.workerFacing.summary,
              repair: null,
            },
          ])),
          wiringTaskId: loop.state.wiring.id,
          redBeforeGreen: loop.report.redBeforeGreen,
        };
      }
    }

    const trailers = buildTrailers({
      featureId: request.featureId,
      taskIds: request.leaves.map((leaf) => leaf.taskId),
      requirementIds: [
        ...request.requirements.map((requirement) => requirement.id),
        ...request.leaves.flatMap((leaf) => leaf.requirementIds),
      ],
      checkIds: this.checkIds(request),
      harnessVersion: request.harnessVersion,
    });
    const message = await renderCommitMessage(
      repo,
      `Integrate ${request.featureId}`,
      `One wiring task ${loop.state.wiring.id} connects ${request.leaves.map((leaf) => leaf.taskId).join(", ")}.`,
      trailers,
    );
    const parents = request.history === "preserve" ? [assembled.sha] : [integrationSha];
    const commitSha = await commitTree(repo, loop.state.tree, parents, message);
    await this.casOrThrow(request, featureRef(request.featureId), commitSha, originalFeatureSha);

    await this.transition(request, "WIRED");
    await this.transition(request, "JOURNEY_PASSED");
    const output = this.output(loop.state.wiring.id, assembled.summaries, request);

    if (request.mode === "m3_queue") {
      await this.transition(request, "QUEUED_FOR_MERGE");
      return {
        phase: "INTEGRATING",
        status: "queued_for_merge",
        featureState: "QUEUED_FOR_MERGE",
        commitSha,
        integrationSha: null,
        trailers,
        output,
        wiringTaskId: loop.state.wiring.id,
        hints: loop.hints,
        redBeforeGreen: loop.report.redBeforeGreen,
        queueHandoff: { target: "Task 111", featureRef: featureRef(request.featureId), commitSha },
        failedConditions: [],
      };
    }

    const landed = await this.land(request, commitSha, integrationSha, message, loop.state.wiring);
    await this.transition(request, "QUEUED_FOR_MERGE");
    await this.transition(request, "MERGED");
    const evidence = this.evidence(request, loop.state.wiring.id, landed, loop.state.wiring.files.map((f) => f.path), {
      merged: true,
      journey: true,
      audit: loop.report.auditFindings.length === 0,
      hasScreens: loop.state.wiring.touchesUi || request.viewportChecks.length > 0,
    });
    const done = verifyFeatureDoneConditions(evidence);
    if (!done.ok) throw new FeatureDoneRefusedError(done);
    await this.transition(request, "DONE", evidence);
    return {
      phase: "INTEGRATING",
      status: "done",
      featureState: "DONE",
      commitSha: landed,
      integrationSha: landed,
      trailers,
      output,
      wiringTaskId: loop.state.wiring.id,
      hints: loop.hints,
      redBeforeGreen: loop.report.redBeforeGreen,
      queueHandoff: null,
      failedConditions: [],
    };
  }

  private async assembleLeaves(
    request: FeatureIntegrationRequest,
    featureSha: string,
  ): Promise<{ sha: string; summaries: { path: string; summary: string }[] }> {
    const repo = request.repoPath;
    let current = featureSha;
    const summaries: { path: string; summary: string }[] = [];
    const objectives = request.leaves.map((leaf) => ({ taskId: leaf.taskId, objective: leaf.objective }));
    for (const leaf of request.leaves) {
      if (await isAncestor(repo, leaf.sha, current)) continue;
      const scan = await this.scanner.scan({ repo, ours: current, theirs: leaf.sha });
      let tree = scan.treeOid;
      if (!scan.clean) {
        const resolved = await resolvePreflight({
          repo,
          report: scan,
          objectives,
          ...(request.resolutionOverrides ? { overrides: request.resolutionOverrides } : {}),
        });
        tree = await replaceFiles(repo, scan.treeOid, resolved.files);
        summaries.push(...resolved.summaries);
      }
      current = await commitTree(repo, tree, [current, leaf.sha], `Assemble ${leaf.taskId}\n`);
    }
    return { sha: current, summaries };
  }

  private async applyRepair(
    request: FeatureIntegrationRequest,
    repo: string,
    state: LoopState,
    repair: WiringRepair,
  ): Promise<LoopState> {
    const before = await snapshotFiles(repo, state.tree);
    const wiring = this.wiringBuilder.repair(state.wiring, repair, request.leaves);
    const tree = await replaceFiles(repo, state.tree, wiring.files);
    await this.guardTests(before, tree, repo);
    return { tree, wiring };
  }

  private async guardTests(before: ReadonlyMap<string, string>, tree: string, repo: string): Promise<void> {
    const after = await snapshotFiles(repo, tree);
    assertNoTestWeakening(
      [...before.entries()].map(([filePath, text]) => ({ path: filePath, text })),
      [...after.entries()].map(([filePath, text]) => ({ path: filePath, text })),
    );
  }

  private async featureSnapshot(repo: string, treeOrCommit: string, commit: string): Promise<CodeSnapshot> {
    return { label: "feature", commit, files: await snapshotFiles(repo, treeOrCommit) };
  }

  private async land(
    request: FeatureIntegrationRequest,
    commitSha: string,
    expectedIntegration: string,
    message: string,
    wiring: AggregatedWiringTask,
  ): Promise<string> {
    const repo = request.repoPath;
    const first = await this.cas(request).advance({
      repo,
      ref: INTEGRATION_REF,
      newSha: commitSha,
      expectedOldSha: expectedIntegration,
      holder: request.holder,
      epoch: request.expectedEpoch,
    });
    if (first.ok) return commitSha;
    const actual = first.actualSha;
    const scan = await this.scanner.scan({ repo, ours: actual, theirs: commitSha });
    let tree = scan.treeOid;
    let resolvedFiles: readonly FileText[] = [];
    if (!scan.clean) {
      const resolved = await resolvePreflight({
        repo,
        report: scan,
        objectives: request.leaves.map((leaf) => ({ taskId: leaf.taskId, objective: leaf.objective })),
      });
      resolvedFiles = resolved.files;
      tree = await replaceFiles(repo, scan.treeOid, resolved.files);
    }
    const merged = await commitTree(repo, tree, [actual, commitSha], message);
    const conflictHunks = scan.conflicts.flatMap((conflict) => conflict.hunks);
    const touchedFiles = new Map<string, string>();
    for (const file of wiring.files) touchedFiles.set(file.path, file.text);
    for (const file of resolvedFiles) touchedFiles.set(file.path, file.text);
    const report = await this.journey.evaluate({
      base: await this.snapshots.read(repo, actual, "base"),
      feature: await this.snapshots.read(repo, merged, "feature"),
      sealedChecks: request.sealedChecks,
      mounts: mountsOf([...wiring.mounts]),
      journeys: request.seamJourneys,
      viewportChecks: request.viewportChecks,
      auditFiles: [...touchedFiles.entries()].map(([filePath, text]) => ({
        path: filePath,
        text,
      })),
      binder: this.binder,
      featureId: request.featureId,
      taskId: wiring.id,
      ...(conflictHunks.length > 0 ? { conflictHunks } : {}),
      ...(request.entryPoints !== undefined ? { entryPoints: request.entryPoints } : {}),
    });
    if (!report.ok) {
      throw new IntegrationBlockedError(report.hint?.detail ?? "re-verification failed after integration moved");
    }
    const second = await this.cas(request).advance({
      repo,
      ref: INTEGRATION_REF,
      newSha: merged,
      expectedOldSha: actual,
      holder: request.holder,
      epoch: request.expectedEpoch,
    });
    if (!second.ok) throw new IntegrationBlockedError(`compare-and-swap missed ${second.actualSha}`);
    return merged;
  }

  private cas(request: FeatureIntegrationRequest): RefCasPort {
    return request.cas ?? createGitRefCas();
  }

  private async casOrThrow(
    request: FeatureIntegrationRequest,
    ref: string,
    newSha: string,
    expected: string,
  ): Promise<void> {
    const result = await this.cas(request).advance({
      repo: request.repoPath,
      ref,
      newSha,
      expectedOldSha: expected,
      holder: request.holder,
      epoch: request.expectedEpoch,
    });
    if (!result.ok) {
      throw new IntegrationBlockedError(`ref ${ref} moved before the feature commit (${result.actualSha})`);
    }
  }

  private async transition(
    request: FeatureIntegrationRequest,
    to: "WIRED" | "JOURNEY_PASSED" | "QUEUED_FOR_MERGE" | "MERGED" | "DONE",
    evidence: FeatureDoneEvidenceInput | null = null,
  ): Promise<void> {
    await request.lifecycle.transition({
      featureId: request.featureId,
      to,
      expectedEpoch: request.expectedEpoch,
      evidence,
    });
  }

  private checkIds(request: FeatureIntegrationRequest): string[] {
    return unique([
      ...request.leaves.flatMap((leaf) => leaf.checkIds),
      ...request.sealedChecks.map((check) => check.id),
      ...request.seamJourneys.map((journey) => journey.id),
      ...request.viewportChecks.map((check) => check.id),
    ]);
  }

  private output(
    wiringId: string,
    summaries: readonly { path: string; summary: string }[],
    request: FeatureIntegrationRequest,
  ): FeatureIntegratorV1 {
    return parseFeatureIntegratorV1({
      resolved_conflicts: summaries.map((summary) => ({ path: summary.path, summary: summary.summary })),
      wiring_done: [wiringId],
      rerun_checks: this.checkIds(request),
    });
  }

  private evidence(
    request: FeatureIntegrationRequest,
    wiringId: string,
    mergeCommit: string,
    auditedPaths: readonly string[],
    flags: { merged: boolean; journey: boolean; audit: boolean; hasScreens: boolean },
  ): FeatureDoneEvidenceInput {
    const tasks: TaskEvidence[] =
      request.tasks.length > 0
        ? [...request.tasks]
        : request.leaves.map((leaf) => ({
            id: leaf.taskId,
            state: "MERGED_TO_FEATURE",
            briefVersion: 1,
            currentBriefVersion: 1,
            contractVersion: 1,
            currentContractVersion: 1,
          }));
    if (!tasks.some((task) => task.id === wiringId)) {
      tasks.push({
        id: wiringId,
        state: "MERGED_TO_FEATURE",
        briefVersion: 1,
        currentBriefVersion: 1,
        contractVersion: 1,
        currentContractVersion: 1,
      });
    }
    return {
      tasks,
      requirements: request.requirements,
      staticAuditClean: flags.audit,
      journeyPassedInCleanEnv: flags.journey,
      mergedOntoIntegration: flags.merged,
      earlierDoneRegressionsPassed: request.earlierRegressions.every((item) => item.passed),
      hasScreens: flags.hasScreens,
      accessibilityClean: request.accessibilityClean,
      layoutClean: request.layoutClean,
      openContractChangeRequestIds: request.openContractChangeRequestIds,
      auditedPaths: [
        ...new Set([...auditedPaths, ...request.leaves.flatMap((leaf) => leaf.writeScope)]),
      ],
      integrationMergeCommit: mergeCommit,
      regressedFeatureIds: request.earlierRegressions
        .filter((item) => item.passed)
        .map((item) => item.featureId),
    };
  }
}

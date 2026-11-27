import { featureRef, INTEGRATION_REF } from "./constants.js";
import { resolvePreflight } from "./conflict-resolver.js";
import { verifyFeatureDoneConditions } from "./done-gate.js";
import {
  FeatureDoneRefusedError,
  FeatureNotReadyError,
  IntegrationBlockedError,
  StaleEpochError,
} from "./errors.js";
import { isAncestor, revParse } from "./git.js";
import { FeatureJourneyGate, mountsOf, runBoundedFixLoop } from "./journey-gate.js";
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
  CodeSnapshot,
  FeatureDoneEvidenceInput,
  FeatureIntegrationRequest,
  FeatureIntegrationResult,
  FeatureIntegratorV1,
  RefCasPort,
  TaskEvidence,
  WiringRepair,
} from "./types.js";
import { AggregatedWiringTaskBuilder } from "./wiring-task.js";

interface EngineDeps {
  readonly scanner: MergeTreePreflightScanner;
  readonly wiring: AggregatedWiringTaskBuilder;
  readonly journey: FeatureJourneyGate;
  readonly snapshots: CleanSnapshotPort;
  readonly binder: BlindBinderPort;
}

interface LoopState {
  readonly tree: string;
  readonly wiring: ReturnType<AggregatedWiringTaskBuilder["build"]>;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function blockedResult(
  request: FeatureIntegrationRequest,
  output: FeatureIntegratorV1,
  hints: FeatureIntegrationResult["hints"],
): FeatureIntegrationResult {
  return {
    phase: "INTEGRATING",
    status: "blocked",
    featureState: request.lifecycle.read(request.featureId).state,
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

  constructor(deps: Partial<EngineDeps> = {}) {
    this.scanner = deps.scanner ?? new MergeTreePreflightScanner();
    this.wiringBuilder = deps.wiring ?? new AggregatedWiringTaskBuilder();
    this.journey = deps.journey ?? new FeatureJourneyGate();
    this.snapshots = deps.snapshots ?? gitSnapshots;
    this.binder = deps.binder ?? { bind: (check) => check };
  }

  async integrate(request: FeatureIntegrationRequest): Promise<FeatureIntegrationResult> {
    const row = request.lifecycle.read(request.featureId);
    if (row.state !== "LEAVES_MERGED") {
      throw new FeatureNotReadyError(request.featureId, row.state);
    }
    if (row.epoch !== request.expectedEpoch) {
      throw new StaleEpochError(request.featureId, request.expectedEpoch, row.epoch);
    }
    if (request.modelOutput !== undefined) {
      const parsed = parseFeatureIntegratorV1(request.modelOutput);
      if (isBlockedOutput(parsed)) return blockedResult(request, parsed, []);
    }
    if (request.leaves.length === 0) {
      throw new IntegrationBlockedError(`Feature ${request.featureId} has no leaf commits to assemble.`);
    }

    const repo = request.repoPath;
    const integrationSha = revParse(repo, INTEGRATION_REF);
    const originalFeatureSha = revParse(repo, featureRef(request.featureId));
    const assembled = this.assembleLeaves(request, originalFeatureSha);
    const wiring = this.wiringBuilder.build(request.featureId, request.leaves);
    const assembledFiles = snapshotFiles(repo, assembled.sha);
    const tree = replaceFiles(repo, assembled.sha, wiring.files);
    this.guardTests(assembledFiles, tree, repo);

    const loop = await runBoundedFixLoop<LoopState>({
      initial: { tree, wiring },
      evaluate: (state) => {
        const feature = this.featureSnapshot(repo, state.tree, "pending");
        const base = this.snapshots.read(repo, integrationSha, "base");
        return this.journey.evaluate({
          base,
          feature,
          sealedChecks: request.sealedChecks,
          mounts: mountsOf([...state.wiring.mounts]),
          journeys: request.seamJourneys,
          viewportChecks: request.viewportChecks,
          auditFiles: [...state.wiring.files],
          binder: this.binder,
        });
      },
      apply: (state, repair) => this.applyRepair(request, repo, state, repair),
    });

    if (!loop.report.ok) {
      const output = this.output(loop.state.wiring.id, assembled.summaries, request);
      return {
        ...blockedResult(request, output, loop.hints),
        wiringTaskId: loop.state.wiring.id,
        redBeforeGreen: loop.report.redBeforeGreen,
      };
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
    const message = renderCommitMessage(
      repo,
      `Integrate ${request.featureId}`,
      `One wiring task ${loop.state.wiring.id} connects ${request.leaves.map((leaf) => leaf.taskId).join(", ")}.`,
      trailers,
    );
    const parents = request.history === "preserve" ? [assembled.sha] : [integrationSha];
    const commitSha = commitTree(repo, loop.state.tree, parents, message);
    this.casOrThrow(request, featureRef(request.featureId), commitSha, originalFeatureSha);

    this.transition(request, "WIRED");
    this.transition(request, "JOURNEY_PASSED");
    const output = this.output(loop.state.wiring.id, assembled.summaries, request);

    if (request.mode === "m3_queue") {
      this.transition(request, "QUEUED_FOR_MERGE");
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
    this.transition(request, "QUEUED_FOR_MERGE");
    this.transition(request, "MERGED");
    const evidence = this.evidence(request, loop.state.wiring.id, {
      merged: true,
      journey: true,
      audit: loop.report.auditFindings.length === 0,
      hasScreens: loop.state.wiring.touchesUi || request.viewportChecks.length > 0,
    });
    const done = verifyFeatureDoneConditions(evidence);
    if (!done.ok) throw new FeatureDoneRefusedError(done);
    this.transition(request, "DONE", evidence);
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

  private assembleLeaves(
    request: FeatureIntegrationRequest,
    featureSha: string,
  ): { sha: string; summaries: { path: string; summary: string }[] } {
    const repo = request.repoPath;
    let current = featureSha;
    const summaries: { path: string; summary: string }[] = [];
    const objectives = request.leaves.map((leaf) => ({ taskId: leaf.taskId, objective: leaf.objective }));
    for (const leaf of request.leaves) {
      if (isAncestor(repo, leaf.sha, current)) continue;
      const scan = this.scanner.scan({ repo, ours: current, theirs: leaf.sha });
      let tree = scan.treeOid;
      if (!scan.clean) {
        const resolved = resolvePreflight({
          repo,
          report: scan,
          objectives,
          ...(request.resolutionOverrides ? { overrides: request.resolutionOverrides } : {}),
        });
        tree = replaceFiles(repo, scan.treeOid, resolved.files);
        summaries.push(...resolved.summaries);
      }
      current = commitTree(repo, tree, [current, leaf.sha], `Assemble ${leaf.taskId}\n`);
    }
    return { sha: current, summaries };
  }

  private applyRepair(
    request: FeatureIntegrationRequest,
    repo: string,
    state: LoopState,
    repair: WiringRepair,
  ): LoopState {
    const before = snapshotFiles(repo, state.tree);
    const wiring = this.wiringBuilder.repair(state.wiring, repair, request.leaves);
    const tree = replaceFiles(repo, state.tree, wiring.files);
    this.guardTests(before, tree, repo);
    return { tree, wiring };
  }

  private guardTests(before: ReadonlyMap<string, string>, tree: string, repo: string): void {
    const after = snapshotFiles(repo, tree);
    assertNoTestWeakening(
      [...before.entries()].map(([path, text]) => ({ path, text })),
      [...after.entries()].map(([path, text]) => ({ path, text })),
    );
  }

  private featureSnapshot(repo: string, treeOrCommit: string, commit: string): CodeSnapshot {
    return { label: "feature", commit, files: snapshotFiles(repo, treeOrCommit) };
  }

  private async land(
    request: FeatureIntegrationRequest,
    commitSha: string,
    expectedIntegration: string,
    message: string,
    wiring: AggregatedWiringTask,
  ): Promise<string> {
    const repo = request.repoPath;
    const first = this.cas(request).advance({
      repo,
      ref: INTEGRATION_REF,
      newSha: commitSha,
      expectedOldSha: expectedIntegration,
      holder: request.holder,
      epoch: request.expectedEpoch,
    });
    if (first.ok) return commitSha;
    const actual = first.actualSha;
    const scan = this.scanner.scan({ repo, ours: actual, theirs: commitSha });
    let tree = scan.treeOid;
    if (!scan.clean) {
      const resolved = resolvePreflight({
        repo,
        report: scan,
        objectives: request.leaves.map((leaf) => ({ taskId: leaf.taskId, objective: leaf.objective })),
      });
      tree = replaceFiles(repo, scan.treeOid, resolved.files);
    }
    const merged = commitTree(repo, tree, [actual, commitSha], message);
    const report = await this.journey.evaluate({
      base: this.snapshots.read(repo, actual, "base"),
      feature: this.snapshots.read(repo, merged, "feature"),
      sealedChecks: request.sealedChecks,
      mounts: mountsOf([...wiring.mounts]),
      journeys: request.seamJourneys,
      viewportChecks: request.viewportChecks,
      auditFiles: [...snapshotFiles(repo, merged).entries()].map(([path, text]) => ({ path, text })),
      binder: this.binder,
    });
    if (!report.ok) {
      throw new IntegrationBlockedError(report.hint?.detail ?? "re-verification failed after integration moved");
    }
    const second = this.cas(request).advance({
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

  private casOrThrow(
    request: FeatureIntegrationRequest,
    ref: string,
    newSha: string,
    expected: string,
  ): void {
    const result = this.cas(request).advance({
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

  private transition(
    request: FeatureIntegrationRequest,
    to: "WIRED" | "JOURNEY_PASSED" | "QUEUED_FOR_MERGE" | "MERGED" | "DONE",
    evidence: FeatureDoneEvidenceInput | null = null,
  ): void {
    request.lifecycle.transition({
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
    flags: { merged: boolean; journey: boolean; audit: boolean; hasScreens: boolean },
  ): FeatureDoneEvidenceInput {
    const tasks: TaskEvidence[] = request.tasks.length > 0 ? [...request.tasks] : request.leaves.map((leaf) => ({
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
    };
  }
}

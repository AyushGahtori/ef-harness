import type {
  BaselineTestHealthReceipt,
  BaselineTestRecord,
  CommandReceipt,
  DetectedRepoScripts,
  ParsedTestCase,
} from "./types.js";
import type {
  BaselineTestHealthStorePort,
  BrownfieldL0RepoScannerPort,
  GitWorktreeInspectorPort,
  HarnessRunEnginePort,
  QuarantinedTestsStorePort,
  WorktreeSlotPoolPort,
} from "./ports.js";
import { BaselineHealthCache, buildBaselineCacheKey } from "./baseline-cache.js";
import { BrokenBuildEntryGate } from "./broken-build-entry-gate.js";
import { CharacterizationSafetyNetPlanner } from "./characterization-safety-net-planner.js";
import { checkWorktreeClean } from "./dirty-tree-check.js";
import { KnownFailingQuarantineStore } from "./known-failing-quarantine-store.js";
import { ThreeRunFlakeDetector } from "./three-run-flake-detector.js";
import { errorFingerprint, parseTestReporterOutput } from "./test-reporter-parser.js";

export interface BaselineTestHealthRunnerOptions {
  readonly worktrees: WorktreeSlotPoolPort;
  readonly harness: HarnessRunEnginePort;
  readonly git: GitWorktreeInspectorPort;
  readonly l0Scanner: BrownfieldL0RepoScannerPort;
  readonly healthStore: BaselineTestHealthStorePort;
  readonly quarantineStore: QuarantinedTestsStorePort;
  readonly targetedModules?: readonly string[];
  readonly moduleTestCoverage?: Map<string, number>;
}

export interface BaselineRunRequest {
  readonly repoRoot: string;
  readonly baselineCommitSha: string;
  readonly skipCache?: boolean;
}

export interface BaselineRunOutcome {
  readonly receipt: BaselineTestHealthReceipt;
  readonly fromCache: boolean;
  readonly buildGateBlocked: boolean;
}

/**
 * Runs typecheck/lint/build/test on an isolated worktree and records baseline health.
 */
export class BaselineTestHealthRunner {
  private readonly cache: BaselineHealthCache;
  private readonly quarantine: KnownFailingQuarantineStore;
  private readonly flakeDetector: ThreeRunFlakeDetector;
  private readonly buildGate: BrokenBuildEntryGate;
  private readonly safetyNet: CharacterizationSafetyNetPlanner;

  constructor(private readonly options: BaselineTestHealthRunnerOptions) {
    this.cache = new BaselineHealthCache(options.healthStore);
    this.quarantine = new KnownFailingQuarantineStore(options.quarantineStore);
    this.flakeDetector = new ThreeRunFlakeDetector();
    this.buildGate = new BrokenBuildEntryGate();
    this.safetyNet = new CharacterizationSafetyNetPlanner();
  }

  async run(request: BaselineRunRequest): Promise<BaselineRunOutcome> {
    const lockfileSha256 =
      (await this.options.git.hashFile(request.repoRoot, "pnpm-lock.yaml")) ??
      (await this.options.git.hashFile(request.repoRoot, "package-lock.json")) ??
      "no-lockfile";
    const cacheKey = buildBaselineCacheKey(request.baselineCommitSha, lockfileSha256);

    if (!request.skipCache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return { receipt: cached, fromCache: true, buildGateBlocked: cached.buildBlocked };
      }
    }

    const slot = await this.options.worktrees.checkoutIsolated(request.baselineCommitSha);
    const scripts = await this.options.l0Scanner.detectScripts(slot.rootPath);

    const preFlight = await this.runPreFlight(slot, scripts);
    const gate = this.buildGate.evaluate(preFlight);

    if (gate.blocked) {
      const receipt = await this.finalizeReceipt({
        request,
        slotId: slot.slotId,
        lockfileSha256,
        commands: preFlight,
        tests: [],
        buildBlocked: true,
        dirtyPaths: [],
        characterization: false,
        quarantineSummary: "Baseline build/typecheck failed before tests",
      });
      await this.cache.put(cacheKey, receipt);
      await this.options.worktrees.release(slot.slotId);
      return { receipt, fromCache: false, buildGateBlocked: true };
    }

    const testCommand = scripts.test;
    let testReceipt: CommandReceipt | null = null;
    let firstCases: ParsedTestCase[] = [];
    if (testCommand) {
      testReceipt = await this.runCommand(slot, "test", testCommand);
      firstCases = parseTestReporterOutput(testReceipt.reporterOutput ?? "").cases as ParsedTestCase[];
    }

    const flakeMap = new Map<string, BaselineTestRecord["classification"]>();
    const flakeDetails = await this.flakeDetector.classifyInitialFailures(firstCases, async (testIds) => {
      if (!testCommand) return [];
      const argv = [...testCommand, "--", ...testIds];
      const isolated = await this.options.harness.runInSandbox(slot, argv);
      return parseTestReporterOutput(isolated.stdout || isolated.stderr).cases as ParsedTestCase[];
    });
    for (const item of flakeDetails) {
      flakeMap.set(item.testId, item.classification);
    }

    const tests = this.mergeClassifications(firstCases, flakeMap);
    const dirty = await checkWorktreeClean(this.options.git, slot.rootPath);
    const dirtyPaths = [...dirty.untrackedPaths, ...dirty.modifiedPaths];

    const targeted = this.options.targetedModules ?? [];
    const coverage = this.options.moduleTestCoverage ?? new Map<string, number>();
    const needsChar = this.safetyNet.needsSafetyNet(scripts.testFileCount, targeted, coverage);

    const transparency = await this.quarantine.recordFromBaseline(tests, request.baselineCommitSha);

    const commands = [...preFlight, ...(testReceipt ? [testReceipt] : [])];
    const receipt = await this.finalizeReceipt({
      request,
      slotId: slot.slotId,
      lockfileSha256,
      commands,
      tests,
      buildBlocked: false,
      dirtyPaths,
      characterization: needsChar,
      quarantineSummary: transparency.summary,
    });

    await this.cache.put(cacheKey, receipt);
    await this.options.worktrees.release(slot.slotId);
    return { receipt, fromCache: false, buildGateBlocked: false };
  }

  getQuarantineStore(): KnownFailingQuarantineStore {
    return this.quarantine;
  }

  getSafetyNetPlanner(): CharacterizationSafetyNetPlanner {
    return this.safetyNet;
  }

  getBuildGate(): BrokenBuildEntryGate {
    return this.buildGate;
  }

  private async runPreFlight(slot: { slotId: string; rootPath: string }, scripts: DetectedRepoScripts): Promise<CommandReceipt[]> {
    const out: CommandReceipt[] = [];
    for (const commandId of ["typecheck", "build", "lint"] as const) {
      const argv = scripts[commandId];
      if (!argv) continue;
      out.push(await this.runCommand(slot, commandId, argv));
    }
    return out;
  }

  private async runCommand(
    slot: { slotId: string; rootPath: string },
    commandId: CommandReceipt["commandId"],
    argv: readonly string[],
  ): Promise<CommandReceipt> {
    const started = Date.now();
    const result = await this.options.harness.runInSandbox(slot, argv);
    return {
      commandId,
      argv: [...argv],
      exitCode: result.exitCode,
      durationMs: result.durationMs || Date.now() - started,
      reporterOutput: result.stdout || result.stderr || null,
    };
  }

  private mergeClassifications(
    cases: readonly ParsedTestCase[],
    flakeMap: Map<string, BaselineTestRecord["classification"]>,
  ): BaselineTestRecord[] {
    const byId = new Map<string, ParsedTestCase>();
    for (const row of cases) byId.set(row.testId, row);

    const records: BaselineTestRecord[] = [];
    for (const row of cases) {
      let classification: BaselineTestRecord["classification"] = "passing";
      if (row.status === "fail" || row.status === "error") {
        classification = flakeMap.get(row.testId) ?? "known_failing";
      } else if (row.status === "skip") {
        continue;
      }
      records.push({
        testId: row.testId,
        filePath: row.filePath,
        classification,
        passCount: classification === "passing" ? 1 : 0,
        runCount: classification === "passing" ? 1 : 3,
        errorFingerprint: errorFingerprint(row.errorMessage),
        durationMs: row.durationMs,
      });
    }

    for (const [testId, classification] of flakeMap) {
      if (!byId.has(testId) && classification === "baseline_flaky") {
        records.push({
          testId,
          filePath: null,
          classification,
          passCount: 2,
          runCount: 3,
          errorFingerprint: null,
          durationMs: null,
        });
      }
    }
    return records;
  }

  private async finalizeReceipt(input: {
    request: BaselineRunRequest;
    slotId: string;
    lockfileSha256: string;
    commands: readonly CommandReceipt[];
    tests: readonly BaselineTestRecord[];
    buildBlocked: boolean;
    dirtyPaths: readonly string[];
    characterization: boolean;
    quarantineSummary: string;
  }): Promise<BaselineTestHealthReceipt> {
    const passingCount = input.tests.filter((t) => t.classification === "passing").length;
    const knownFailingCount = input.tests.filter((t) => t.classification === "known_failing").length;
    const baselineFlakyCount = input.tests.filter((t) => t.classification === "baseline_flaky").length;
    return {
      baselineCommitSha: input.request.baselineCommitSha,
      lockfileSha256: input.lockfileSha256,
      worktreeSlotId: input.slotId,
      capturedAt: new Date().toISOString(),
      commands: input.commands,
      tests: input.tests,
      passingCount,
      knownFailingCount,
      baselineFlakyCount,
      buildBlocked: input.buildBlocked,
      dirtyTreePaths: input.dirtyPaths,
      characterizationPhaseSuggested: input.characterization,
      quarantineSummary: input.quarantineSummary,
    };
  }
}
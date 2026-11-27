import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCompletenessGateRunner } from "@ef-harness/completeness-gate";
import { CleanVerifierRunner } from "../../src/runner/clean-verifier-runner.js";
import { bindCompletenessGate, verifierLeafAudit } from "../../src/runner/completeness-gate-bind.js";
import { CleanCheckoutSeparationError, MissingRequiredChecksError, VerifierIntegrityError } from "../../src/runner/errors.js";
import { canonicalJson, sha256Hex } from "../../src/runner/hash.js";
import { sealExpectationDocument, secretLeaves } from "../../src/runner/materialize.js";
import type {
  AttemptLeaseView,
  CasBlobStorePort,
  CasRetention,
  CheckResultInsert,
  CheckResultsPort,
  CompletenessGateRunnerPort,
  HarnessRunEnginePort,
  PinnedRunRequest,
  PinnedRunResult,
  ProvisionedEnv,
  RequiredCheckRef,
  SandboxTier,
  SurfaceCollectInput,
  SurfaceVerifierAdapter,
  TestEnvOrchestratorPort,
  WorktreeSlotManagerPort,
} from "../../src/runner/ports.js";
import type { CheckSurface, CheckVisibility, DispatchFingerprint, VerifyCandidateRequest } from "../../src/runner/types.js";
import { CLEAN_VERIFIER_REPLAY_CLOCK } from "../../src/runner/types.js";

const COMMIT = "abc123abc123abc123abc123abc123abc123abcd";
const PINNED_COMMAND = ["node", "pinned-verifier.mjs"] as const;
const LOCK_DIGEST = "lock-digest-1";
const ARTIFACT = "artifact-digest-1";

interface CheckFixture {
  readonly checkId: string;
  readonly checkVersion: number;
  readonly requirementId: string;
  readonly visibility: CheckVisibility;
  readonly ruleId: string | null;
  readonly surface: CheckSurface;
  readonly flaky: boolean;
  readonly input: unknown;
  readonly expected: unknown;
  readonly entry?: string;
}

interface FixtureOptions {
  readonly checks?: readonly CheckFixture[];
  readonly inScopeRuleIds?: readonly string[];
  readonly workerLocalCheckIds?: readonly string[];
  readonly elapsedMs?: number;
  readonly lease?: Partial<AttemptLeaseView>;
  readonly auditPassed?: boolean;
  readonly gatePort?: CompletenessGateRunnerPort;
  readonly slotMode?: "clean" | "worker-path" | "wrong-commit";
  readonly tamper?: "runner-fingerprint" | null;
  readonly binders?: readonly { readonly path: string; readonly bytes: Uint8Array }[];
  readonly handler?: (request: PinnedRunRequest, call: number) => PinnedRunResult;
}

interface Fixture {
  readonly root: string;
  readonly workerPath: string;
  readonly hostRoot: string;
  readonly runner: CleanVerifierRunner;
  readonly request: VerifyCandidateRequest;
  readonly engine: MemoryEngine;
  readonly slots: MemorySlots;
  readonly envs: MemoryEnvironments;
  readonly gate: MemoryGate;
  readonly state: MemoryState;
  readonly cas: MemoryCas;
  readonly answers: ReadonlyMap<string, unknown>;
  cleanup(): void;
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

const DEFAULT_CHECK: CheckFixture = {
  checkId: "AC-31",
  checkVersion: 2,
  requirementId: "R-31",
  visibility: "visible",
  ruleId: null,
  surface: "unit",
  flaky: false,
  input: { dishId: "s", label: "Soup", quantity: 2 },
  expected: { orderedRows: [{ label: "Soup", quantity: 2 }] },
};

function createFixture(options: FixtureOptions = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "ef-verifier-test-"));
  const workerPath = join(root, "worker");
  const hostRoot = join(root, "host");
  mkdirSync(workerPath, { recursive: true });
  mkdirSync(hostRoot, { recursive: true });
  writeFileSync(join(workerPath, "DIRTY.txt"), "worker-dirty");
  const fixtureCleanup = (): void => {
    rmSync(root, { recursive: true, force: true });
  };
  cleanups.push(fixtureCleanup);

  const checks = options.checks ?? [DEFAULT_CHECK];
  const answers = new Map(checks.map((check) => [check.checkId, check.expected]));
  const heldBackTokens: string[] = [];
  for (const check of checks) {
    if (check.visibility !== "held_back") continue;
    secretLeaves(check.expected, heldBackTokens);
  }

  const cas = new MemoryCas();
  const runnerBytes = Buffer.from("pinned-runner-bytes");
  const configBytes = Buffer.from('{"timeoutMs":1000}');
  const runnerDigest = cas.seed(runnerBytes);
  const configDigest = cas.seed(configBytes);
  const binders = [];
  for (const binder of options.binders ?? []) {
    binders.push({ path: binder.path, digest: cas.seed(binder.bytes) });
  }
  const expectationBytes = sealExpectationDocument({
    checks: checks.map((check) => ({
      checkId: check.checkId,
      checkVersion: check.checkVersion,
      input: check.input,
      expected: check.expected,
      ...(check.entry ? { entry: check.entry } : {}),
    })),
    binders,
  });
  const expectationDigest = cas.seed(expectationBytes);
  const dispatch: DispatchFingerprint = {
    runnerSha256: options.tamper === "runner-fingerprint" ? "0".repeat(64) : sha256Hex(runnerBytes),
    commandSha256: sha256Hex(canonicalJson(PINNED_COMMAND)),
    configSha256: sha256Hex(configBytes),
    expectationsSha256: sha256Hex(expectationBytes),
    pinnedCommand: PINNED_COMMAND,
    runnerDigest,
    configDigest,
    expectationDigest,
  };

  const state = new MemoryState(
    checks.map((check) => ({
      checkId: check.checkId,
      checkVersion: check.checkVersion,
      requirementId: check.requirementId,
      visibility: check.visibility,
      ruleId: check.ruleId,
      surface: check.surface,
      flaky: check.flaky,
    })),
    {
      attemptId: "attempt-1",
      ttlMs: 180_000,
      submissionPending: true,
      epoch: 4,
      state: "CLEAN_VERIFY",
      ...options.lease,
    },
  );
  const slots = new MemorySlots(root, workerPath, options.slotMode ?? "clean");
  const envs = new MemoryEnvironments();
  const engine = new MemoryEngine(workerPath, heldBackTokens, options.handler ?? ((request) => passResult(request, answers)));
  const gate = new MemoryGate(options.auditPassed ?? true);
  const runner = new CleanVerifierRunner({
    slots,
    environments: envs,
    engine,
    gate: options.gatePort ?? gate,
    cas,
    state,
    hostTempRoot: hostRoot,
    now: () => 1_700_000_000_000,
  });
  const request: VerifyCandidateRequest = {
    taskId: "task-1",
    attemptId: "attempt-1",
    commitSha: COMMIT,
    artifactDigest: ARTIFACT,
    sandboxTier: 1,
    workerWorktreePath: workerPath,
    workerWorktreeId: "worker-slot",
    dependencyLockDigest: LOCK_DIGEST,
    dispatch,
    elapsedMs: options.elapsedMs ?? 0,
    workerLocalCheckIds: options.workerLocalCheckIds ?? checks.map((check) => check.checkId),
    inScopeRuleIds: options.inScopeRuleIds ?? [],
  };
  return {
    root,
    workerPath,
    hostRoot,
    runner,
    request,
    engine,
    slots,
    envs,
    gate,
    state,
    cas,
    answers,
    cleanup: fixtureCleanup,
  };
}

function passResult(request: PinnedRunRequest, answers: ReadonlyMap<string, unknown>): PinnedRunResult {
  return {
    exitCode: 0,
    reporterBody: JSON.stringify({
      format: "ef-oracle@1",
      cases: request.inputs.map((input) => ({
        checkId: input.checkId,
        status: "pass",
        observed: answers.get(input.checkId) ?? null,
      })),
    }),
    trace: Buffer.from(`trace:${request.inputs.map((input) => input.checkId).join(",")}`),
    log: Buffer.from("log"),
  };
}

function treeHas(dir: string, needle: string): boolean {
  if (!existsSync(dir)) return false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (treeHas(full, needle)) return true;
      continue;
    }
    if (readFileSync(full, "utf8").includes(needle)) return true;
  }
  return false;
}

class MemoryCas implements CasBlobStorePort {
  readonly puts: { digest: string; retention: CasRetention; label: string }[] = [];
  private readonly blobs = new Map<string, Uint8Array>();

  seed(bytes: Uint8Array): string {
    const digest = sha256Hex(bytes);
    this.blobs.set(digest, bytes);
    return digest;
  }

  async get(digest: string): Promise<Uint8Array | null> {
    return this.blobs.get(digest) ?? null;
  }

  async put(bytes: Uint8Array, meta: { readonly retention: CasRetention; readonly label: string }): Promise<string> {
    const digest = sha256Hex(bytes);
    this.blobs.set(digest, bytes);
    this.puts.push({ digest, retention: meta.retention, label: meta.label });
    return digest;
  }
}

class MemoryState implements CheckResultsPort {
  readonly rows: CheckResultInsert[] = [];

  constructor(
    private readonly required: readonly RequiredCheckRef[],
    private readonly leaseView: AttemptLeaseView,
  ) {}

  async listRequiredChecks(): Promise<readonly RequiredCheckRef[]> {
    return this.required;
  }

  async readAttemptLease(): Promise<AttemptLeaseView> {
    return this.leaseView;
  }

  async insertCheckResult(row: CheckResultInsert): Promise<void> {
    const key = `${row.checkId}:${row.attempt}:${row.checkVersion}`;
    if (this.rows.some((existing) => `${existing.checkId}:${existing.attempt}:${existing.checkVersion}` === key)) {
      throw new Error(`duplicate check result ${key}`);
    }
    this.rows.push(row);
  }
}

class MemorySlots implements WorktreeSlotManagerPort {
  readonly attached: string[] = [];
  readonly released: string[] = [];
  readonly checkouts: { commitSha: string; exclude: string; path: string }[] = [];

  constructor(
    private readonly root: string,
    private readonly workerPath: string,
    private readonly mode: "clean" | "worker-path" | "wrong-commit",
  ) {}

  async checkoutImmutable(request: {
    readonly commitSha: string;
    readonly kind: "verifier";
    readonly excludeWorktreePath: string;
    readonly excludeWorktreeId: string;
  }): Promise<{ slotId: string; commitSha: string; worktreePath: string; kind: "verifier" }> {
    const path = this.mode === "worker-path" ? this.workerPath : join(this.root, `slot-${this.checkouts.length + 1}`);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "package.json"), JSON.stringify({ scripts: { test: 'echo "all passed"' } }));
    const slot = {
      slotId: `slot-${this.checkouts.length + 1}`,
      commitSha: this.mode === "wrong-commit" ? "b".repeat(40) : request.commitSha,
      worktreePath: path,
      kind: "verifier" as const,
    };
    this.checkouts.push({ commitSha: request.commitSha, exclude: request.excludeWorktreePath, path: slot.worktreePath });
    return slot;
  }

  async attachLockedDependencies(
    _slot: { readonly slotId: string },
    lockDigest: string,
  ): Promise<void> {
    this.attached.push(lockDigest);
  }

  async release(slot: { readonly slotId: string }): Promise<void> {
    this.released.push(slot.slotId);
  }
}

class MemoryEnv implements ProvisionedEnv {
  destroyed = false;

  constructor(
    readonly id: string,
    readonly tier: SandboxTier,
    readonly isolatedFromAttemptId: string,
  ) {}

  vars(): Readonly<Record<string, string>> {
    return { APP_URL: `http://${this.id}.localhost` };
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
  }
}

class MemoryEnvironments implements TestEnvOrchestratorPort {
  readonly requests: {
    replay: boolean;
    isolatedFromAttemptId: string;
    tier: SandboxTier;
    clock?: { fixedIso: string; seed: string };
  }[] = [];
  readonly provisioned: MemoryEnv[] = [];

  async provision(request: {
    readonly tier: SandboxTier;
    readonly isolatedFromAttemptId: string;
    readonly commitSha: string;
    readonly replay: boolean;
    readonly clock?: { readonly fixedIso: string; readonly seed: string };
  }): Promise<ProvisionedEnv> {
    const env = new MemoryEnv(`env-${this.provisioned.length + 1}`, request.tier, request.isolatedFromAttemptId);
    this.provisioned.push(env);
    this.requests.push({
      replay: request.replay,
      isolatedFromAttemptId: request.isolatedFromAttemptId,
      tier: request.tier,
      ...(request.clock ? { clock: request.clock } : {}),
    });
    return env;
  }
}

class MemoryEngine implements HarnessRunEnginePort {
  readonly calls: PinnedRunRequest[] = [];

  constructor(
    private readonly workerPath: string,
    private readonly heldBackTokens: readonly string[],
    private readonly handler: (request: PinnedRunRequest, call: number) => PinnedRunResult,
  ) {}

  async runPinned(request: PinnedRunRequest): Promise<PinnedRunResult> {
    this.calls.push(request);
    expect(request.cwd).not.toBe(this.workerPath);
    expect(request.command).toEqual([...PINNED_COMMAND]);
    expect(request.hostChannel).toBe("host-owned");
    const serialized = JSON.stringify(request.inputs);
    for (const token of this.heldBackTokens) {
      expect(serialized).not.toContain(token);
      expect(treeHas(request.cwd, token)).toBe(false);
    }
    return this.handler(request, this.calls.length);
  }
}

class MemoryGate implements CompletenessGateRunnerPort {
  readonly calls: { checkoutPath: string; commitSha: string }[] = [];

  constructor(private readonly passed: boolean) {}

  async runLeafStaticAudit(input: {
    readonly taskId: string;
    readonly attemptId: string;
    readonly commitSha: string;
    readonly checkoutPath: string;
  }): Promise<{ passed: boolean; findings: readonly string[]; fingerprint: string }> {
    this.calls.push({ checkoutPath: input.checkoutPath, commitSha: input.commitSha });
    return {
      passed: this.passed,
      findings: this.passed ? [] : ["hard-coded list"],
      fingerprint: "audit-fp",
    };
  }
}

describe("CleanVerifierRunner", () => {
  it("checks out the immutable commit in a verifier slot and ignores the worker worktree", async () => {
    const fx = createFixture();
    const outcome = await fx.runner.verifyCandidate(fx.request);
    expect(outcome.accepted).toBe(true);
    expect(outcome.ranCandidate).toBe(true);
    expect(outcome.cleanCheckoutPath).not.toBe(fx.workerPath);
    expect(fx.engine.calls[0]?.cwd).toBe(outcome.cleanCheckoutPath);
    expect(fx.engine.calls[0]?.command).toEqual([...PINNED_COMMAND]);
    expect(fx.slots.attached).toEqual([LOCK_DIGEST]);
    expect(fx.slots.checkouts[0]?.commitSha).toBe(COMMIT);
    expect(fx.slots.checkouts[0]?.exclude).toBe(fx.workerPath);
    expect(fx.gate.calls[0]?.checkoutPath).toBe(outcome.cleanCheckoutPath);
    expect(fx.gate.calls[0]?.commitSha).toBe(COMMIT);
    expect(fx.envs.requests[0]?.isolatedFromAttemptId).toBe("attempt-1");
    expect(outcome.ignoredCandidateTestScript).toBe('echo "all passed"');
    expect(outcome.usedPinnedCommand).toEqual([...PINNED_COMMAND]);
    expect(fx.state.rows.map((row) => row.status)).toEqual(["pass"]);
    expect(fx.cas.puts.every((put) => put.retention === "evidence")).toBe(true);
    const receipt = JSON.parse(fx.state.rows[0]?.receipt ?? "{}") as { sandboxTier: number; commitSha: string; checkVersions: Record<string, number> };
    expect(receipt).toMatchObject({
      sandboxTier: 1,
      commitSha: COMMIT,
      checkVersions: { "AC-31": 2 },
      stability: "stable",
    });
    expect(fx.envs.provisioned.every((env) => env.destroyed)).toBe(true);
    expect(fx.slots.released).toEqual(["slot-1"]);
    expect(readFileSync(join(fx.workerPath, "DIRTY.txt"), "utf8")).toBe("worker-dirty");
  });

  it("refuses a slot that points at the worker worktree", async () => {
    const fx = createFixture({ slotMode: "worker-path" });
    await expect(fx.runner.verifyCandidate(fx.request)).rejects.toBeInstanceOf(CleanCheckoutSeparationError);
    expect(fx.engine.calls).toHaveLength(0);
    expect(fx.slots.released).toEqual(["slot-1"]);
  });

  it("rejects a checkout whose commit does not match the candidate", async () => {
    const fx = createFixture({ slotMode: "wrong-commit" });
    await expect(fx.runner.verifyCandidate(fx.request)).rejects.toBeInstanceOf(VerifierIntegrityError);
    expect(fx.engine.calls).toHaveLength(0);
    expect(fx.slots.released).toEqual(["slot-1"]);
  });

  it("rejects a tampered runner fingerprint before the candidate runs", async () => {
    const fx = createFixture({ tamper: "runner-fingerprint" });
    await expect(fx.runner.verifyCandidate(fx.request)).rejects.toBeInstanceOf(VerifierIntegrityError);
    expect(fx.engine.calls).toHaveLength(0);
    expect(fx.envs.provisioned).toHaveLength(0);
    expect(fx.slots.released).toEqual(["slot-1"]);
    expect(readdirSync(fx.hostRoot)).toEqual([]);
  });

  it("rejects a binder path that escapes the clean checkout", async () => {
    const fx = createFixture({
      binders: [{ path: "../outside.txt", bytes: Buffer.from("binder") }],
    });
    await expect(fx.runner.verifyCandidate(fx.request)).rejects.toBeInstanceOf(VerifierIntegrityError);
    expect(fx.engine.calls).toHaveLength(0);
    expect(existsSync(join(fx.root, "outside.txt"))).toBe(false);
  });

  it("fails exit 0 with zero collected required ids", async () => {
    const fx = createFixture({
      handler: () => ({
        exitCode: 0,
        reporterBody: '{"ok":true,"message":"all passed"}',
        trace: Buffer.from("empty"),
        log: Buffer.from("empty"),
      }),
    });
    try {
      await fx.runner.verifyCandidate(fx.request);
      expect.fail("expected MissingRequiredChecksError");
    } catch (error) {
      expect(error).toBeInstanceOf(MissingRequiredChecksError);
      if (!(error instanceof MissingRequiredChecksError)) return;
      expect(error.missingIds).toEqual(["AC-31"]);
      expect(error.message).toBe("MissingRequiredChecksError(AC-31)");
      expect(error.outcome.candidateExitCode).toBe(0);
    }
    expect(fx.state.rows[0]?.status).toBe("missing");
    expect(fx.envs.provisioned[0]?.destroyed).toBe(true);
    expect(readdirSync(fx.hostRoot)).toEqual([]);
  });

  it("rejects a skipped required check", async () => {
    const fx = createFixture({
      handler: () => ({
        exitCode: 0,
        reporterBody: JSON.stringify({
          format: "ef-oracle@1",
          cases: [{ checkId: "AC-31", status: "skip" }],
        }),
        trace: Buffer.from("skip"),
        log: Buffer.from("skip"),
      }),
    });
    const outcome = await fx.runner.verifyCandidate(fx.request);
    expect(outcome.accepted).toBe(false);
    expect(outcome.checks[0]).toMatchObject({ checkId: "AC-31", status: "skip", stability: "stable" });
    expect(fx.state.rows[0]?.status).toBe("skip");
    expect(fx.cas.puts.every((put) => put.retention === "diagnostic")).toBe(true);
  });

  it("overrides a reporter pass when the host comparison disagrees", async () => {
    const fx = createFixture({
      handler: () => ({
        exitCode: 0,
        reporterBody: JSON.stringify({
          format: "ef-oracle@1",
          cases: [{ checkId: "AC-31", status: "pass", observed: { orderedRows: [{ label: "Soup", quantity: 1 }] } }],
        }),
        trace: Buffer.from("forged"),
        log: Buffer.from("forged"),
      }),
    });
    const outcome = await fx.runner.verifyCandidate(fx.request);
    expect(outcome.accepted).toBe(false);
    expect(outcome.attribution).toBe("implementation");
    expect(outcome.checks[0]?.status).toBe("fail");
    expect(outcome.candidateExitCode).toBe(0);
  });

  it("keeps held-back expectations out of the worktree, sandbox, receipts, and worker messages", async () => {
    const secret = "HIDDEN_EXPECTATION_9f3a";
    const inputMarker = "HIDDEN_INPUT_7c2e";
    const fx = createFixture({
      checks: [
        {
          ...DEFAULT_CHECK,
          visibility: "held_back",
          ruleId: "X-03",
          surface: "unit",
          input: { marker: inputMarker },
          expected: { token: secret },
        },
      ],
      handler: () => ({
        exitCode: 1,
        reporterBody: JSON.stringify({
          format: "ef-oracle@1",
          cases: [{ checkId: "AC-31", status: "fail", observed: { token: "observed-wrong" } }],
        }),
        trace: Buffer.from("hidden-trace"),
        log: Buffer.from("hidden-log"),
      }),
    });
    const outcome = await fx.runner.verifyCandidate(fx.request);
    expect(JSON.stringify(fx.engine.calls[0]?.inputs)).toContain(inputMarker);
    expect(JSON.stringify(fx.engine.calls[0]?.inputs)).not.toContain(secret);
    expect(JSON.stringify(outcome.workerFacing)).not.toContain(secret);
    expect(JSON.stringify(outcome.workerFacing)).not.toContain(inputMarker);
    expect(outcome.sealedHintLadder[0]).toMatchObject({
      checkId: "AC-31",
      ruleId: "X-03",
      input: { marker: inputMarker },
      expected: { token: secret },
      observed: { token: "observed-wrong" },
    });
    expect(outcome.burnsHiddenLadder).toBe(true);
    expect(outcome.checks[0]?.route).toBe("hint_ladder");
    expect(fx.state.rows.map((row) => row.receipt).join("\n")).not.toContain(secret);
    expect(treeHas(fx.root, secret)).toBe(false);
    expect(fx.envs.provisioned[0]?.destroyed).toBe(true);
  });

  it("marks a disagreeing clean replay unstable and leaves the requirement unresolved", async () => {
    const fx = createFixture({
      checks: [{ ...DEFAULT_CHECK, surface: "browser", expected: { value: 1 } }],
      handler: (_request, call) => ({
        exitCode: call === 1 ? 1 : 0,
        reporterBody: JSON.stringify({
          format: "ef-oracle@1",
          cases: [{ checkId: "AC-31", status: call === 1 ? "fail" : "pass", observed: { value: call === 1 ? 0 : 1 } }],
        }),
        trace: Buffer.from(`trace-${call}`),
        log: Buffer.from(`log-${call}`),
      }),
    });
    const outcome = await fx.runner.verifyCandidate(fx.request);
    expect(outcome.accepted).toBe(false);
    expect(outcome.attribution).toBe("flaky_test");
    expect(outcome.affectsWorkerQualityScore).toBe(false);
    expect(outcome.requirementResolution).toBe("unresolved");
    expect(outcome.checks[0]).toMatchObject({ status: "error", stability: "unstable" });
    expect(outcome.checks[0]?.runs).toHaveLength(2);
    expect(fx.envs.requests.map((item) => item.replay)).toEqual([false, true]);
    expect(fx.envs.requests[1]?.clock).toEqual(CLEAN_VERIFIER_REPLAY_CLOCK);
    expect(fx.envs.requests[0]?.clock).toBeUndefined();
    expect(fx.envs.provisioned.map((env) => env.id)).toEqual(["env-1", "env-2"]);
    expect(fx.envs.provisioned.every((env) => env.destroyed)).toBe(true);
    expect(fx.state.rows[0]?.receipt).toContain('"stability":"unstable"');
    expect(outcome.sealedHintLadder).toEqual([]);
  });

  it("keeps an agreeing pair of failures as an implementation defect", async () => {
    const fx = createFixture({
      checks: [{ ...DEFAULT_CHECK, surface: "time", expected: { value: 1 } }],
      handler: () => ({
        exitCode: 1,
        reporterBody: JSON.stringify({
          format: "ef-oracle@1",
          cases: [{ checkId: "AC-31", status: "fail", observed: { value: 0 } }],
        }),
        trace: Buffer.from("stable-fail"),
        log: Buffer.from("stable-fail"),
      }),
    });
    const outcome = await fx.runner.verifyCandidate(fx.request);
    expect(outcome.attribution).toBe("implementation");
    expect(outcome.requirementResolution).toBe("failing");
    expect(outcome.affectsWorkerQualityScore).toBe(true);
    expect(outcome.checks[0]).toMatchObject({ status: "fail", stability: "stable" });
    expect(outcome.checks[0]?.runs).toHaveLength(2);
  });

  it("attributes a postgres crash to the environment and shreds host files", async () => {
    const secret = "HIDDEN_EXPECTATION_crash";
    const fx = createFixture({
      checks: [
        {
          ...DEFAULT_CHECK,
          visibility: "held_back",
          ruleId: "X-03",
          expected: { token: secret },
          input: { zone: "Europe/Berlin" },
        },
      ],
      handler: () => ({
        exitCode: 1,
        reporterBody: "",
        trace: Buffer.from("postgres terminated"),
        log: Buffer.from("backend crash"),
        signals: { environmentFailure: "postgres_crash" },
      }),
    });
    const outcome = await fx.runner.verifyCandidate(fx.request);
    expect(outcome.accepted).toBe(false);
    expect(outcome.attribution).toBe("environment");
    expect(outcome.affectsWorkerQualityScore).toBe(false);
    expect(outcome.holdForEnvRecovery).toBe(true);
    expect(outcome.requirementResolution).toBe("unresolved");
    expect(outcome.checks[0]).toMatchObject({ status: "error", attribution: "environment" });
    expect(JSON.stringify(outcome.workerFacing)).not.toContain(secret);
    expect(fx.envs.provisioned[0]?.destroyed).toBe(true);
    expect(treeHas(fx.root, secret)).toBe(false);
    expect(readdirSync(fx.hostRoot)).toEqual([]);
    expect(fx.cas.puts.every((put) => put.retention === "diagnostic")).toBe(true);
  });

  it("runs in-scope X-03 even when the worker's local run omitted it", async () => {
    const fx = createFixture({
      checks: [
        DEFAULT_CHECK,
        {
          checkId: "X-03",
          checkVersion: 1,
          requirementId: "R-time",
          visibility: "held_back",
          ruleId: "X-03",
          surface: "time",
          flaky: false,
          input: { zone: "Europe/Berlin", at: "10:45:00" },
          expected: { stored: "utc" },
        },
      ],
      inScopeRuleIds: ["X-03"],
      workerLocalCheckIds: ["AC-31"],
    });
    const outcome = await fx.runner.verifyCandidate(fx.request);
    expect(outcome.accepted).toBe(true);
    expect(outcome.ignoredWorkerLocalCheckIds).toEqual(["AC-31"]);
    expect(fx.engine.calls[0]?.inputs.map((input) => input.checkId)).toEqual(["AC-31", "X-03"]);
    expect(fx.state.rows.map((row) => row.checkId)).toEqual(["AC-31", "X-03"]);
  });

  it("refuses to pass when an in-scope cross-cutting rule has no required check", async () => {
    const fx = createFixture({ inScopeRuleIds: ["X-03"] });
    await expect(fx.runner.verifyCandidate(fx.request)).rejects.toBeInstanceOf(VerifierIntegrityError);
    expect(fx.engine.calls).toHaveLength(0);
  });

  it("protects the attempt lease while submission_pending is set", async () => {
    const fx = createFixture({ elapsedMs: 4 * 60 * 1000, lease: { ttlMs: 3 * 60 * 1000, submissionPending: true } });
    const outcome = await fx.runner.verifyCandidate(fx.request);
    expect(outcome.accepted).toBe(true);
    expect(outcome.leaseProtected).toBe(true);
    expect(fx.engine.calls).toHaveLength(1);
  });

  it("does not run when the lease expired before submission was pending", async () => {
    const fx = createFixture({ elapsedMs: 4 * 60 * 1000, lease: { ttlMs: 3 * 60 * 1000, submissionPending: false } });
    const outcome = await fx.runner.verifyCandidate(fx.request);
    expect(outcome.accepted).toBe(false);
    expect(outcome.ranCandidate).toBe(false);
    expect(outcome.requirementResolution).toBe("not_run");
    expect(fx.engine.calls).toHaveLength(0);
    expect(fx.slots.checkouts).toHaveLength(0);
  });

  it("does not execute the candidate when the static audit fails", async () => {
    const fx = createFixture({ auditPassed: false });
    const outcome = await fx.runner.verifyCandidate(fx.request);
    expect(outcome.accepted).toBe(false);
    expect(outcome.staticAuditPassed).toBe(false);
    expect(outcome.ranCandidate).toBe(false);
    expect(outcome.workerFacing.messages).toContain("hard-coded list");
    expect(fx.engine.calls).toHaveLength(0);
    expect(fx.envs.provisioned).toHaveLength(0);
  });

  it("runs CompletenessGateRunner on the clean checkout and ignores the worker slot", async () => {
    const seen: string[] = [];
    const gate = bindCompletenessGate(createCompletenessGateRunner(), (input) => {
      seen.push(input.checkoutPath);
      return verifierLeafAudit({
        taskId: input.taskId,
        candidateRef: input.commitSha,
        files: [
          {
            path: "src/kitchen/undef.ts",
            status: "added",
            beforeText: "",
            afterText: "export const undefBody = () => undefined;\n",
          },
        ],
        produces: [{ kind: "function", name: "undefBody" }],
        entryPoints: ["src/kitchen/undef.ts"],
      });
    });
    const fx = createFixture({ gatePort: gate });
    const outcome = await fx.runner.verifyCandidate(fx.request);
    expect(seen).toEqual([outcome.cleanCheckoutPath]);
    expect(outcome.cleanCheckoutPath).not.toBe(fx.workerPath);
    expect(readFileSync(join(fx.workerPath, "DIRTY.txt"), "utf8")).toBe("worker-dirty");
    expect(existsSync(join(outcome.cleanCheckoutPath ?? "", "DIRTY.txt"))).toBe(false);
    expect(outcome.staticAuditPassed).toBe(false);
    expect(outcome.ranCandidate).toBe(false);
    expect(outcome.accepted).toBe(false);
    expect(fx.engine.calls).toHaveLength(0);
    expect(outcome.workerFacing.messages.some((message) => message.includes("ast.stub"))).toBe(true);
  });

  it("lets a surface adapter collect observations without editing the runner", async () => {
    const browserExpected = "BROWSER_EXPECT_11";
    const fx = createFixture({
      checks: [
        DEFAULT_CHECK,
        {
          checkId: "AC-UI",
          checkVersion: 1,
          requirementId: "R-UI",
          visibility: "visible",
          ruleId: null,
          surface: "browser",
          flaky: false,
          input: { control: "Print" },
          expected: { rows: [browserExpected] },
        },
      ],
    });
    const seen: SurfaceCollectInput[] = [];
    const adapter: SurfaceVerifierAdapter = {
      id: "ui-playwright",
      supports: (check) => check.surface === "browser",
      async collect(input) {
        seen.push(input);
        return input.checks.map((check) => ({
          checkId: check.checkId,
          observed: fx.answers.get(check.checkId) ?? null,
          hasObserved: true,
          reporterStatus: "pass" as const,
          signals: null,
          trace: Buffer.from("ui-trace"),
          log: Buffer.from("ui-log"),
        }));
      },
    };
    fx.runner.registerSurfaceVerifier(adapter);
    const outcome = await fx.runner.verifyCandidate(fx.request);
    expect(outcome.accepted).toBe(true);
    expect(fx.engine.calls[0]?.inputs.map((input) => input.checkId)).toEqual(["AC-31"]);
    expect(seen[0]?.checks.map((check) => check.checkId)).toEqual(["AC-UI"]);
    expect(JSON.stringify(seen[0]?.checks)).not.toContain(browserExpected);
    expect(fx.state.rows.map((row) => row.checkId).sort()).toEqual(["AC-31", "AC-UI"]);
  });

  it("returns a plain contract mismatch without burning the hidden ladder", async () => {
    const fx = createFixture({
      handler: () => ({
        exitCode: 1,
        reporterBody: JSON.stringify({
          format: "ef-oracle@1",
          cases: [{ checkId: "AC-31", status: "fail" }],
        }),
        trace: Buffer.from("ui"),
        log: Buffer.from("ui"),
        signals: { contractMismatch: true, plainMessage: "No button named 'Print' on /kitchen" },
      }),
    });
    const outcome = await fx.runner.verifyCandidate(fx.request);
    expect(outcome.attribution).toBe("contract_mismatch");
    expect(outcome.burnsHiddenLadder).toBe(false);
    expect(outcome.sealedHintLadder).toEqual([]);
    expect(outcome.workerFacing.summary).toBe("No button named 'Print' on /kitchen");
    expect(outcome.checks[0]?.route).toBe("plain_message");
  });

  it("parses Vitest JSON from the pinned runner", async () => {
    const fx = createFixture({
      handler: () => ({
        exitCode: 0,
        reporterBody: JSON.stringify({
          testResults: [
            {
              assertionResults: [
                {
                  fullName: "[AC-31] maps soup",
                  status: "passed",
                  meta: { checkId: "AC-31" },
                  observed: { orderedRows: [{ label: "Soup", quantity: 2 }] },
                },
              ],
            },
          ],
        }),
        trace: Buffer.from("vitest"),
        log: Buffer.from("vitest"),
      }),
    });
    const outcome = await fx.runner.verifyCandidate(fx.request);
    expect(outcome.accepted).toBe(true);
    expect(fx.runner.parseCollectedCaseIds('{"testResults":[]}').format).toBe("vitest");
  });
});

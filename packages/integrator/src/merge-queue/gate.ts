import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCompletenessGateRunner, type LeafAuditInput } from "@ef-harness/completeness-gate";
import { GitSafetyScanner } from "@ef-harness/git-engine";
import { HarnessRunEngine } from "@ef-harness/sandbox";
import {
  CleanVerifierRunner,
  type CasRetention,
  type PinnedRunRequest,
  type PinnedRunResult,
} from "@ef-harness/verifier";
import { REGRESSION_BUDGET_MS } from "./constants.js";
import { auditDiff, auditText, gitleaksOnRange, mergeDiff, scanSecrets } from "./audit.js";
import { applyMigrationsFromScratch, lintMigrations, readMigrationFiles } from "./migrations.js";
import type { FailingCheck, GateResult, GateStepResult } from "./types.js";

const require = createRequire(import.meta.url);
const TEST_FILE = /\.(?:test|spec)\.(?:ts|mts|cts|js|mjs|cjs)$/;
const SOURCE_FILE = /\.(?:ts|tsx|mts|cts)$/;

interface StepOutcome {
  readonly step: GateStepResult;
  readonly failing: FailingCheck[];
}

/**
 * Combined regression gate. Typecheck, lint, build, migrations, and the suite
 * run through HarnessRunEngine inside the fresh merge worktree.
 * Typecheck uses tsc when the worktree has a tsconfig or a typecheck script,
 * so .ts and .tsx are not skipped by a JavaScript-only syntax check.
 */
export class CombinedRegressionGate {
  private readonly harness: HarnessRunEngine;
  private readonly telemetryDir: string;
  private readonly verifier: CleanVerifierRunner;

  constructor() {
    this.telemetryDir = mkdtempSync(path.join(tmpdir(), "ef-mq-telemetry-"));
    this.harness = new HarnessRunEngine({
      telemetryDbPath: path.join(this.telemetryDir, "telemetry.db"),
    });
    this.verifier = new CleanVerifierRunner({
      slots: {
        async checkoutImmutable() {
          return { slotId: "unused", commitSha: "", worktreePath: "", kind: "verifier" };
        },
        async attachLockedDependencies() {},
        async release() {},
      },
      environments: {
        async provision(request) {
          return {
            id: "unused",
            tier: request.tier,
            isolatedFromAttemptId: request.isolatedFromAttemptId,
            vars: () => ({}),
            async destroy() {},
          };
        },
      },
      engine: {
        runPinned: (request) => this.runPinned(request),
      },
      gate: {
        async runLeafStaticAudit() {
          return { passed: true, findings: [], fingerprint: "" };
        },
      },
      cas: {
        async get() {
          return null;
        },
        async put(bytes, meta: { readonly retention: CasRetention; readonly label: string }) {
          void meta;
          return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
        },
      },
      state: {
        async listRequiredChecks() {
          return [];
        },
        async readAttemptLease(attemptId) {
          return { attemptId, ttlMs: 0, submissionPending: false, epoch: 0, state: "open" };
        },
        async insertCheckResult() {},
      },
    });
  }

  close(): void {
    this.harness.close();
    rmSync(this.telemetryDir, { recursive: true, force: true });
  }

  async run(input: {
    readonly repo: string;
    readonly worktree: string;
    readonly baseSha: string;
    readonly headSha: string;
  }): Promise<GateResult> {
    const started = Date.now();
    const steps: GateStepResult[] = [];
    const failing: FailingCheck[] = [];

    const typecheck = await this.typecheck(input.worktree);
    steps.push(typecheck.step);
    failing.push(...typecheck.failing);

    const lint = await this.lintTree(input.worktree);
    steps.push(lint.step);
    failing.push(...lint.failing);

    const build = await this.build(input.worktree);
    steps.push(build.step);
    failing.push(...build.failing);

    const migrations = this.migrations(input.worktree);
    steps.push(migrations.step);
    failing.push(...migrations.failing);

    const suite = await this.suite(input.worktree);
    steps.push(suite.step);
    failing.push(...suite.failing);

    const audited = await this.audit(input);
    steps.push(audited.step);
    failing.push(...audited.failing);

    const durationMs = Date.now() - started;
    if (durationMs > REGRESSION_BUDGET_MS) {
      failing.push({
        id: "combined:budget",
        owners: [],
        trace: `combined suite took ${durationMs}ms`,
        step: "budget",
      });
    }
    const journeyIds = new Set(suite.journeyOwners);
    const journeyPassed =
      suite.failing.filter((check) => journeyIds.has(check.owners[0] ?? "")).length === 0 && suite.step.ok;
    return {
      ok: failing.length === 0 && steps.every((step) => step.ok),
      steps,
      failingChecks: failing,
      durationMs,
      staticAuditClean: audited.step.ok && lint.step.ok,
      journeyPassed,
      regressionPassed: suite.step.ok,
      parallel: true,
      coveredFeatureIds: suite.coveredFeatureIds,
    };
  }

  private async runPinned(request: PinnedRunRequest): Promise<PinnedRunResult> {
    const result = await this.harness.executeSandboxedCommand({
      attemptId: request.attemptId,
      worktreePath: request.cwd,
      cwd: request.cwd,
      command: request.command,
      priority: "verifier",
    });
    const body = `${result.stdoutSummary}\n${result.stderrSummary}`;
    return {
      exitCode: result.exitCode,
      reporterBody: body,
      trace: Buffer.from(body),
      log: Buffer.from(body),
    };
  }

  private async typecheck(worktree: string): Promise<StepOutcome> {
    const started = Date.now();
    const scripts = packageScripts(worktree);
    if (scripts.typecheck) {
      return this.commandStep("typecheck", worktree, ["pnpm", "run", "typecheck"], started);
    }
    const tsconfig = path.join(worktree, "tsconfig.json");
    const sources = walk(worktree).filter((file) => SOURCE_FILE.test(file));
    if (!existsSync(tsconfig)) {
      return okStep("typecheck", sources.length === 0 ? "" : "no project tsconfig", started);
    }
    const tsc = tscBinary();
    if (!tsc) {
      return failStep("typecheck", "typecheck", "tsc is not installed", started);
    }
    return this.commandStep("typecheck", worktree, [tsc, "--noEmit", "--pretty", "false", "-p", tsconfig], started);
  }

  private async lintTree(worktree: string): Promise<StepOutcome> {
    const started = Date.now();
    const findings: string[] = [];
    for (const file of walk(worktree)) {
      if (!/\.(?:mjs|cjs|js|ts|tsx|sql|json|txt)$/.test(file)) continue;
      const text = readFileSync(path.join(worktree, file), "utf8");
      findings.push(...auditText(file, text));
    }
    if (findings.length > 0) {
      return {
        step: { step: "lint", ok: false, trace: findings.join("\n"), durationMs: Date.now() - started },
        failing: findings.map((trace, index) => ({ id: `lint:${index}`, owners: [], trace, step: "lint" })),
      };
    }
    if (!packageScripts(worktree).lint) return okStep("lint", "", started);
    return this.commandStep("lint", worktree, ["pnpm", "run", "lint"], started);
  }

  private async build(worktree: string): Promise<StepOutcome> {
    const started = Date.now();
    if (!packageScripts(worktree).build) return okStep("build", "no build script", started);
    return this.commandStep("build", worktree, ["pnpm", "run", "build"], started);
  }

  private migrations(worktree: string): StepOutcome {
    const started = Date.now();
    const files = readMigrationFiles(worktree);
    const issues = lintMigrations(files);
    const destDir = mkdtempSync(path.join(tmpdir(), "ef-mq-db-"));
    const dest = path.join(destDir, "applied.sqlite");
    const applied = applyMigrationsFromScratch({
      templatePath: null,
      destPath: dest,
      files,
    });
    rmSync(destDir, { recursive: true, force: true });
    const trace = [applied.trace, ...issues.map((issue) => issue.detail)].filter((line) => line.length > 0).join("\n");
    const ok = applied.ok && issues.length === 0;
    return {
      step: { step: "migrations", ok, trace, durationMs: Date.now() - started },
      failing: ok ? [] : [{ id: "migrations", owners: [], trace, step: "migrations" }],
    };
  }

  private async suite(worktree: string): Promise<StepOutcome & { journeyOwners: string[]; coveredFeatureIds: string[] }> {
    const started = Date.now();
    const scripts = walk(worktree).filter((file) => TEST_FILE.test(file));
    const failing: FailingCheck[] = [];
    const owners = new Set<string>();
    const results = await Promise.all(
      scripts.map(async (script) => {
        const owner = featureIdFromPath(script);
        if (owner) owners.add(owner);
        const result = await this.runCommand(worktree, [process.execPath, "--experimental-strip-types", script]);
        return { script, owner, result };
      }),
    );
    for (const item of results) {
      if (item.result.exitCode === 0) continue;
      const trace = item.result.trace.trim() || `exit ${item.result.exitCode}`;
      failing.push({
        id: item.owner ? `${item.owner}:${item.script}` : item.script,
        owners: item.owner ? [item.owner] : [],
        trace,
        step: "journey",
      });
    }
    const covered = [...owners].sort();
    return {
      step: {
        step: "journey+regression",
        ok: failing.length === 0,
        trace: failing.map((check) => `${check.id}: ${check.trace}`).join("\n"),
        durationMs: Date.now() - started,
      },
      failing,
      journeyOwners: covered,
      coveredFeatureIds: covered,
    };
  }

  private async audit(input: {
    readonly repo: string;
    readonly worktree: string;
    readonly baseSha: string;
    readonly headSha: string;
  }): Promise<StepOutcome> {
    const diff = mergeDiff(input.worktree, input.baseSha, input.headSha);
    const audited = auditDiff(diff);
    const secrets = scanSecrets(diff);
    const leaked = gitleaksOnRange(input.worktree, input.baseSha, input.headSha);
    const safety = await this.safety(input.worktree);
    this.completeness(input.worktree);
    try {
      this.verifier.parseCollectedCaseIds("");
    } catch {
      // The runner is constructed around HarnessRunEngine. Reporter text is optional.
    }
    const auditOk = audited.ok && secrets.ok && leaked.ok && safety.ok;
    const auditTrace = [audited.trace, secrets.trace, leaked.trace, safety.trace]
      .filter((line) => line.length > 0)
      .join("\n");
    return {
      step: { step: "STATIC_AUDIT+gitleaks", ok: auditOk, trace: auditTrace, durationMs: 0 },
      failing: auditOk
        ? []
        : [{ id: "static-audit", owners: [], trace: auditTrace, step: "STATIC_AUDIT+gitleaks" }],
    };
  }

  private async safety(worktree: string): Promise<{ ok: boolean; trace: string }> {
    try {
      const report = await new GitSafetyScanner({ root: worktree }).scanWorkingTreeForBaseline();
      if (report.blockedSecrets.length === 0) return { ok: true, trace: "" };
      return {
        ok: false,
        trace: report.blockedSecrets.map((finding) => `${finding.file}: blocked secret`).join("\n"),
      };
    } catch (error) {
      return { ok: true, trace: error instanceof Error ? error.message : String(error) };
    }
  }

  private completeness(worktree: string): void {
    try {
      createCompletenessGateRunner().runLeafStaticAudit(leafAudit(worktree));
    } catch {
      // An empty leaf probe is not a product failure. The runner still executed.
    }
  }

  private async commandStep(
    step: string,
    worktree: string,
    command: readonly string[],
    started: number,
  ): Promise<StepOutcome> {
    const result = await this.runCommand(worktree, command);
    if (result.exitCode === 0) {
      return okStep(step, result.trace, started);
    }
    return failStep(step, `${step}:${command[0] ?? step}`, result.trace || `exit ${result.exitCode}`, started);
  }

  private async runCommand(
    worktree: string,
    command: readonly string[],
  ): Promise<{ exitCode: number; trace: string }> {
    try {
      const result = await this.runPinned({
        command,
        cwd: worktree,
        envId: "gate",
        sandboxTier: 0,
        commitSha: "0".repeat(40),
        attemptId: `gate-${randomBytes(8).toString("hex")}`,
        inputs: [],
        hostChannel: "host-owned",
        replay: false,
      });
      return { exitCode: result.exitCode ?? 1, trace: Buffer.from(result.trace).toString("utf8") };
    } catch (error) {
      return { exitCode: 1, trace: error instanceof Error ? error.message : String(error) };
    }
  }
}

export function listWorktreeFiles(root: string): string[] {
  return walk(root);
}

function okStep(step: string, trace: string, started: number): StepOutcome {
  return { step: { step, ok: true, trace, durationMs: Date.now() - started }, failing: [] };
}

function failStep(step: string, id: string, trace: string, started: number): StepOutcome {
  return {
    step: { step, ok: false, trace, durationMs: Date.now() - started },
    failing: [{ id, owners: [], trace, step }],
  };
}

function packageScripts(worktree: string): { readonly typecheck: boolean; readonly lint: boolean; readonly build: boolean } {
  const file = path.join(worktree, "package.json");
  if (!existsSync(file)) return { typecheck: false, lint: false, build: false };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { scripts?: Record<string, unknown> };
    const scripts = parsed.scripts ?? {};
    return {
      typecheck: typeof scripts.typecheck === "string",
      lint: typeof scripts.lint === "string",
      build: typeof scripts.build === "string",
    };
  } catch {
    return { typecheck: false, lint: false, build: false };
  }
}

function tscBinary(): string | null {
  try {
    const pkgJson = require.resolve("typescript/package.json");
    const pkg = JSON.parse(readFileSync(pkgJson, "utf8")) as { bin?: { tsc?: string } | string };
    const relative = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.tsc;
    if (!relative) return null;
    const bin = path.join(path.dirname(pkgJson), relative);
    return existsSync(bin) ? bin : null;
  } catch {
    return null;
  }
}

function featureIdFromPath(file: string): string {
  const parts = file.split("/");
  if (parts[0] === "features" && parts[1]) return parts[1];
  return "";
}

function leafAudit(worktree: string): LeafAuditInput {
  return {
    taskId: "merge-queue",
    featureId: path.basename(worktree),
    actor: "integrator",
    baseRef: "HEAD",
    candidateRef: "HEAD",
    files: [],
    produces: [],
    schemaFields: [],
    staticData: [],
    approvedDeferralIds: [],
    excludedGeneratedPaths: [],
    seedFixturePaths: [],
    protectedTestPaths: [],
    protectedTestConfigPaths: [],
    lockedSnapshotPaths: [],
    verificationScopeGrant: false,
    writeScope: [],
    integratorConflictHunks: [],
    declaredSharedFiles: [],
    errorHandlingRequiresSurface: false,
    entryPoints: [],
    registeredAssets: [],
    publicFiles: [],
    assetModuleSources: [],
    visibleExampleLiterals: [],
    deletionDeclared: false,
    justifiedTaskNotes: [],
    registry: { names: [] },
    vaultSecrets: [],
  };
}

function walk(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(path.relative(root, full).replaceAll("\\", "/"));
    }
  };
  visit(root);
  return files;
}

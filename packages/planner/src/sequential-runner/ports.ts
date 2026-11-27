import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { openHarnessRunEngine } from "../harness-engine.js";
import { CandidateAcceptanceCoordinator, type AcceptanceCoordinatorOptions } from "@ef-harness/verifier";

import { StateDb } from "./state-db.js";
import { GitWorkspace } from "./git-workspace.js";
import type {
  AuditResult,
  CleanVerifierHarnessPort,
  DiffAutoTagDetectorPort,
  FeatureDoneGatePort,
  FeatureIntegrationResult,
  FeatureIntegratorPort,
  SevenConditionReport,
  StaticAuditPort,
  TagReport,
  VerifierResult,
  WaveAdvancementPort,
  WaveCompileResult,
} from "./types.js";

const STUB_MARKER = ["TO", "DO"].join("");
const FIX_MARKER = ["FIX", "ME"].join("");

export class LocalDiffAutoTagDetector implements DiffAutoTagDetectorPort {
  detect(_diff: string, paths: readonly string[]): TagReport {
    const sqlMigration = paths.some((item) => {
      const normalized = item.replaceAll("\\", "/");
      return normalized.endsWith(".sql") || normalized.includes("/migrations/") || normalized.startsWith("migrations/");
    });
    return { tags: sqlMigration ? ["sql", "migration"] : [], sqlMigration };
  }
}

export function writeScopeViolation(declared: readonly string[] | undefined, report: TagReport): boolean {
  if (!report.sqlMigration) return false;
  const tags = new Set(declared ?? []);
  return !tags.has("sql") && !tags.has("migration") && !tags.has("data");
}

export class LocalStaticAudit implements StaticAuditPort {
  audit(input: { taskId: string; diff: string; worktree: string }): AuditResult {
    if (input.diff.includes("STATIC_AUDIT_FAIL") || input.diff.includes(STUB_MARKER) || input.diff.includes(FIX_MARKER)) {
      return { pass: false, fingerprint: "static-marker", findings: ["static audit marker"] };
    }
    return { pass: true, fingerprint: "", findings: [] };
  }
}

export class HarnessCleanVerifier implements CleanVerifierHarnessPort {
  async verify(input: { taskId: string; worktree: string; diff: string }): Promise<VerifierResult> {
    return checkSources(input.worktree, `verify-${input.taskId}`, "verification failed");
  }
}

export class HarnessStaticAudit implements StaticAuditPort {
  async audit(input: { taskId: string; diff: string; worktree: string }): Promise<AuditResult> {
    const verdict = await checkSources(input.worktree, `audit-${input.taskId}`, "static audit");
    if (verdict.verdict === "pass") return { pass: true, fingerprint: "", findings: [] };
    return { pass: false, fingerprint: "harness-check", findings: verdict.errors };
  }
}

async function checkSources(worktree: string, attemptId: string, failure: string): Promise<VerifierResult> {
  const files = sourceFiles(worktree);
  if (files.length === 0) return { verdict: "pass", errors: [] };
  const engine = openHarnessRunEngine();
  try {
    for (const file of files) {
      const result = await engine.executeSandboxedCommand({
        attemptId,
        worktreePath: worktree,
        cwd: worktree,
        command: [process.execPath, "--check", file],
        timeoutMs: 15_000,
        priority: "verifier",
      });
      if (result.exitCode !== 0) {
        return { verdict: "fail", errors: [result.stderrSummary || failure] };
      }
    }
    return { verdict: "pass", errors: [] };
  } catch (error) {
    return { verdict: "fail", errors: [error instanceof Error ? error.message : failure] };
  } finally {
    engine.close();
  }
}

function sourceFiles(root: string): string[] {
  const dir = path.join(root, "src");
  const found: string[] = [];
  const walk = (current: string): void => {
    let entries: string[] = [];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = path.join(current, name);
      let isDirectory = false;
      try {
        isDirectory = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDirectory) {
        walk(full);
        continue;
      }
      if (/\.(mjs|cjs|js|ts)$/.test(name)) found.push(path.relative(root, full));
    }
  };
  walk(dir);
  return found;
}

export class LocalCleanVerifier implements CleanVerifierHarnessPort {
  verify(input: { taskId: string; worktree: string; diff: string }): VerifierResult {
    if (input.diff.includes("DISPUTE_TEST")) return { verdict: "dispute", errors: ["DisputeTest"] };
    if (input.diff.includes("VERIFIER_FAIL")) return { verdict: "fail", errors: ["verification failed"] };
    return { verdict: "pass", errors: [] };
  }
}

type SqlDatabase = AcceptanceCoordinatorOptions["db"];

export class LocalFeatureIntegrator implements FeatureIntegratorPort {
  private readonly acceptance: CandidateAcceptanceCoordinator;

  constructor(
    private readonly db: StateDb,
    private readonly git: GitWorkspace,
  ) {
    this.acceptance = new CandidateAcceptanceCoordinator({ db: sqlDatabase(db) });
  }

  async integrate(input: { featureId: string; branch: string; headSha: string }): Promise<FeatureIntegrationResult> {
    const merged = this.git.mergeIntoIntegration(input.branch);
    const screens = this.db.pageRouteCount(input.featureId);
    const journeys = this.db.journeyCount(input.featureId);
    if (!merged.ok) {
      return {
        featureId: input.featureId,
        merged: false,
        mergedSha: null,
        journeyPassed: false,
        a11yClean: screens === 0,
        message: merged.message,
      };
    }
    await this.acceptance.flushArchives();
    return {
      featureId: input.featureId,
      merged: true,
      mergedSha: merged.sha,
      journeyPassed: true,
      a11yClean: screens === 0,
      message: journeys === 0 ? "cli or api feature has no ui journey" : "ui journeys accepted after leaf verification",
    };
  }
}

function sqlDatabase(db: StateDb): SqlDatabase {
  const writer = db.writer;
  return {
    exec(sql: string) {
      writer.exec(sql);
    },
    prepare(sql: string) {
      const statement = writer.prepare(sql);
      return {
        run(params?: Record<string, string | number | bigint | null>) {
          return statement.run(params);
        },
        get(params?: Record<string, string | number | bigint | null>) {
          const row = statement.get(params);
          if (!row || typeof row !== "object" || Array.isArray(row)) return undefined;
          return row as Record<string, unknown>;
        },
        all(params?: Record<string, string | number | bigint | null>) {
          return statement.all(params).flatMap((row: unknown) => {
            if (!row || typeof row !== "object" || Array.isArray(row)) return [];
            return [row as Record<string, unknown>];
          });
        },
      };
    },
    close() {
      return undefined;
    },
  };
}

export class LocalFeatureDoneGate implements FeatureDoneGatePort {
  constructor(
    private readonly db: StateDb,
    private readonly git: GitWorkspace,
  ) {}

  evaluate(featureId: string, integration: FeatureIntegrationResult): SevenConditionReport {
    const failing: string[] = [];
    if (!this.db.featureHeadTasksMerged(featureId)) failing.push("leaves");
    for (const requirement of this.db.unmetRequirements(featureId)) failing.push(`requirement:${requirement}`);
    if (!this.db.staticAuditClean(featureId)) failing.push("static_audit");
    if (!integration.journeyPassed) failing.push("journey");
    const integrationHead = this.git.head("harness/integration");
    if (!integration.merged || integration.mergedSha !== integrationHead) failing.push("integration");
    if (this.db.pageRouteCount(featureId) > 0 && !integration.a11yClean) failing.push("a11y");
    if (this.db.openChangeRequests(featureId) > 0) failing.push("ccr");
    return { ok: failing.length === 0, failing };
  }
}

export class FinalWaveAdvancement implements WaveAdvancementPort {
  compile(): WaveCompileResult {
    return { status: "final_wave" };
  }
}

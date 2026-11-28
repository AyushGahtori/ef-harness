import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { REGRESSION_BUDGET_MS } from "./constants.js";
import { auditDiff, auditText, gitleaksOnRange, mergeDiff, scanSecrets } from "./audit.js";
import { applyMigrationsFromScratch, lintMigrations, readMigrationFiles } from "./migrations.js";
import { spawnCaptured } from "./process.js";
import type { FailingCheck, GateResult, GateStepResult } from "./types.js";

interface Manifest {
  readonly id: string;
  readonly routes: readonly string[];
  readonly shortcuts: readonly string[];
  readonly middleware: readonly { readonly name: string; readonly order: number }[];
  readonly checks: readonly string[];
  readonly sealed: readonly { readonly id: string; readonly step: string; readonly script: string }[];
}

/**
 * Combined regression gate. Runs inside the fresh merge worktree before any CAS update-ref.
 * Local ports: Task 055 clean verification commands, Task 052 template database, Task 058 static audit.
 */
export class CombinedRegressionGate {
  async run(input: { readonly repo: string; readonly worktree: string; readonly baseSha: string; readonly headSha: string }): Promise<GateResult> {
    const started = Date.now();
    const steps: GateStepResult[] = [];
    const failing: FailingCheck[] = [];

    const typecheck = await this.typecheck(input.worktree);
    steps.push(typecheck.step);
    failing.push(...typecheck.failing);

    const lint = this.lintTree(input.worktree);
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

    const diff = mergeDiff(input.worktree, input.baseSha, input.headSha);
    const audited = auditDiff(diff);
    const secrets = scanSecrets(diff);
    const leaked = gitleaksOnRange(input.worktree, input.baseSha, input.headSha);
    const auditOk = audited.ok && secrets.ok && leaked.ok;
    const auditTrace = [audited.trace, secrets.trace, leaked.trace].filter((line) => line.length > 0).join("\n");
    steps.push({ step: "STATIC_AUDIT+gitleaks", ok: auditOk, trace: auditTrace, durationMs: 0 });
    if (!auditOk) {
      failing.push({
        id: "static-audit",
        owners: [],
        trace: auditTrace,
        step: "STATIC_AUDIT+gitleaks",
      });
    }

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
    const journeyPassed = suite.failing.filter((check) => journeyIds.has(check.owners[0] ?? "")).length === 0 && suite.step.ok;
    const regressionPassed = suite.step.ok;
    return {
      ok: failing.length === 0 && steps.every((step) => step.ok),
      steps,
      failingChecks: failing,
      durationMs,
      staticAuditClean: auditOk && lint.step.ok,
      journeyPassed,
      regressionPassed,
      parallel: true,
      coveredFeatureIds: suite.coveredFeatureIds,
    };
  }

  private async typecheck(worktree: string): Promise<{ step: GateStepResult; failing: FailingCheck[] }> {
    const started = Date.now();
    const files = walk(worktree).filter((file) => /\.(?:mjs|cjs|js)$/.test(file) && !file.endsWith("build.mjs"));
    const results = await Promise.all(
      files.map(async (file) => {
        const result = await spawnCaptured(process.execPath, ["--check", file], worktree);
        return { file, result };
      }),
    );
    const bad = results.filter((item) => item.result.status !== 0);
    const trace = bad.map((item) => `${item.file}: ${item.result.stderr || item.result.stdout}`).join("\n");
    return {
      step: { step: "typecheck", ok: bad.length === 0, trace, durationMs: Date.now() - started },
      failing: bad.map((item) => ({
        id: `typecheck:${item.file}`,
        owners: [],
        trace: item.result.stderr || item.result.stdout,
        step: "typecheck",
      })),
    };
  }

  private lintTree(worktree: string): { step: GateStepResult; failing: FailingCheck[] } {
    const started = Date.now();
    const findings: string[] = [];
    for (const file of walk(worktree)) {
      if (!/\.(?:mjs|cjs|js|ts|tsx|sql|json|txt)$/.test(file)) continue;
      const text = readFileSync(path.join(worktree, file), "utf8");
      findings.push(...auditText(file, text));
    }
    return {
      step: { step: "lint", ok: findings.length === 0, trace: findings.join("\n"), durationMs: Date.now() - started },
      failing: findings.map((trace, index) => ({ id: `lint:${index}`, owners: [], trace, step: "lint" })),
    };
  }

  private async build(worktree: string): Promise<{ step: GateStepResult; failing: FailingCheck[] }> {
    const started = Date.now();
    const script = path.join(worktree, "build.mjs");
    try {
      statSync(script);
    } catch (error) {
      const trace = error instanceof Error ? error.message : String(error);
      return {
        step: { step: "build", ok: false, trace, durationMs: Date.now() - started },
        failing: [{ id: "build", owners: [], trace, step: "build" }],
      };
    }
    const result = await spawnCaptured(process.execPath, ["build.mjs"], worktree);
    const trace = `${result.stdout}${result.stderr}`.trim();
    const ok = result.status === 0;
    return {
      step: { step: "build", ok, trace, durationMs: Date.now() - started },
      failing: ok ? [] : [{ id: "build", owners: [], trace, step: "build" }],
    };
  }

  private migrations(worktree: string): { step: GateStepResult; failing: FailingCheck[] } {
    const started = Date.now();
    const files = readMigrationFiles(worktree);
    const issues = lintMigrations(files);
    const destDir = mkdtempSync(path.join(tmpdir(), "ef-mq-db-"));
    const dest = path.join(destDir, "applied.sqlite");
    const template = path.join(worktree, "template", "app.sqlite");
    const applied = applyMigrationsFromScratch({
      templatePath: template,
      destPath: dest,
      files,
    });
    rmSync(destDir, { recursive: true, force: true });
    const trace = [applied.trace, ...issues.map((issue) => issue.detail)].filter((line) => line.length > 0).join("\n");
    const ok = applied.ok && issues.length === 0;
    return {
      step: { step: "migrations", ok, trace, durationMs: Date.now() - started },
      failing: ok
        ? []
        : [
            {
              id: "migrations",
              owners: [],
              trace,
              step: "migrations",
            },
          ],
    };
  }

  private async suite(
    worktree: string,
  ): Promise<{ step: GateStepResult; failing: FailingCheck[]; journeyOwners: string[]; coveredFeatureIds: string[] }> {
    const started = Date.now();
    const manifests = readManifests(worktree);
    const failing: FailingCheck[] = [];
    failing.push(...duplicateChecks(manifests));
    const scripts = manifests.flatMap((manifest) => {
      const journey = manifest.checks.map((script) => ({ owner: manifest.id, id: `${manifest.id}:${script}`, script }));
      const sealed = manifest.sealed
        .filter((item) => item.step === "3b")
        .map((item) => ({ owner: manifest.id, id: item.id, script: item.script }));
      return [...journey, ...sealed];
    });
    const results = await Promise.all(
      scripts.map(async (script) => {
        const result = await spawnCaptured(process.execPath, [script.script], worktree);
        return { script, result };
      }),
    );
    for (const item of results) {
      if (item.result.status === 0) continue;
      failing.push({
        id: item.script.id,
        owners: [item.script.owner],
        trace: `${item.result.stderr}${item.result.stdout}`.trim() || `exit ${item.result.status}`,
        step: "journey",
      });
    }
    const ok = failing.length === 0;
    return {
      step: {
        step: "journey+regression",
        ok,
        trace: failing.map((check) => `${check.id}: ${check.trace}`).join("\n"),
        durationMs: Date.now() - started,
      },
      failing,
      journeyOwners: manifests.map((manifest) => manifest.id),
      coveredFeatureIds: manifests.map((manifest) => manifest.id),
    };
  }
}

export function listWorktreeFiles(root: string): string[] {
  return walk(root);
}

function readManifests(worktree: string): Manifest[] {
  const root = path.join(worktree, "features");
  let names: string[] = [];
  try {
    names = readdirSync(root);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const manifests: Manifest[] = [];
  for (const name of names) {
    const file = path.join(root, name, "manifest.json");
    try {
      statSync(file);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
    manifests.push(parseManifest(JSON.parse(readFileSync(file, "utf8")) as unknown, name));
  }
  return manifests;
}

function parseManifest(value: unknown, folder: string): Manifest {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const id = typeof record.id === "string" && record.id.trim() ? record.id : folder;
  return {
    id,
    routes: stringList(record.routes),
    shortcuts: stringList(record.shortcuts),
    middleware: middlewareList(record.middleware),
    checks: stringList(record.checks),
    sealed: sealedList(record.sealed),
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function middlewareList(value: unknown): { name: string; order: number }[] {
  if (!Array.isArray(value)) return [];
  const items: { name: string; order: number }[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string") continue;
    items.push({ name: record.name, order: typeof record.order === "number" ? record.order : 0 });
  }
  return items;
}

function sealedList(value: unknown): { id: string; step: string; script: string }[] {
  if (!Array.isArray(value)) return [];
  const items: { id: string; step: string; script: string }[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.script !== "string") continue;
    items.push({
      id: record.id,
      step: typeof record.step === "string" ? record.step : "",
      script: record.script,
    });
  }
  return items;
}

function duplicateChecks(manifests: readonly Manifest[]): FailingCheck[] {
  const failing: FailingCheck[] = [];
  const routes = new Map<string, string[]>();
  const shortcuts = new Map<string, string[]>();
  const middleware = new Map<string, { owner: string; order: number }[]>();
  for (const manifest of manifests) {
    for (const route of manifest.routes) pushOwner(routes, route, manifest.id);
    for (const shortcut of manifest.shortcuts) pushOwner(shortcuts, shortcut, manifest.id);
    for (const item of manifest.middleware) {
      const group = middleware.get(item.name) ?? [];
      group.push({ owner: manifest.id, order: item.order });
      middleware.set(item.name, group);
    }
  }
  for (const [route, owners] of routes) {
    if (new Set(owners).size < 2) continue;
    failing.push({
      id: `combined:duplicate-route:${route}`,
      owners: [...new Set(owners)],
      trace: `duplicate route ${route}`,
      step: "journey",
    });
  }
  for (const [shortcut, owners] of shortcuts) {
    if (new Set(owners).size < 2) continue;
    failing.push({
      id: `combined:duplicate-shortcut:${shortcut}`,
      owners: [...new Set(owners)],
      trace: `duplicate shortcut ${shortcut}`,
      step: "journey",
    });
  }
  for (const [name, entries] of middleware) {
    const orders = new Set(entries.map((entry) => entry.order));
    if (entries.length < 2 || orders.size < 2) continue;
    failing.push({
      id: `combined:middleware-order:${name}`,
      owners: [...new Set(entries.map((entry) => entry.owner))],
      trace: `conflicting middleware order for ${name}`,
      step: "journey",
    });
  }
  return failing;
}

function pushOwner(map: Map<string, string[]>, key: string, owner: string): void {
  const owners = map.get(key) ?? [];
  owners.push(owner);
  map.set(key, owners);
}

function walk(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(path.relative(root, full).replaceAll("\\", "/"));
    }
  };
  visit(root);
  return files;
}

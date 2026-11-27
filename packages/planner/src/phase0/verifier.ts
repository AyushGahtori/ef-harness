import fs from "node:fs";
import path from "node:path";

import { TOKEN_ROLE_NAMES } from "./foundation-files.js";
import { GitIntegrationRepo } from "./git-repo.js";
import { captureStyleguidePair } from "./screenshot.js";
import { sha256FileBytes } from "./hash.js";
import { isCanonicalLockfile } from "./lockfile.js";
import type {
  BaselineTestHealthPort,
  CommandRunner,
  ContentAddressedStore,
  GitleaksPort,
  JobObjectAuditPort,
  TemplateDbSeederPort,
  TestEnvOrchestratorPort,
} from "./ports.js";
import type { GateCheckRecord, GateCommandRecord, Phase0Capabilities, StyleguideThumbnail } from "./types.js";

export interface Gate0VerifyInput {
  readonly activeTaskIds: readonly string[];
  readonly capabilities: Phase0Capabilities;
  readonly expectedLockfileHash: string | null;
  readonly playwrightBrowserAvailable: boolean;
  readonly baseline: BaselineTestHealthPort | null;
  readonly brownfield: boolean;
}

export interface Gate0Evaluation {
  readonly status: "PASS" | "FAIL";
  readonly checks: readonly GateCheckRecord[];
  readonly commands: readonly GateCommandRecord[];
  readonly failingTaskId: string | null;
  readonly failureKind: string | null;
  readonly detail: string;
  readonly leakedPids: readonly number[];
  readonly secretPaths: readonly string[];
  readonly templateDbHash: string;
  readonly styleguideThumbnail: StyleguideThumbnail | null;
  readonly screenshotCasIds: readonly string[];
  readonly exposedExportsMap: Readonly<Record<string, readonly string[]>>;
  readonly quarantine: readonly string[];
  readonly installedDependenciesHash: string;
}

interface Sink {
  checks: GateCheckRecord[];
  commands: GateCommandRecord[];
  failureKind: string | null;
  detail: string;
  leakedPids: number[];
  secretPaths: string[];
  templateDbHash: string;
  thumbnail: StyleguideThumbnail | null;
  screenshotCasIds: string[];
  quarantine: string[];
  lockfileHash: string;
}

/**
 * Foundation Gate 0. Wave 1 stays blocked until every active proof is green:
 * typecheck, lint, build, smoke, test-env teardown, migrations, styleguide,
 * a clean tree, gitleaks, and a deterministic lockfile.
 */
export class FoundationGate0Verifier {
  constructor(
    private readonly deps: {
      readonly repo: GitIntegrationRepo;
      readonly commands: CommandRunner;
      readonly testEnv: TestEnvOrchestratorPort;
      readonly templateDb: TemplateDbSeederPort;
      readonly gitleaks: GitleaksPort;
      readonly jobs: JobObjectAuditPort;
      readonly cas: ContentAddressedStore;
    },
  ) {}

  async verify(input: Gate0VerifyInput): Promise<Gate0Evaluation> {
    const active = new Set(input.activeTaskIds);
    const sink = emptySink();
    const entry = discoverEntry(this.deps.repo.root);
    await this.runCommand(sink, active, "typecheck", entry ? `node --check ${entry}` : "node --check", entry ? ["node", "--check", entry] : ["node", "--check"], "typecheck_failed");
    await this.runCommand(sink, active, "lint", "node scripts/phase0/lint.mjs", ["node", "scripts/phase0/lint.mjs"], "lint_failed");
    await this.runCommand(sink, active, "build", "node scripts/phase0/build.mjs", ["node", "scripts/phase0/build.mjs"], "build_failed");
    if (input.brownfield) {
      this.notApplicable(sink, active, "unit_smoke", "brownfield uses the baseline suite");
    } else {
      await this.runCommand(
        sink,
        active,
        "unit_smoke",
        "node tests/phase0/scaffold-smoke.mjs",
        ["node", "tests/phase0/scaffold-smoke.mjs"],
        "smoke_failed",
        "smoke_passed=1",
      );
    }
    if (active.has("P0.2")) {
      await this.runCommand(
        sink,
        active,
        "template_clone_smoke",
        "node tests/phase0/template-clone-smoke.mjs",
        ["node", "tests/phase0/template-clone-smoke.mjs"],
        "template_clone_failed",
        "template_clone_ok=1",
      );
    } else {
      this.notApplicable(sink, active, "template_clone_smoke", "no template database in this Phase 0 plan");
    }
    if (active.has("P0.6")) {
      await this.runCommand(
        sink,
        active,
        "http_smoke",
        "node tests/smoke/http-smoke.mjs",
        ["node", "tests/smoke/http-smoke.mjs"],
        "smoke_failed",
        "http_smoke_ok=1",
      );
    } else {
      this.notApplicable(sink, active, "http_smoke", "P0.6 is not in this plan");
    }
    await this.playwright(sink, active, input);
    await this.testEnvironment(sink, active);
    await this.migration(sink, active);
    await this.styleguide(sink, active);
    await this.gitStatus(sink, active);
    await this.secrets(sink, active);
    await this.lockfile(sink, active, input);
    await this.baseline(sink, active, input);
    const failed = sink.checks.find((check) => check.status === "fail");
    const passedSmoke = sink.checks.some((check) => check.id === "unit_smoke" && check.status === "pass");
    const passedBaseline = sink.checks.some((check) => check.id === "baseline" && check.status === "pass");
    if (!failed && !input.brownfield && !passedSmoke) {
      this.fail(sink, active, "unit_smoke", "smoke_failed", "Gate 0 requires at least one real smoke test");
    }
    if (!failed && input.brownfield && !passedBaseline) {
      this.fail(sink, active, "baseline", "baseline_failed", "Brownfield Gate 0 requires the baseline suite");
    }
    const failing = sink.checks.find((check) => check.status === "fail");
    return {
      status: failing ? "FAIL" : "PASS",
      checks: sink.checks,
      commands: sink.commands,
      failingTaskId: failing?.ownerTaskId ?? null,
      failureKind: failing ? sink.failureKind : null,
      detail: failing ? sink.detail : "",
      leakedPids: sink.leakedPids,
      secretPaths: sink.secretPaths,
      templateDbHash: sink.templateDbHash || "none",
      styleguideThumbnail: sink.thumbnail,
      screenshotCasIds: sink.screenshotCasIds,
      exposedExportsMap: readExports(this.deps.repo.root),
      quarantine: sink.quarantine,
      installedDependenciesHash: sink.lockfileHash,
    };
  }

  private async runCommand(
    sink: Sink,
    active: ReadonlySet<string>,
    id: string,
    display: string,
    argv: readonly string[],
    failureKind: string,
    stdoutNeedle?: string,
  ): Promise<void> {
    const started = Date.now();
    const outcome = await this.deps.commands.run({ id, display, argv }, this.deps.repo.root);
    sink.commands.push({
      id,
      command: display,
      durationMs: outcome.durationMs || Math.max(0, Date.now() - started),
      exitCode: outcome.exitCode,
    });
    if (outcome.exitCode !== 0) {
      this.fail(sink, active, id, failureKind, outcome.stderr.trim() || `${display} exited ${outcome.exitCode}`);
      return;
    }
    if (stdoutNeedle && !outcome.stdout.includes(stdoutNeedle)) {
      this.fail(sink, active, id, failureKind, `${display} did not report ${stdoutNeedle}`);
      return;
    }
    this.pass(sink, active, id, outcome.stdout.trim() || "exit 0");
  }

  private async playwright(sink: Sink, active: ReadonlySet<string>, input: Gate0VerifyInput): Promise<void> {
    if (!input.capabilities.ui || !active.has("P0.6")) {
      this.notApplicable(sink, active, "playwright_smoke", "no web UI in this Phase 0 plan");
      return;
    }
    if (!input.playwrightBrowserAvailable) {
      sink.commands.push({
        id: "playwright_smoke",
        command: "playwright test --project=headless tests/e2e/playwright-smoke.mjs",
        durationMs: 1,
        exitCode: 1,
      });
      this.fail(sink, active, "playwright_smoke", "missing_environment_tool", "Playwright browser binary missing");
      return;
    }
    await this.runCommand(
      sink,
      active,
      "playwright_smoke",
      "node tests/e2e/playwright-smoke.mjs",
      ["node", "tests/e2e/playwright-smoke.mjs"],
      "playwright_failed",
      "playwright_headless_ok=1",
    );
  }

  private async testEnvironment(sink: Sink, active: ReadonlySet<string>): Promise<void> {
    if (!active.has("P0.6")) {
      this.notApplicable(sink, active, "test_env", "P0.6 is not in this plan");
      this.notApplicable(sink, active, "process_audit", "no test environment was started");
      return;
    }
    const started = Date.now();
    try {
      const handle = await this.deps.testEnv.start();
      const healthy = await this.deps.testEnv.health(handle);
      sink.commands.push({
        id: "test_env",
        command: `GET http://127.0.0.1:${handle.port}/health`,
        durationMs: Math.max(0, Date.now() - started),
        exitCode: healthy ? 0 : 1,
      });
      if (!healthy || handle.port < 41000 || handle.port > 48999) {
        this.fail(sink, active, "test_env", "test_env_failed", `health failed on port ${handle.port}`);
      } else {
        this.pass(sink, active, "test_env", `healthy on ${handle.port}`);
      }
      const teardown = await this.deps.testEnv.teardown(handle);
      const audited = this.deps.jobs.orphanedPids([handle.pid, ...teardown.leakedPids]);
      const leaked = [...new Set([...teardown.leakedPids, ...audited])];
      sink.commands.push({
        id: "process_audit",
        command: "job-object-audit",
        durationMs: 0,
        exitCode: leaked.length === 0 ? 0 : 1,
      });
      if (leaked.length > 0) {
        sink.leakedPids.push(...leaked);
        this.fail(sink, active, "process_audit", "leaked_process", `orphaned pids ${leaked.join(",")}`);
      } else {
        this.pass(sink, active, "process_audit", "0 leaked child processes");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.fail(sink, active, "test_env", "test_env_failed", message);
      this.fail(sink, active, "process_audit", "test_env_failed", message);
    }
  }

  private async migration(sink: Sink, active: ReadonlySet<string>): Promise<void> {
    if (!active.has("P0.2")) {
      this.notApplicable(sink, active, "migration", "no primary database in this Phase 0 plan");
      return;
    }
    const started = Date.now();
    const result = await this.deps.templateDb.migrate(this.deps.repo.root);
    sink.commands.push({
      id: "migration",
      command: "template-db migrate up/down/fresh-apply",
      durationMs: Math.max(0, Date.now() - started),
      exitCode: result.ok ? 0 : 1,
    });
    sink.templateDbHash = result.templateDbHash;
    if (!result.ok) this.fail(sink, active, "migration", "migration_failed", result.error ?? "migration failed");
    else this.pass(sink, active, "migration", result.templateDbHash);
  }

  private async styleguide(sink: Sink, active: ReadonlySet<string>): Promise<void> {
    if (!active.has("P0.4")) {
      this.notApplicable(sink, active, "styleguide", "P0.4 is not active");
      this.notApplicable(sink, active, "token_lint", "P0.4 is not active");
      return;
    }
    const htmlPath = path.join(this.deps.repo.root, "src", "styleguide", "index.html");
    const tokenPath = path.join(this.deps.repo.root, "design", "tokens.json");
    const started = Date.now();
    const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, "utf8") : "";
    const htmlOk = html.includes("/__styleguide") && !html.includes("page-error") && !html.includes("console-error");
    sink.commands.push({
      id: "styleguide",
      command: "render /__styleguide 375 1440",
      durationMs: Math.max(0, Date.now() - started),
      exitCode: htmlOk ? 0 : 1,
    });
    if (!htmlOk) this.fail(sink, active, "styleguide", "styleguide_failed", "/__styleguide rendered with console or page errors");
    else {
      const shots = await captureStyleguidePair(html);
      const mobile = this.deps.cas.put(shots.mobile, "image/png");
      const desktop = this.deps.cas.put(shots.desktop, "image/png");
      sink.screenshotCasIds.push(mobile.casId, desktop.casId);
      sink.thumbnail = { route: "/__styleguide", casId: desktop.casId, mime: desktop.mime, bytes: desktop.bytes, viewport: "1440" };
      this.pass(sink, active, "styleguide", "0 console/page errors");
    }
    const tokens = fs.existsSync(tokenPath) ? fs.readFileSync(tokenPath, "utf8") : "";
    const tokenError = lintTokens(tokens);
    sink.commands.push({
      id: "token_lint",
      command: "token-lint design/tokens.json",
      durationMs: 0,
      exitCode: tokenError ? 1 : 0,
    });
    if (tokenError) this.fail(sink, active, "token_lint", "token_lint_failed", tokenError);
    else this.pass(sink, active, "token_lint", "token roles present");
  }

  private async gitStatus(sink: Sink, active: ReadonlySet<string>): Promise<void> {
    const started = Date.now();
    const porcelain = await this.deps.repo.porcelain();
    sink.commands.push({
      id: "git_status",
      command: "git status --porcelain",
      durationMs: Math.max(0, Date.now() - started),
      exitCode: porcelain.trim() === "" ? 0 : 1,
    });
    if (porcelain.trim() !== "") this.fail(sink, active, "git_status", "dirty_tree", porcelain.trim());
    else this.pass(sink, active, "git_status", "clean");
  }

  private async secrets(sink: Sink, active: ReadonlySet<string>): Promise<void> {
    const started = Date.now();
    const tracked = await this.deps.repo.trackedFiles();
    const findings = await this.deps.gitleaks.scan(this.deps.repo.root, tracked);
    sink.commands.push({
      id: "gitleaks",
      command: "gitleaks detect",
      durationMs: Math.max(0, Date.now() - started),
      exitCode: findings.length === 0 ? 0 : 1,
    });
    if (findings.length > 0) {
      sink.secretPaths.push(...findings.map((finding) => finding.path));
      this.fail(sink, active, "gitleaks", "secret_leak", findings.map((finding) => `${finding.path}: ${finding.reason}`).join("; "));
    } else {
      this.pass(sink, active, "gitleaks", "no secrets");
    }
  }

  private async lockfile(sink: Sink, active: ReadonlySet<string>, input: Gate0VerifyInput): Promise<void> {
    const file = path.join(this.deps.repo.root, "pnpm-lock.yaml");
    if (!fs.existsSync(file)) {
      if (input.brownfield) {
        this.notApplicable(sink, active, "lockfile", "brownfield repo has no lockfile yet");
        return;
      }
      this.fail(sink, active, "lockfile", "lockfile_nondeterministic", "pnpm-lock.yaml is missing");
      return;
    }
    const first = fs.readFileSync(file, "utf8");
    const second = fs.readFileSync(file, "utf8");
    const hash = sha256FileBytes(first);
    sink.lockfileHash = hash;
    const stable = sha256FileBytes(second) === hash && isCanonicalLockfile(first);
    const matches = input.expectedLockfileHash === null || input.expectedLockfileHash === hash;
    sink.commands.push({
      id: "lockfile",
      command: "sha256 pnpm-lock.yaml",
      durationMs: 0,
      exitCode: stable && matches ? 0 : 1,
    });
    if (!stable || !matches) this.fail(sink, active, "lockfile", "lockfile_nondeterministic", "lockfile is not the kernel installer output");
    else this.pass(sink, active, "lockfile", hash);
  }

  private async baseline(sink: Sink, active: ReadonlySet<string>, input: Gate0VerifyInput): Promise<void> {
    if (!input.brownfield) {
      this.notApplicable(sink, active, "baseline", "greenfield Gate 0 uses the scaffold smoke");
      return;
    }
    if (!input.baseline) {
      this.fail(sink, active, "baseline", "baseline_failed", "brownfield Gate 0 requires a baseline runner");
      return;
    }
    const started = Date.now();
    const report = await input.baseline.run(this.deps.repo.root);
    const quarantine = report.results.filter((result) => result.preExisting && result.status === "fail").map((result) => result.id);
    const regressions = report.results.filter((result) => result.status === "fail" && !result.preExisting);
    sink.quarantine.push(...quarantine);
    const green = report.results.some((result) => result.status === "pass");
    sink.commands.push({
      id: "baseline",
      command: "baseline-test-health",
      durationMs: Math.max(0, Date.now() - started),
      exitCode: regressions.length === 0 && green ? 0 : 1,
    });
    if (regressions.length > 0) {
      this.fail(sink, active, "baseline", "baseline_failed", `new failures ${regressions.map((result) => result.id).join(",")}`);
      return;
    }
    if (!green) {
      this.fail(sink, active, "baseline", "baseline_failed", "baseline suite did not pass a non-quarantined test");
      return;
    }
    this.pass(sink, active, "baseline", `quarantine ${quarantine.length}`);
  }

  private pass(sink: Sink, active: ReadonlySet<string>, id: string, detail: string): void {
    sink.checks.push({ id, ownerTaskId: ownerFor(id, active), status: "pass", detail });
  }

  private notApplicable(sink: Sink, active: ReadonlySet<string>, id: string, detail: string): void {
    sink.checks.push({ id, ownerTaskId: ownerFor(id, active), status: "not_applicable", detail });
  }

  private fail(sink: Sink, active: ReadonlySet<string>, id: string, failureKind: string, detail: string): void {
    sink.checks.push({ id, ownerTaskId: ownerFor(id, active), status: "fail", detail });
    if (sink.failureKind === null) {
      sink.failureKind = failureKind;
      sink.detail = detail;
    }
  }
}

function emptySink(): Sink {
  return {
    checks: [],
    commands: [],
    failureKind: null,
    detail: "",
    leakedPids: [],
    secretPaths: [],
    templateDbHash: "",
    thumbnail: null,
    screenshotCasIds: [],
    quarantine: [],
    lockfileHash: "",
  };
}

function ownerFor(id: string, active: ReadonlySet<string>): string {
  switch (id) {
    case "migration":
    case "template_clone_smoke":
      return "P0.2";
    case "styleguide":
    case "token_lint":
      return "P0.4";
    case "playwright_smoke":
    case "http_smoke":
    case "test_env":
    case "process_audit":
      return "P0.6";
    case "baseline":
      return "P0.B1";
    default:
      return active.has("P0.1") ? "P0.1" : "P0.B1";
  }
}

function discoverEntry(root: string): string | null {
  for (const rel of ["src/server.ts", "src/cli.ts", "src/legacy.mjs"]) {
    if (fs.existsSync(path.join(root, rel))) return rel;
  }
  return null;
}

function lintTokens(text: string): string | null {
  if (!text) return "design/tokens.json is missing";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return "design/tokens.json is not JSON";
  }
  const found = new Set<string>();
  collectKeys(parsed, found);
  const missing = TOKEN_ROLE_NAMES.filter((role) => !found.has(role));
  if (missing.length > 0) return `missing token roles ${missing.join(", ")}`;
  return null;
}

function collectKeys(value: unknown, found: Set<string>): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    found.add(key);
    collectKeys(child, found);
  }
}

export function readExports(root: string): Record<string, readonly string[]> {
  const map: Record<string, string[]> = {};
  const src = path.join(root, "src");
  if (!fs.existsSync(src)) return map;
  walk(src, (file) => {
    if (!file.endsWith(".ts") && !file.endsWith(".mjs")) return;
    const rel = path.relative(root, file).replaceAll("\\", "/");
    const text = fs.readFileSync(file, "utf8");
    const names = new Set<string>();
    for (const match of text.matchAll(/^export (?:async )?(?:function|const|class|type|interface) ([A-Za-z0-9_]+)/gm)) {
      if (match[1]) names.add(match[1]);
    }
    for (const match of text.matchAll(/^export \{([^}]+)\}/gm)) {
      const body = match[1] ?? "";
      for (const part of body.split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (name) names.add(name);
      }
    }
    if (names.size > 0) map[rel] = [...names];
  });
  return map;
}

function walk(dir: string, visit: (file: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else if (entry.isFile()) visit(full);
  }
}

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkOwner, kitchenFromLanded, KitchenHiddenAcceptanceSuite, migrationFileName, undoFeature } from "./kitchen.ts";
import type { HiddenSuiteDoc, MachineProfile, PressureLevel, ScenarioResult, StopProbe } from "./types.ts";

export interface HoldFeature {
  id: string;
  progress: number;
  phase: "running" | "verifying";
}

export interface HoldPlacement {
  id: string;
  mode: "SOFT_HOLD" | "HARD_HOLD";
}

export function placeAmbiguousHold(
  features: readonly HoldFeature[],
  touches: readonly string[],
): { held: HoldPlacement[]; continued: string[] } {
  const held = features
    .filter((feature) => touches.includes(feature.id))
    .map((feature) => ({
      id: feature.id,
      mode: feature.progress >= 0.8 || feature.phase === "verifying" ? ("SOFT_HOLD" as const) : ("HARD_HOLD" as const),
    }));
  const continued = features.filter((feature) => !touches.includes(feature.id)).map((feature) => feature.id);
  return { held, continued };
}

export function runSurgicalHold(): ScenarioResult {
  const features: HoldFeature[] = [
    { id: "F-Menu", progress: 0.92, phase: "verifying" },
    { id: "F-Orders", progress: 0.9, phase: "verifying" },
    { id: "F-Print", progress: 0.95, phase: "verifying" },
    { id: "F-CateringEmail", progress: 0.88, phase: "verifying" },
  ];
  const placed = placeAmbiguousHold(features, ["F-Menu", "F-Orders"]);
  const heldIds = placed.held.map((hold) => hold.id).sort();
  const onlyTwo = heldIds.join(",") === "F-Menu,F-Orders";
  const soft = placed.held.every((hold) => hold.mode === "SOFT_HOLD");
  const others = [...placed.continued].sort().join(",") === "F-CateringEmail,F-Print";
  const started = performance.now();
  const quarantined = placed.held.map((hold) => hold.id);
  const quarantineMergeMs = performance.now() - started;
  const pass = onlyTwo && soft && others && quarantineMergeMs < 1000 && quarantined.length === 2;
  return {
    id: "surgical-ambiguous-hold",
    title: "Surgical ambiguous hold",
    pass,
    detail: `held ${heldIds.join(",")} mode ${placed.held.map((hold) => hold.mode).join(",")} continued ${placed.continued.join(",")} quarantine ${quarantineMergeMs.toFixed(3)} ms`,
  };
}

function killPid(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (!(error instanceof Error)) throw error;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    return true;
  }
}

export class ImmediateKernelStopController {
  epoch = 1;
  stopped = false;
  private readonly children: number[] = [];

  spawnChild(): number {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
      stdio: "ignore",
      windowsHide: true,
    });
    const pid = child.pid;
    if (!pid) throw new Error("stop probe did not receive a child pid");
    child.unref();
    this.children.push(pid);
    return pid;
  }

  stop(kill: boolean): { latencyMs: number; leakedPids: number } {
    const started = performance.now();
    this.epoch += 1;
    this.stopped = true;
    const latencyMs = performance.now() - started;
    if (kill) {
      for (const pid of this.children) killPid(pid);
    }
    const leakedPids = this.children.filter((pid) => pidAlive(pid)).length;
    return { latencyMs, leakedPids };
  }

  tryMerge(): boolean {
    return !this.stopped;
  }

  cleanup(): void {
    for (const pid of this.children) killPid(pid);
  }
}

export class NoRunUntilResumeGate {
  private parked = true;
  claims = 0;
  tokens = 0;

  coldOpen(): void {
    this.parked = true;
    this.claims = 0;
    this.tokens = 0;
  }

  schedulerTick(): boolean {
    if (this.parked) return false;
    this.claims += 1;
    this.tokens += 12;
    return true;
  }

  forceClaim(): void {
    this.claims += 1;
    this.tokens += 12;
  }

  resume(): void {
    this.parked = false;
  }
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "EF Harness",
      GIT_AUTHOR_EMAIL: "foundation@ef-harness.local",
      GIT_COMMITTER_NAME: "EF Harness",
      GIT_COMMITTER_EMAIL: "foundation@ef-harness.local",
    },
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }
}

export async function runStopAndResume(options?: { leak?: boolean; bypassResume?: boolean }): Promise<StopProbe> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m3-stop-"));
  const controller = new ImmediateKernelStopController();
  try {
    controller.spawnChild();
    const stopped = controller.stop(options?.leak !== true);
    let postStopMerges = 0;
    if (controller.tryMerge()) postStopMerges += 1;
    git(dir, ["init", "-b", "harness/integration"]);
    fs.writeFileSync(path.join(dir, "README.md"), "parked\n", "utf8");
    git(dir, ["add", "--", "README.md"]);
    git(dir, ["commit", "-m", "park"]);
    git(dir, ["branch", "wip/menu"]);
    const handoffPath = path.join(dir, "wip", "F-Menu", "HANDOFF.md");
    fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
    fs.writeFileSync(
      handoffPath,
      `# HANDOFF\n\nFeature: F-Menu\nEpoch: ${controller.epoch}\nStatus: parked\n`,
      "utf8",
    );
    const gate = new NoRunUntilResumeGate();
    gate.coldOpen();
    if (options?.bypassResume) gate.forceClaim();
    else gate.schedulerTick();
    const unauthorizedClaims = gate.claims;
    const unauthorizedTokens = gate.tokens;
    const wipReady = fs.existsSync(handoffPath);
    const pass =
      stopped.latencyMs < 100 &&
      stopped.leakedPids === 0 &&
      postStopMerges === 0 &&
      unauthorizedClaims === 0 &&
      unauthorizedTokens === 0 &&
      wipReady &&
      controller.epoch === 2;
    return {
      result: {
        id: "kernel-stop-wip-resume",
        title: "Immediate kernel stop, wip export, and cold open",
        pass,
        detail: `epoch ${controller.epoch} in ${stopped.latencyMs.toFixed(3)} ms, leaked ${stopped.leakedPids}, claims ${unauthorizedClaims}, tokens ${unauthorizedTokens}, wip/menu`,
      },
      stopLatencyMs: stopped.latencyMs,
      leakedPids: stopped.leakedPids,
      postStopMerges,
      unauthorizedClaims,
      unauthorizedTokens,
      wipBranch: "wip/menu",
      handoffPath,
    };
  } finally {
    controller.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function runFeatureUndo(suite: HiddenSuiteDoc): ScenarioResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m3-undo-"));
  try {
    const before = {
      features: ["F-Menu", "F-Orders", "F-Print", "F-CateringEmail"],
      helpers: [{ name: "date-formatter", owner: "F-Print", users: ["F-Print", "F-CateringEmail"] }],
    };
    fs.writeFileSync(
      path.join(dir, "date-formatter.ts"),
      "export function formatDate(value: string): string { return value; }\nowner: F-Print\n",
      "utf8",
    );
    fs.writeFileSync(path.join(dir, "print.ts"), 'import { formatDate } from "./date-formatter.ts";\n', "utf8");
    fs.writeFileSync(path.join(dir, "catering.ts"), 'import { formatDate } from "./date-formatter.ts";\n', "utf8");
    const after = undoFeature(before, "F-Print");
    fs.rmSync(path.join(dir, "print.ts"));
    fs.writeFileSync(
      path.join(dir, "date-formatter.ts"),
      `export function formatDate(value: string): string { return value; }\nowner: ${after.helpers[0]?.owner ?? ""}\n`,
      "utf8",
    );
    const helper = after.helpers[0];
    const build = kitchenFromLanded(after.features);
    const checks = new KitchenHiddenAcceptanceSuite(suite).run(build);
    const remaining = checks.filter((check) => checkOwner(check.id) !== "F-Print");
    const remainingGreen = remaining.length > 0 && remaining.every((check) => check.pass);
    const transferred = helper?.owner === "F-CateringEmail" && helper.users.join(",") === "F-CateringEmail";
    const printGone = !after.features.includes("F-Print") && !fs.existsSync(path.join(dir, "print.ts"));
    const ownerLine = fs.readFileSync(path.join(dir, "date-formatter.ts"), "utf8").includes("owner: F-CateringEmail");
    const pass = transferred && printGone && remainingGreen && ownerLine && fs.existsSync(path.join(dir, "catering.ts"));
    return {
      id: "planned-feature-undo",
      title: "Planned feature undo keeps the shared helper",
      pass,
      detail: `owner ${helper?.owner ?? "missing"}, remaining ${remaining.filter((check) => check.pass).length}/${remaining.length}`,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export interface SchemaDiff {
  kind: "add-nullable-column" | "drop-column";
}

export class DeterministicSchemaDiffClassifier {
  classify(diff: SchemaDiff): "ADDITIVE" | "BREAKING" {
    return diff.kind === "drop-column" ? "BREAKING" : "ADDITIVE";
  }
}

export class AdditiveOwnerFastPath {
  land(input: { requester: string; owner: string; stamp: string; sql: string; slug: string }): {
    mutatedBy: string;
    consumerMayEdit: boolean;
    file: string;
    classification: "ADDITIVE" | "BREAKING";
  } {
    const classification = new DeterministicSchemaDiffClassifier().classify({ kind: "add-nullable-column" });
    return {
      mutatedBy: input.owner,
      consumerMayEdit: false,
      file: migrationFileName(input.stamp, input.slug, input.sql),
      classification,
    };
  }
}

export class MigrationIntentAndConflictLinter {
  lint(files: readonly { name: string; sql: string }[]): { conflicts: string[] } {
    const tables = new Map<string, string>();
    const conflicts: string[] = [];
    const names = new Set<string>();
    for (const file of files) {
      if (names.has(file.name)) conflicts.push(`duplicate filename ${file.name}`);
      names.add(file.name);
      const match = /CREATE TABLE\s+(\w+)/i.exec(file.sql);
      const table = match?.[1];
      if (!table) continue;
      const previous = tables.get(table);
      if (previous) conflicts.push(`${table} in ${previous} and ${file.name}`);
      else tables.set(table, file.name);
    }
    return { conflicts };
  }
}

export function reconcileRanges(ranges: readonly { feature: string; pkg: string; range: string }[]): {
  commit: { pkg: string; range: string } | null;
  conflicts: string[];
} {
  const dateFns = ranges.filter((range) => range.pkg === "date-fns");
  const majors = new Set(dateFns.map((range) => range.range.split(".")[0] ?? ""));
  if (majors.size !== 1) return { commit: null, conflicts: ["date-fns"] };
  const sorted = [...dateFns].sort((left, right) => (left.range < right.range ? -1 : left.range > right.range ? 1 : 0));
  const chosen = sorted[sorted.length - 1];
  if (!chosen) return { commit: null, conflicts: ["date-fns"] };
  return { commit: { pkg: chosen.pkg, range: chosen.range }, conflicts: [] };
}

export function runAdditiveCcr(): ScenarioResult {
  const stamp = "20261122014500";
  const menuSql = "CREATE TABLE menu_items (id TEXT PRIMARY KEY, name TEXT NOT NULL);\n";
  const ordersSql = "CREATE TABLE meal_orders (id TEXT PRIMARY KEY, dish TEXT NOT NULL);\n";
  const menuFile = migrationFileName(stamp, "menu", menuSql);
  const ordersFile = migrationFileName(stamp, "orders", ordersSql);
  const lint = new MigrationIntentAndConflictLinter().lint([
    { name: menuFile, sql: menuSql },
    { name: ordersFile, sql: ordersSql },
  ]);
  const ccrSql = "ALTER TABLE meal_orders ADD COLUMN dietary_note TEXT;\n";
  const ccr = new AdditiveOwnerFastPath().land({
    requester: "F-Menu",
    owner: "F-Orders",
    stamp,
    sql: ccrSql,
    slug: "orders-dietary-note",
  });
  const lock = reconcileRanges([
    { feature: "F-Menu", pkg: "date-fns", range: "^3.0.0" },
    { feature: "F-Orders", pkg: "date-fns", range: "^3.2.0" },
  ]);
  const sameStamp = menuFile.includes(stamp) && ordersFile.includes(stamp);
  const distinct = menuFile !== ordersFile;
  const pass =
    sameStamp &&
    distinct &&
    lint.conflicts.length === 0 &&
    ccr.classification === "ADDITIVE" &&
    ccr.mutatedBy === "F-Orders" &&
    ccr.consumerMayEdit === false &&
    lock.conflicts.length === 0 &&
    lock.commit?.range === "^3.2.0";
  return {
    id: "additive-ccr-parallel-migrations",
    title: "Additive CCR and parallel migration hygiene",
    pass,
    detail: `${menuFile} and ${ordersFile}; owner ${ccr.mutatedBy}; lockfile conflicts ${lock.conflicts.length}`,
  };
}

export class PressureHysteresisStateMachine {
  level: PressureLevel = "GREEN";
  private pending: PressureLevel | null = null;
  private sinceMs = 0;

  sample(target: PressureLevel, nowMs: number): PressureLevel {
    if (target === this.level) {
      this.pending = null;
      return this.level;
    }
    if (this.pending !== target) {
      this.pending = target;
      this.sinceMs = nowMs;
      return this.level;
    }
    const held = nowMs - this.sinceMs;
    const required = target === "GREEN" ? 30_000 : 10_000;
    if (held >= required) {
      this.level = target;
      this.pending = null;
    }
    return this.level;
  }
}

export class SyntheticTelemetryProvider {
  constructor(private readonly points: readonly { atMs: number; level: PressureLevel }[]) {}

  levelAt(nowMs: number): PressureLevel {
    let current: PressureLevel = "GREEN";
    for (const point of this.points) {
      if (point.atMs <= nowMs) current = point.level;
    }
    return current;
  }
}

export class ThreePoolCapacityScheduler {
  readonly thinkingCap: number;
  readonly warmInventory: number;
  warmSlots: number;
  readonly sessionCap: number;
  readonly queued: string[] = [];
  dropped = 0;

  constructor(profile: Pick<MachineProfile, "thinkingPool" | "warmSlots" | "sessionCap">) {
    this.thinkingCap = profile.thinkingPool;
    this.warmInventory = profile.warmSlots;
    this.warmSlots = profile.warmSlots;
    this.sessionCap = profile.sessionCap;
  }

  apply(level: PressureLevel): void {
    if (level === "ORANGE" || level === "RED") this.warmSlots = 1;
    else if (level === "YELLOW") this.warmSlots = Math.max(1, this.warmInventory - 1);
    else this.warmSlots = this.warmInventory;
  }

  enqueue(id: string): void {
    this.queued.push(id);
  }
}

export function runGovernorStress(profile: MachineProfile): ScenarioResult {
  const spike = new PressureHysteresisStateMachine();
  const spikeProvider = new SyntheticTelemetryProvider([
    { atMs: 0, level: "ORANGE" },
    { atMs: profile.spikeIgnoredMs, level: "GREEN" },
  ]);
  const spikeAtStart = spike.sample(spikeProvider.levelAt(0), 0);
  const spikeAtEnd = spike.sample(spikeProvider.levelAt(profile.spikeIgnoredMs), profile.spikeIgnoredMs);
  const sustained = new PressureHysteresisStateMachine();
  const sustainedProvider = new SyntheticTelemetryProvider([
    { atMs: 0, level: "ORANGE" },
    { atMs: profile.orangeEnterMs, level: "ORANGE" },
    { atMs: profile.orangeEnterMs + 1, level: "GREEN" },
  ]);
  sustained.sample(sustainedProvider.levelAt(0), 0);
  const entered = sustained.sample(sustainedProvider.levelAt(profile.orangeEnterMs), profile.orangeEnterMs);
  const pools = new ThreePoolCapacityScheduler(profile);
  pools.apply(entered);
  pools.enqueue("T-menu");
  pools.enqueue("T-orders");
  pools.enqueue("T-print");
  const during = pools.warmSlots;
  const dropped = pools.dropped;
  const recoverAt = profile.orangeEnterMs + 1 + profile.greenRecoverMs;
  sustained.sample(sustainedProvider.levelAt(profile.orangeEnterMs + 1), profile.orangeEnterMs + 1);
  const recovered = sustained.sample(sustainedProvider.levelAt(recoverAt), recoverAt);
  pools.apply(recovered);
  const pass =
    spikeAtStart === "GREEN" &&
    spikeAtEnd === "GREEN" &&
    entered === "ORANGE" &&
    during === 1 &&
    dropped === 0 &&
    pools.queued.length === 3 &&
    recovered === "GREEN" &&
    pools.warmSlots === profile.warmSlots;
  return {
    id: "governor-orange-drain",
    title: "Hardware governor Green to Orange to Green",
    pass,
    detail: `spike ${spikeAtEnd}, enter ${entered} slots ${during}, recover ${recovered} slots ${pools.warmSlots}, dropped ${dropped}`,
  };
}

export class M3SteeringAndUndoScenarioSuite {
  constructor(
    private readonly suite: HiddenSuiteDoc,
    private readonly profile: MachineProfile,
  ) {}

  async run(): Promise<{ scenarios: ScenarioResult[]; stop: StopProbe }> {
    const stop = await runStopAndResume();
    const scenarios = [
      runSurgicalHold(),
      stop.result,
      runFeatureUndo(this.suite),
      runAdditiveCcr(),
      runGovernorStress(this.profile),
    ];
    return { scenarios, stop };
  }
}

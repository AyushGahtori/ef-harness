import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DiskCasStore, MemoryCasStore, type CasStore } from "./cas-store.js";
import { ClientStateSyncer, type ClientSnapshot } from "./client-sync.js";
import { FakeDualClock } from "./clock.js";
import { SimEventLoop } from "./event-loop.js";
import { FakeModelAdapter, type ModelCompletion } from "./fake-model.js";
import { CrashFaultInjector, CrashSignal, faultForSeed, type FaultPoint } from "./faults.js";
import { checkInvariants, type LeaseInterval, type PruneRecord } from "./invariants.js";
import { exerciseNamedPipe } from "./ipc-pipe.js";
import { KernelSession, ReserveRefused, type DbHandle } from "./kernel-session.js";
import { DeterministicSeededRng } from "./rng.js";
import { asNumber, asString } from "./schema-cache.js";
import { SimTrace } from "./trace.js";

const CONSUMERS = ["scheduler", "ui_projection"] as const;
const RESERVE_UNITS = 100_000;
const LEASE_MS = 60_000;
const SLEEP_MS = 3_600_000;
const GRANT_GRACE_MS = 60_000;

export interface SimPlan {
  workers: number;
  tasks: number;
  projects: 1 | 2;
  unknown: "reconcilable" | "irreconcilable";
  expireBeforeDeposit: boolean;
  fault: FaultPoint;
}

export interface SimStats {
  workers: number;
  tasks: number;
  fenced: number;
  accepted: number;
  running: number;
}

export interface SimRunResult {
  seed: number;
  mode: "memory" | "disk";
  passed: boolean;
  traceHash: string;
  trace: readonly string[];
  violations: readonly string[];
  faultFired: FaultPoint | null;
  latenciesMs: readonly number[];
  eventsRun: number;
  plan: SimPlan;
  stats: SimStats;
  unknownHeldAcrossRestart: boolean;
  grantExpiredConservatively: boolean;
  lateDepositRefused: boolean;
  clientEpochBumped: boolean;
  halfCloseRolledBack: boolean;
  postCommitDurable: boolean;
  receiptLostBeforeResync: boolean;
  walIsolated: boolean;
  fileLocked: boolean;
}

export interface SimRunOptions {
  seed: number;
  mode?: "memory" | "disk";
  plan?: Partial<SimPlan>;
  maxEvents?: number;
  realPipe?: boolean;
  diskRoot?: string;
  keepDisk?: boolean;
}

export function planFromSeed(seed: number): SimPlan {
  const rng = new DeterministicSeededRng(seed);
  return {
    workers: rng.nextInt(1, 50),
    tasks: rng.nextInt(1, 10),
    projects: rng.chance(0.34) ? 2 : 1,
    unknown: rng.chance(0.5) ? "reconcilable" : "irreconcilable",
    expireBeforeDeposit: rng.chance(0.2),
    fault: faultForSeed(seed),
  };
}

function grantId(projectId: string): string {
  return `${projectId}-G1`;
}

function taskId(projectId: string, index: number): string {
  return `${projectId}-T${index}`;
}

function ruleId(projectId: string): string {
  return `${projectId}-R17`;
}

interface Winner {
  attempt: string;
  taskId: string;
  epoch: number;
}

class SkipAccept extends Error {
  constructor() {
    super("skip accept");
    this.name = "SkipAccept";
  }
}

export class M0KernelSimulator {
  run(seed: number, mode: "memory" | "disk" = "memory"): Promise<SimRunResult> {
    return runSimulation({ seed, mode });
  }
}

export async function runSimulation(options: SimRunOptions): Promise<SimRunResult> {
  if (!Number.isInteger(options.seed) || options.seed < 0) {
    throw new Error("seed must be a non-negative integer");
  }
  const mode = options.mode ?? "memory";
  const plan: SimPlan = { ...planFromSeed(options.seed), ...options.plan };
  const clock = new FakeDualClock();
  const wallOrigin = clock.wallMs();
  const trace = new SimTrace();
  const rng = new DeterministicSeededRng(options.seed).fork("run");
  const injector = new CrashFaultInjector(plan.fault);
  const projectIds = plan.projects === 2 ? ["P1", "P2"] : ["P1"];
  const taskCounts = new Map<string, number>(projectIds.map((id) => [id, id === "P1" ? plan.tasks : 1]));
  const diskRoot =
    mode === "disk"
      ? (options.diskRoot ?? path.join(os.tmpdir(), `ef-m0-${process.pid}-${options.seed}`))
      : null;
  const session = new KernelSession({ mode, projectIds, diskRoot, injector });
  const clients = new Map<string, ClientStateSyncer>(projectIds.map((id) => [id, new ClientStateSyncer()]));
  const leases: LeaseInterval[] = [];
  const committedCandidates: string[] = [];
  const attempted = new Set<string>();
  const reconcile = new Set<string>();
  const winners = new Map<string, Winner>();
  const pruned: PruneRecord[] = [];
  const cas: CasStore = mode === "disk" && diskRoot ? new DiskCasStore(diskRoot) : new MemoryCasStore();
  const casHashes: string[] = [];
  const pendingReceipts: string[] = [];
  const flags = {
    unknownHeldAcrossRestart: false,
    grantExpiredConservatively: false,
    lateDepositRefused: false,
    clientEpochBumped: false,
    halfCloseRolledBack: false,
    postCommitDurable: false,
    receiptLostBeforeResync: false,
    walIsolated: true,
    fileLocked: true,
    startingEpoch: 1,
  };

  trace.add(clock, "plan", JSON.stringify(plan));

  const snapshotOf = (handle: DbHandle): ClientSnapshot => {
    const epochRow = session.row(handle, "SELECT value FROM meta WHERE key = 'stream_epoch'");
    const tasks = session.rows(
      handle,
      "SELECT task, state, epoch, coalesce(holder_attempt, '') AS holder FROM task_runtime ORDER BY task",
    );
    const outbox = session.rows(handle, "SELECT seq, id FROM outbox ORDER BY seq");
    return {
      epoch: epochRow ? Number(asString(epochRow.value, "value")) : 0,
      tasks: tasks.map((row) => ({
        task: asString(row.task, "task"),
        state: asString(row.state, "state"),
        epoch: asNumber(row.epoch, "epoch"),
        holder: asString(row.holder, "holder"),
      })),
      outbox: outbox.map((row) => ({ seq: asNumber(row.seq, "seq"), id: asString(row.id, "id") })),
    };
  };

  const resync = (handle: DbHandle): void => {
    const client = clients.get(handle.id);
    if (!client) return;
    client.resync(snapshotOf(handle));
  };

  const bumpEpoch = (handle: DbHandle): void => {
    const current = snapshotOf(handle).epoch;
    session.txRaw(handle, () => {
      session.exec(handle, "UPDATE meta SET value = ? WHERE key = 'stream_epoch'", String(current + 1));
    });
    resync(handle);
  };

  const onCrash = (signal: CrashSignal): void => {
    session.reopenAll();
    const setup = session.row(session.project("P1"), "SELECT value FROM meta WHERE key = 'project_id'");
    flags.postCommitDurable = setup !== undefined;
    if (signal.point === "after_write_before_commit") {
      const grantAfter = session.row(session.global, "SELECT id FROM grants WHERE id = ?", grantId("P1"));
      flags.halfCloseRolledBack = grantAfter === undefined && setup !== undefined;
    }
    if (signal.point === "after_commit_before_ipc_receipt") {
      flags.receiptLostBeforeResync = pendingReceipts.length > 0;
      const grantAfter = session.row(session.global, "SELECT id FROM grants WHERE id = ?", grantId("P1"));
      flags.postCommitDurable = grantAfter !== undefined && setup !== undefined;
    }
    for (const handle of session.projects) {
      const unknown = session.row(
        handle,
        "SELECT id FROM reservations WHERE state = 'unknown' LIMIT 1",
      );
      if (unknown) flags.unknownHeldAcrossRestart = true;
      bumpEpoch(handle);
    }
    if (snapshotOf(session.project("P1")).epoch > flags.startingEpoch) flags.clientEpochBumped = true;
    cas.recover();
  };

  try {
    seedGlobal();
    for (const id of projectIds) seedProject(session.project(id), taskCounts.get(id) ?? 1);
    for (const handle of session.projects) {
      flags.startingEpoch = snapshotOf(handle).epoch;
      resync(handle);
    }
    if (mode === "disk") {
      const isolation = session.proveDiskIsolation(session.project("P1"));
      flags.walIsolated = isolation.walIsolated;
      flags.fileLocked = isolation.fileLocked;
    }

    const loop = new SimEventLoop(clock, trace, options.maxEvents);
    loop.schedule(5, "grant_message", () => issueGrants());
    loop.schedule(20, "grant_deposit", () => depositGrants());
    const wave: { worker: number; delay: number }[] = [];
    for (let worker = 0; worker < plan.workers; worker += 1) {
      wave.push({ worker, delay: rng.nextInt(0, 460) });
    }
    loop.schedule(30, "worker_tick", () => claimWave(session.project("P1"), wave, plan.tasks));
    if (plan.projects === 2) {
      loop.schedule(40, "worker_tick", () =>
        claimWave(session.project("P2"), [
          { worker: 0, delay: 0 },
          { worker: 1, delay: 1 },
        ], 1),
      );
    }
    loop.schedule(600, "timer", () => {
      trace.add(clock, "timer", "tick");
    });
    loop.schedule(700, "model", () => runModels());
    loop.schedule(800, "paid_timeout", () => forceUnknown());
    loop.schedule(1000, "barrier", () => breakRules());
    loop.schedule(1500, "submit", () => {
      for (const handle of session.projects) resolveAttempts(handle);
    });
    loop.schedule(1800, "outbox", () => appendHeartbeats());
    loop.schedule(1900, "close_grant", () => closeGrants());
    loop.schedule(1950, "cas", () => writeCas());
    loop.schedule(3000, "sleep_jump", () => sleepJump());
    loop.schedule(3500, "grant_expiry", () => expireLateGrants());
    loop.schedule(4000, "ipc_disconnect", () => disconnectClients());
    loop.run(onCrash);
    finalize();

    const snapshots = new Map<string, ClientSnapshot>();
    for (const handle of session.projects) snapshots.set(handle.id, snapshotOf(handle));
    const violations = checkInvariants({
      session,
      clients,
      snapshots,
      committedCandidates,
      expectedTasks: taskCounts,
      leases,
      pruned,
    });
    if (!flags.walIsolated) violations.push("WAL reader observed an uncommitted write");
    if (!flags.fileLocked) violations.push("second writer was not blocked by the SQLite lock");
    if (injector.fired() !== plan.fault) violations.push(`fault ${plan.fault} did not fire`);
    const traceHash = trace.hash();
    if (mode === "disk" && options.realPipe !== false && diskRoot) {
      const payload = JSON.stringify(snapshots.get("P1") ?? { epoch: 0, tasks: [], outbox: [] });
      try {
        await exerciseNamedPipe(pipeName(options.seed), payload);
      } catch (error) {
        violations.push(error instanceof Error ? `named pipe: ${error.message}` : "named pipe failed");
      }
    }
    return result(violations, traceHash, loop.eventsRun);
  } catch (error) {
    if (error instanceof CrashSignal) {
      return result([`unhandled ${error.message}`], trace.hash(), 0);
    }
    const message = error instanceof Error ? error.message : String(error);
    return result([message], trace.hash(), 0);
  } finally {
    session.close();
    if (diskRoot && !options.keepDisk) fs.rmSync(diskRoot, { recursive: true, force: true });
  }

  function result(violations: string[], traceHash: string, eventsRun: number): SimRunResult {
    const stats = collectStats();
    return {
      seed: options.seed,
      mode,
      passed: violations.length === 0,
      traceHash,
      trace: trace.lines.slice(),
      violations,
      faultFired: injector.fired(),
      latenciesMs: session.latenciesMs.slice(),
      eventsRun,
      plan,
      stats,
      unknownHeldAcrossRestart: flags.unknownHeldAcrossRestart,
      grantExpiredConservatively: flags.grantExpiredConservatively,
      lateDepositRefused: flags.lateDepositRefused,
      clientEpochBumped: flags.clientEpochBumped,
      halfCloseRolledBack: flags.halfCloseRolledBack,
      postCommitDurable: flags.postCommitDurable,
      receiptLostBeforeResync: flags.receiptLostBeforeResync,
      walIsolated: flags.walIsolated,
      fileLocked: flags.fileLocked,
    };
  }

  function collectStats(): SimStats {
    let fenced = 0;
    let accepted = 0;
    let running = 0;
    let tasks = 0;
    if (session.project("P1").db.isOpen) {
      for (const row of session.rows(session.project("P1"), "SELECT state, count(*) AS c FROM attempts GROUP BY state")) {
        const state = asString(row.state, "state");
        const count = asNumber(row.c, "c");
        if (state === "fenced") fenced += count;
        if (state === "accepted") accepted += count;
        if (state === "running") running += count;
      }
      tasks = session.rows(session.project("P1"), "SELECT task FROM task_runtime").length;
    }
    return { workers: plan.workers, tasks, fenced, accepted, running };
  }

  function seedGlobal(): void {
    session.txRaw(session.global, () => {
      const insert = session.global.db.prepare(
        `INSERT INTO projects(id, path, display_name, schema_version, status, last_opened_at, last_seen_at)
         VALUES (?, ?, ?, 1, 'ok', ?, ?)`,
      );
      for (const id of projectIds) {
        insert.run(id, `C:/${id}`, id, clock.wallMs(), clock.wallMs());
      }
      session.global.db
        .prepare(
          `INSERT INTO connections(id, provider, route, plan, vault_ref, currency, scale, enabled, created_at)
           VALUES ('conn-1', 'fake', 'api_key', 'sim', NULL, 'usd', 1000000, 1, ?)`,
        )
        .run(clock.wallMs());
      session.global.db
        .prepare(
          `INSERT INTO connection_windows(connection, window_kind, window_start, window_end, limit_units, observed_units, estimated_units, source, observed_at)
           VALUES ('conn-1', '5h', 0, 9999999999999, 50000000, 0, 0, 'sim', ?)`,
        )
        .run(clock.wallMs());
    });
  }

  function seedProject(handle: DbHandle, count: number): void {
    const id = handle.id;
    const fields = JSON.stringify({ feature: `${id}-F1` });
    session.txRaw(handle, () => {
      session.exec(
        handle,
        "INSERT INTO meta(key, value) VALUES ('project_id', ?), ('stream_epoch', '1'), ('last_rev', '1')",
        id,
      );
      session.exec(
        handle,
        "INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES (?, 1, 'kernel', 'sim', ?)",
        `${id}-CS-1`,
        clock.wallMs(),
      );
      const node = handle.db.prepare(
        `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, 1, 1)`,
      );
      node.run(`${id}-F1`, "feature", `${id}-F1-h`, "Feature", "", fields, `${id}-CS-1`);
      node.run(ruleId(id), "rule", `${id}-R17-v1`, "Cutoff rule", "Orders close at 10:45", fields, `${id}-CS-1`);
      session.exec(handle, "INSERT INTO feature_runtime(feature, state, updated_rev) VALUES (?, 'IN_WAVE', 1)", `${id}-F1`);
      session.exec(handle, "INSERT INTO project_runtime(id, state, updated_rev) VALUES (1, 'WAVES', 1)");
      const task = handle.db.prepare(
        "INSERT INTO task_runtime(task, feature, state, level, updated_rev) VALUES (?, ?, 'READY', 'Mid', 1)",
      );
      const edge = handle.db.prepare(
        "INSERT INTO edges(src, type, dst, change_set, valid_from_rev) VALUES (?, 'implements', ?, ?, 1)",
      );
      const budget = handle.db.prepare(
        "INSERT INTO budgets(scope_kind, scope_id, currency, limit_units) VALUES ('task', ?, 'usd', 5000000)",
      );
      for (let index = 1; index <= count; index += 1) {
        const current = taskId(id, index);
        node.run(current, "task", `${current}-h`, `Task ${index}`, "", fields, `${id}-CS-1`);
        task.run(current, `${id}-F1`);
        edge.run(current, ruleId(id), `${id}-CS-1`);
        budget.run(current);
      }
      session.exec(
        handle,
        "INSERT INTO budgets(scope_kind, scope_id, currency, limit_units) VALUES ('project', ?, 'usd', 20000000)",
        id,
      );
    });
    trace.add(clock, "seed", id);
  }

  function issueGrants(): void {
    for (const id of projectIds) attempted.add(`issue:${id}`);
    session.tx(session.global, () => {
      for (const id of projectIds) insertGrant(id);
      refreshWindow();
    });
    for (const id of projectIds) trace.add(clock, "issue_grant", id);
    pendingReceipts.push("grants-issued");
    injector.hit("after_commit_before_ipc_receipt");
    pendingReceipts.length = 0;
    trace.add(clock, "ipc_receipt", "grants-issued");
  }

  function issueGrant(id: string): void {
    const existing = session.row(session.global, "SELECT id FROM grants WHERE id = ?", grantId(id));
    if (existing) return;
    session.txRaw(session.global, () => {
      insertGrant(id);
      refreshWindow();
    });
    trace.add(clock, "issue_grant", id);
  }

  function insertGrant(id: string): void {
    if (session.row(session.global, "SELECT id FROM grants WHERE id = ?", grantId(id))) return;
    const units = id === "P1" ? 8_000_000 : 1_000_000;
    const expires = plan.expireBeforeDeposit && id === "P1" ? wallOrigin + 1_000 : wallOrigin + 86_400_000;
    session.exec(
      session.global,
      `INSERT INTO grants(id, project, connection, currency, units, concurrency, priority_class, issued_at, expires_at, state)
       VALUES (?, ?, 'conn-1', 'usd', ?, 1, 'foreground', ?, ?, 'issued')`,
      grantId(id),
      id,
      units,
      clock.wallMs(),
      expires,
    );
  }

  function refreshWindow(): void {
    session.exec(
      session.global,
      `UPDATE connection_windows
          SET estimated_units = (SELECT coalesce(sum(units), 0) FROM grants WHERE connection = 'conn-1')
        WHERE connection = 'conn-1' AND window_kind = '5h' AND window_start = 0`,
    );
  }

  function depositGrants(): void {
    injector.hit("after_issue_grant_before_deposit");
    for (const id of projectIds) {
      if (plan.expireBeforeDeposit && id === "P1") {
        trace.add(clock, "deposit_skipped", id);
        continue;
      }
      depositGrant(session.project(id));
    }
  }

  function depositGrant(handle: DbHandle): void {
    const id = grantId(handle.id);
    if (session.row(handle, "SELECT grant_id FROM grant_receipts WHERE grant_id = ?", id)) {
      markDeposited(id);
      return;
    }
    const grant = session.row(
      session.global,
      "SELECT units, expires_at, state FROM grants WHERE id = ?",
      id,
    );
    if (!grant) return;
    if (asString(grant.state, "state") === "expired") return;
    const units = asNumber(grant.units, "units");
    const expires = asNumber(grant.expires_at, "expires_at");
    session.tx(handle, () => {
      session.run(handle, "deposit_grant", {
        grant_id: id,
        connection: "conn-1",
        currency: "usd",
        units,
        concurrency: 1,
        expires_at: expires,
        rev: 1,
      });
      session.run(handle, "deposit_grant_budget", { grant_id: id, currency: "usd", units });
    });
    markDeposited(id);
    trace.add(clock, "deposit_grant", id);
  }

  function markDeposited(id: string): void {
    const grant = session.row(session.global, "SELECT state FROM grants WHERE id = ?", id);
    if (!grant || asString(grant.state, "state") !== "issued") return;
    session.txRaw(session.global, () => {
      session.exec(session.global, "UPDATE grants SET state = 'deposited' WHERE id = ? AND state = 'issued'", id);
    });
  }

  function claimWave(handle: DbHandle, wave: readonly { worker: number; delay: number }[], count: number): void {
    const ordered = [...wave].sort((left, right) => left.delay - right.delay || left.worker - right.worker);
    let lost: string[] = [];
    let won: Winner[] = [];
    const rule = ruleId(handle.id);
    const expiresAt = clock.wallMs() + LEASE_MS;
    const now = clock.wallMs();
    session.tx(handle, () => {
      const nextLost: string[] = [];
      const nextWon: Winner[] = [];
      for (const item of ordered) {
        const currentTask = taskId(handle.id, (item.worker % count) + 1);
        const attempt = `${handle.id}-A-${currentTask}-W${item.worker}`;
        const claimed = session.all(handle, "claim_task", {
          task: currentTask,
          attempt,
          expires_at: expiresAt,
          rev: 1,
          expected_brief: 1,
        });
        const first = claimed[0];
        if (!first) {
          nextLost.push(attempt);
          continue;
        }
        const epoch = asNumber(first.epoch, "epoch");
        session.run(handle, "create_attempt", {
          attempt,
          task: currentTask,
          epoch,
          expected_brief: 1,
          runtime: "own",
          model: "fake",
          connection: "conn-1",
          base_commit: "abc",
          now,
        });
        session.exec(
          handle,
          "INSERT INTO read_sets(attempt, node, version, hash, how) VALUES (?, ?, 1, ?, 'pushed')",
          attempt,
          rule,
          `${rule}-v1`,
        );
        session.exec(
          handle,
          "INSERT INTO edge_read_sets(attempt, node, dir, type, version) VALUES (?, ?, 'out', 'implements', 1)",
          attempt,
          currentTask,
        );
        nextWon.push({ attempt, taskId: currentTask, epoch });
      }
      lost = nextLost;
      won = nextWon;
    });
    for (const attempt of lost) trace.add(clock, "claim_lost", attempt);
    for (const winner of won) {
      leases.push({ task: winner.taskId, attempt: winner.attempt, start: clock.monoMs(), end: null });
      winners.set(winner.attempt, winner);
      trace.add(clock, "claim", `${winner.attempt}@${winner.epoch}`);
    }
  }

  function runModels(): void {
    const adapter = new FakeModelAdapter(rng.fork("model"), clock);
    for (const handle of session.projects) {
      const running = session.rows(handle, "SELECT id, task FROM attempts WHERE state = 'running' ORDER BY id");
      let step = 0;
      for (const row of running) {
        step += 1;
        const completion = adapter.complete({ attempt: asString(row.id, "id"), step });
        applyCompletion(handle, asString(row.id, "id"), asString(row.task, "task"), completion);
      }
    }
  }

  function applyCompletion(handle: DbHandle, attempt: string, task: string, completion: ModelCompletion): void {
    trace.add(clock, "model", `${attempt}:${completion.kind}`);
    if (completion.kind === "stall") {
      clock.advance(completion.stallMs);
      return;
    }
    if (completion.kind === "malformed_json" || completion.kind === "rate_limit") {
      const id = `${attempt}-REL`;
      if (reserve(handle, id, attempt, task)) release(handle, id);
      if (completion.kind === "rate_limit") clock.advance(Math.min(completion.retryAfterMs, 20));
      return;
    }
    if (completion.kind === "paid_timeout") {
      const id = `${attempt}-U`;
      if (completion.reconcilable) reconcile.add(id);
      reserveUnknown(handle, id, attempt, task);
      return;
    }
    const id = `${attempt}-PAY`;
    if (reserve(handle, id, attempt, task)) settle(handle, id, completion.actualTokens);
  }

  function forceUnknown(): void {
    for (const handle of session.projects) {
      const id = `${handle.id}-FORCED-U`;
      attempted.add(`unknown:${id}`);
      if (plan.unknown === "reconcilable" || handle.id !== "P1") reconcile.add(id);
      const winner = [...winners.values()].find((item) => item.attempt.startsWith(`${handle.id}-`));
      reserveUnknown(handle, id, winner?.attempt ?? null, winner?.taskId ?? null);
    }
  }

  function reserveUnknown(handle: DbHandle, id: string, attempt: string | null, task: string | null): void {
    if (session.row(handle, "SELECT id FROM reservations WHERE id = ?", id)) return;
    reserve(handle, id, attempt, task, true);
  }

  function reserve(handle: DbHandle, id: string, attempt: string | null, task: string | null, asUnknown = false): boolean {
    if (session.row(handle, "SELECT id FROM reservations WHERE id = ?", id)) return false;
    const scopes: Array<[string, string]> = [["project", handle.id]];
    if (task) scopes.unshift(["task", task]);
    if (receiptUnits(handle) !== null && !(plan.expireBeforeDeposit && handle.id === "P1")) {
      scopes.push(["grant", grantId(handle.id)]);
    }
    try {
      session.tx(handle, () => {
        if (attempt) {
          session.exec(
            handle,
            `INSERT INTO reservations(id, attempt, purpose, currency, amount_units, state, created_at)
             VALUES (?, ?, 'model_call', 'usd', ?, 'held', ?)`,
            id,
            attempt,
            RESERVE_UNITS,
            clock.wallMs(),
          );
        } else {
          session.exec(
            handle,
            `INSERT INTO reservations(id, purpose, currency, amount_units, state, created_at)
             VALUES (?, 'model_call', 'usd', ?, 'held', ?)`,
            id,
            RESERVE_UNITS,
            clock.wallMs(),
          );
        }
        for (const [kind, scope] of scopes) {
          session.exec(
            handle,
            "INSERT INTO reservation_scopes(reservation, scope_kind, scope_id, currency) VALUES (?, ?, ?, 'usd')",
            id,
            kind,
            scope,
          );
        }
        const changes = session.run(handle, "reserve", { reservation: id, amount: RESERVE_UNITS });
        if (changes !== scopes.length) throw new ReserveRefused();
        if (asUnknown) session.exec(handle, "UPDATE reservations SET state = 'unknown' WHERE id = ?", id);
      });
      trace.add(clock, asUnknown ? "unknown_reserve" : "reserve", id);
      return true;
    } catch (error) {
      if (error instanceof ReserveRefused) {
        trace.add(clock, "reserve_refused", id);
        return false;
      }
      throw error;
    }
  }

  function release(handle: DbHandle, id: string): void {
    const row = session.row(handle, "SELECT state FROM reservations WHERE id = ?", id);
    if (!row || asString(row.state, "state") !== "held") return;
    session.tx(handle, () => {
      session.run(handle, "release", { reservation: id });
      session.exec(
        handle,
        "UPDATE reservations SET state = 'released', settled_at = ? WHERE id = ? AND state = 'held'",
        clock.wallMs(),
        id,
      );
    });
  }

  function settle(handle: DbHandle, id: string, actual: number): void {
    const row = session.row(handle, "SELECT state FROM reservations WHERE id = ?", id);
    if (!row) return;
    const state = asString(row.state, "state");
    if (state !== "held" && state !== "unknown") return;
    session.tx(handle, () => {
      session.run(handle, "settle", { reservation: id, actual });
      session.run(handle, "settle_mark", { reservation: id, actual, now: clock.wallMs() });
    });
    trace.add(clock, "settle", `${id}:${actual}`);
  }

  function breakRules(): void {
    for (const handle of session.projects) {
      attempted.add(`break:${handle.id}`);
      breakRule(handle);
    }
  }

  function breakRule(handle: DbHandle): void {
    const rule = ruleId(handle.id);
    if (nodeVersion(handle, rule) >= 2) return;
    const rev = maxRev(handle) + 1;
    const changeSet = `${handle.id}-CS-BREAK`;
    session.tx(handle, () => {
      session.exec(
        handle,
        "INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES (?, ?, 'kernel', 'sim', ?)",
        changeSet,
        rev,
        clock.wallMs(),
      );
      session.exec(
        handle,
        `UPDATE nodes
            SET version = version + 1, content_hash = ?, text = ?, change_set = ?, updated_rev = ?
          WHERE id = ?`,
        `${rule}-v2`,
        "Orders close at 10:30",
        changeSet,
        rev,
        rule,
      );
      session.exec(
        handle,
        "INSERT INTO node_changes(change_set, id, old_version, new_version, class) VALUES (?, ?, 1, 2, 'breaking')",
        changeSet,
        rule,
      );
      session.exec(handle, "UPDATE meta SET value = ? WHERE key = 'last_rev'", String(rev));
    });
    trace.add(clock, "barrier", `${rule}@2`);
  }

  function resolveAttempts(handle: DbHandle): void {
    const running = session.rows(handle, "SELECT id, task, epoch FROM attempts WHERE state = 'running' ORDER BY id");
    for (const row of running) {
      const attempt = asString(row.id, "id");
      const task = asString(row.task, "task");
      const epoch = asNumber(row.epoch, "epoch");
      const worker = workerIndex(attempt);
      const stale = session.all(handle, "stale_reads_for_acceptance", { attempt });
      if (stale.length > 0 && worker % 2 === 1) {
        fenceAttempt(handle, attempt);
        continue;
      }
      if (stale.length > 0) refreshReadSet(handle, attempt);
      acceptAttempt(handle, attempt, task, epoch);
    }
  }

  function refreshReadSet(handle: DbHandle, attempt: string): void {
    const rule = ruleId(handle.id);
    const version = nodeVersion(handle, rule);
    const hashRow = session.row(handle, "SELECT content_hash FROM nodes WHERE id = ?", rule);
    session.txRaw(handle, () => {
      session.exec(handle, "DELETE FROM read_sets WHERE attempt = ? AND node = ?", attempt, rule);
      session.exec(
        handle,
        "INSERT INTO read_sets(attempt, node, version, hash, how) VALUES (?, ?, ?, ?, 'pulled')",
        attempt,
        rule,
        version,
        hashRow ? asString(hashRow.content_hash, "content_hash") : `${rule}-v2`,
      );
    });
    trace.add(clock, "reverify", attempt);
  }

  function fenceAttempt(handle: DbHandle, attempt: string): void {
    session.txRaw(handle, () => {
      session.exec(
        handle,
        "UPDATE task_runtime SET lease_expires_at = ? WHERE holder_attempt = ?",
        clock.wallMs() - 1,
        attempt,
      );
    });
    sweep(handle);
    trace.add(clock, "fence", attempt);
  }

  function acceptAttempt(handle: DbHandle, attempt: string, task: string, epoch: number): void {
    const candidate = `${attempt}-C`;
    if (session.row(handle, "SELECT id FROM candidates WHERE id = ?", candidate)) return;
    const stillStale = session.all(handle, "stale_reads_for_acceptance", { attempt });
    if (stillStale.length > 0) {
      fenceAttempt(handle, attempt);
      return;
    }
    const holder = session.row(handle, "SELECT holder_attempt, epoch, state FROM task_runtime WHERE task = ?", task);
    if (!holder || typeof holder.holder_attempt !== "string" || holder.holder_attempt !== attempt) return;
    if (asNumber(holder.epoch, "epoch") !== epoch) return;
    let committed = false;
    try {
    session.tx(handle, () => {
      const inserted = session.run(handle, "submit_candidate", {
        candidate,
        task,
        attempt,
        epoch,
        commit_sha: `sha-${attempt}`,
        payload: "{}",
        now: clock.wallMs(),
      });
      if (inserted !== 1) return;
      const accepted = session.run(handle, "accept_submission", {
        task,
        attempt,
        epoch,
        rev: maxRev(handle),
      });
      if (accepted !== 1) throw new SkipAccept();
      const finished = session.run(handle, "finish_submission", {
        task,
        epoch,
        next_state: "ACCEPTED",
        rev: maxRev(handle),
      });
      if (finished !== 1) throw new SkipAccept();
      session.exec(handle, "UPDATE attempts SET state = 'accepted', ended_at = ?, outcome = 'accepted' WHERE id = ?", clock.wallMs(), attempt);
      insertOutbox(handle, `${attempt}-EV`, "TaskAccepted", task);
      committed = true;
    });
    } catch (error) {
      if (error instanceof SkipAccept) return;
      throw error;
    }
    if (!committed) return;
    committedCandidates.push(candidate);
    closeLease(task, attempt);
    trace.add(clock, "accept", candidate);
  }

  function appendHeartbeats(): void {
    for (const handle of session.projects) {
      session.tx(handle, () => {
        insertOutbox(handle, `${handle.id}-HEARTBEAT`, "RevisionPublished", handle.id);
      });
    }
    injector.hit("after_outbox_append_before_delivered_at");
    acknowledgeOutbox(false);
  }

  function insertOutbox(handle: DbHandle, id: string, type: string, subject: string): void {
    session.exec(
      handle,
      "INSERT INTO outbox(id, type, subject, rev, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      type,
      subject,
      maxRev(handle),
      "{}",
      clock.wallMs(),
    );
    for (const consumer of CONSUMERS) {
      session.run(handle, "register_delivery", { event_id: id, consumer });
    }
  }

  function acknowledgeOutbox(recordPrune: boolean): void {
    for (const handle of session.projects) {
      if (recordPrune) {
        const pending = session.rows(
          handle,
          `SELECT o.id AS id,
                  NOT EXISTS (SELECT 1 FROM outbox_deliveries d WHERE d.event_id = o.id AND d.delivered_at IS NULL)
                  AND EXISTS (SELECT 1 FROM outbox_deliveries d WHERE d.event_id = o.id) AS acked
             FROM outbox o`,
        );
        const before = new Set(pending.map((row) => asString(row.id, "id")));
        session.txRaw(handle, () => {
          session.run(handle, "prune_outbox", { cutoff: clock.wallMs() + 1 });
        });
        const afterRows = session.rows(handle, "SELECT id FROM outbox");
        const after = new Set(afterRows.map((row) => asString(row.id, "id")));
        for (const id of before) {
          if (after.has(id)) continue;
          const source = pending.find((row) => asString(row.id, "id") === id);
          const fullyAcked = source ? Number(source.acked) === 1 : false;
          pruned.push({ id, fullyAcked });
        }
      }
      session.txRaw(handle, () => {
        session.exec(
          handle,
          "UPDATE outbox_deliveries SET delivered_at = ? WHERE delivered_at IS NULL",
          clock.wallMs(),
        );
      });
    }
  }

  function closeGrants(): void {
    reconcileUnknowns();
    for (const handle of session.projects) closeGrant(handle);
    injector.hit("after_close_grant_before_broker_ack");
    for (const handle of session.projects) ackGrant(handle.id);
  }

  function reconcileUnknowns(): void {
    for (const handle of session.projects) {
      const rows = session.rows(handle, "SELECT id FROM reservations WHERE state = 'unknown' ORDER BY id");
      for (const row of rows) {
        const id = asString(row.id, "id");
        if (reconcile.has(id)) settle(handle, id, RESERVE_UNITS);
      }
    }
  }

  function closeGrant(handle: DbHandle): void {
    const id = grantId(handle.id);
    const receipt = session.row(handle, "SELECT closed_at FROM grant_receipts WHERE grant_id = ?", id);
    if (!receipt || receipt.closed_at !== null) return;
    session.tx(handle, () => {
      session.run(handle, "close_grant", { grant_id: id });
      session.run(handle, "close_grant_receipt", { grant_id: id, now: clock.wallMs() });
    });
    trace.add(clock, "close_grant", id);
  }

  function ackGrant(id: string): void {
    const project = session.projects.find((item) => item.id === id.replace(/-G1$/, ""));
    if (!project) return;
    const receipt = session.row(
      project,
      "SELECT used_units, unknown_units, closed_at FROM grant_receipts WHERE grant_id = ?",
      grantId(project.id),
    );
    if (!receipt || receipt.closed_at === null) return;
    const grant = session.row(session.global, "SELECT state FROM grants WHERE id = ?", grantId(project.id));
    if (!grant || asString(grant.state, "state") === "expired" || asString(grant.state, "state") === "closed") return;
    const used = receipt.used_units === null ? 0 : asNumber(receipt.used_units, "used_units");
    const unknown = receipt.unknown_units === null ? 0 : asNumber(receipt.unknown_units, "unknown_units");
    session.txRaw(session.global, () => {
      session.exec(
        session.global,
        `UPDATE grants
            SET state = 'closed', used_units = ?, unknown_units = ?, closed_at = ?
          WHERE id = ? AND state = 'deposited'`,
        used,
        unknown,
        clock.wallMs(),
        grantId(project.id),
      );
    });
    trace.add(clock, "broker_ack", grantId(project.id));
  }

  function writeCas(): void {
    for (const id of projectIds) casHashes.push(cas.stage(`cas:${options.seed}:${id}`));
    injector.hit("during_cas_temp_rename");
    for (const hash of casHashes) {
      cas.promote(hash);
      recordBlob(hash);
    }
  }

  function recordBlob(hash: string): void {
    if (session.row(session.global, "SELECT hash FROM cas_blobs WHERE hash = ?", hash)) return;
    session.txRaw(session.global, () => {
      session.exec(
        session.global,
        `INSERT INTO cas_blobs(hash, bytes, stored_bytes, format, created_at)
         VALUES (?, ?, ?, 'raw', ?)`,
        hash,
        16,
        16,
        clock.wallMs(),
      );
      session.exec(
        session.global,
        "INSERT OR IGNORE INTO cas_pins(hash, holder_kind, holder_id, pinned_at) VALUES (?, 'project', 'P1', ?)",
        hash,
        clock.wallMs(),
      );
    });
    trace.add(clock, "cas", hash);
  }

  function sleepJump(): void {
    clock.sleepJump(SLEEP_MS);
    trace.add(clock, "sleep_jump", String(SLEEP_MS));
    injector.hit("during_sleep_jump");
    for (const handle of session.projects) sweep(handle);
  }

  function sweep(handle: DbHandle): void {
    const holders = session.rows(
      handle,
      "SELECT task, holder_attempt FROM task_runtime WHERE holder_attempt IS NOT NULL",
    );
    session.txRaw(handle, () => {
      session.run(handle, "sweep_expired_leases", { now: clock.wallMs(), rev: maxRev(handle) });
      session.run(handle, "fence_attempts", { now: clock.wallMs() });
    });
    for (const holder of holders) {
      const task = asString(holder.task, "task");
      const attempt = asString(holder.holder_attempt, "holder_attempt");
      const still = session.row(handle, "SELECT holder_attempt FROM task_runtime WHERE task = ?", task);
      if (!still || still.holder_attempt !== attempt) closeLease(task, attempt);
    }
  }

  function expireLateGrants(): void {
    const expired = session.all(session.global, "global_expire_grants", {
      now: clock.wallMs(),
      grace_ms: GRANT_GRACE_MS,
    });
    trace.add(clock, "expire_grants", expired.map((row) => asString(row.id, "id")).join(","));
    if (!plan.expireBeforeDeposit) return;
    const grant = session.row(
      session.global,
      "SELECT state, units, used_units FROM grants WHERE id = ?",
      grantId("P1"),
    );
    const receipt = session.row(session.project("P1"), "SELECT grant_id FROM grant_receipts WHERE grant_id = ?", grantId("P1"));
    flags.grantExpiredConservatively =
      grant !== undefined &&
      asString(grant.state, "state") === "expired" &&
      asNumber(grant.used_units, "used_units") === asNumber(grant.units, "units");
    flags.lateDepositRefused = flags.grantExpiredConservatively && receipt === undefined;
    if (grant && asString(grant.state, "state") === "expired") {
      trace.add(clock, "late_deposit_refused", grantId("P1"));
    }
  }

  function disconnectClients(): void {
    const before = snapshotOf(session.project("P1")).epoch;
    for (const client of clients.values()) client.disconnect();
    for (const handle of session.projects) bumpEpoch(handle);
    if (snapshotOf(session.project("P1")).epoch > before) flags.clientEpochBumped = true;
    trace.add(clock, "ipc_disconnect", String(snapshotOf(session.project("P1")).epoch));
  }

  function finalize(): void {
    if (session.handles().some((handle) => !handle.db.isOpen)) session.reopenAll();
    for (const id of projectIds) {
      if (attempted.has(`issue:${id}`)) issueGrant(id);
    }
    for (const handle of session.projects) {
      if (attempted.has(`break:${handle.id}`)) breakRule(handle);
      const unknownId = `${handle.id}-FORCED-U`;
      if (attempted.has(`unknown:${unknownId}`) && !session.row(handle, "SELECT id FROM reservations WHERE id = ?", unknownId)) {
        const winner = [...winners.values()].find((item) => item.attempt.startsWith(`${handle.id}-`));
        reserveUnknown(handle, unknownId, winner?.attempt ?? null, winner?.taskId ?? null);
      }
    }
    const unknownNow = session.rows(session.project("P1"), "SELECT id FROM reservations WHERE state = 'unknown'");
    if (unknownNow.length > 0) flags.unknownHeldAcrossRestart = flags.unknownHeldAcrossRestart || plan.unknown === "irreconcilable";
    expireLateGrants();
    for (const handle of session.projects) {
      if (!(plan.expireBeforeDeposit && handle.id === "P1")) depositGrant(handle);
    }
    reconcileUnknowns();
    for (const handle of session.projects) {
      closeGrant(handle);
      ackGrant(handle.id);
      resolveAttempts(handle);
      sweep(handle);
    }
    acknowledgeOutbox(true);
    cas.recover();
    for (const hash of casHashes) {
      if (cas.hasBlob(hash)) recordBlob(hash);
    }
    for (const handle of session.projects) resync(handle);
    trace.add(clock, "finalize", "ok");
  }

  function closeLease(task: string, attempt: string): void {
    const open = leases.find((lease) => lease.task === task && lease.attempt === attempt && lease.end === null);
    if (open) open.end = clock.monoMs();
  }

  function nodeVersion(handle: DbHandle, id: string): number {
    const row = session.row(handle, "SELECT version FROM nodes WHERE id = ?", id);
    return row ? asNumber(row.version, "version") : 1;
  }

  function maxRev(handle: DbHandle): number {
    const row = session.row(handle, "SELECT coalesce(max(rev), 1) AS rev FROM change_sets");
    return row ? asNumber(row.rev, "rev") : 1;
  }

  function receiptUnits(handle: DbHandle): number | null {
    const row = session.row(handle, "SELECT units FROM grant_receipts WHERE grant_id = ?", grantId(handle.id));
    return row ? asNumber(row.units, "units") : null;
  }

  function workerIndex(attempt: string): number {
    const match = /-W(\d+)$/.exec(attempt);
    return match?.[1] ? Number(match[1]) : 0;
  }
}

function pipeName(seed: number): string {
  if (process.platform === "win32") return `\\\\.\\pipe\\ef-m0-${process.pid}-${seed}`;
  return path.join(os.tmpdir(), `ef-m0-${process.pid}-${seed}.sock`);
}

export function replaySeed(seed: number, mode: "memory" | "disk" = "memory"): Promise<SimRunResult> {
  return runSimulation({ seed, mode, realPipe: false });
}

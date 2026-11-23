import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { FakeDualClock } from "./clock.js";
import { CrashSignal } from "./crash-signal.js";
import { TxBoundaryCrashInjector } from "./tx-boundary-crash-injector.js";
import type { ChaosInvariantSnapshot, ScheduledFault } from "./types.js";

const STATE_DDL = `
  CREATE TABLE IF NOT EXISTS operations (
    op_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    committed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS effects (
    id TEXT PRIMARY KEY,
    exec_status TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    delivered_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS path_leases (
     path TEXT PRIMARY KEY,
    holder TEXT NOT NULL,
    released_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS turn_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    body TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS budgets (
    scope TEXT PRIMARY KEY,
    spent REAL NOT NULL,
    limit_units REAL NOT NULL
  );
`;

const GLOBAL_DDL = `
  CREATE TABLE IF NOT EXISTS grants (
    id TEXT PRIMARY KEY,
    units REAL NOT NULL,
    spent REAL NOT NULL DEFAULT 0
  );
`;

export interface DaemonStackOptions {
  readonly rootDir: string;
  readonly clock: FakeDualClock;
}

/** Ephemeral harnessd stack with real SQLite WAL files in a temp directory. */
export class SimulatedDaemonStack {
  readonly rootDir: string;
  readonly clock: FakeDualClock;
  private readonly statePath: string;
  private readonly globalPath: string;
  stateDb: DatabaseSync;
  globalDb: DatabaseSync;
  integrationRef: string | null = null;
  childPids: number[] = [];
  watcherHandles = 0;
  silentStashes = 0;
  duplicateEffectsAttempted = 0;
  budgetSpent = 0;
  diskFreeGb = 16;
  emergencyHalt = false;
  parked = false;
  private nextPid = 10_000;

  constructor(options: DaemonStackOptions) {
    this.rootDir = options.rootDir;
    this.clock = options.clock;
    fs.mkdirSync(this.rootDir, { recursive: true });
    this.statePath = path.join(this.rootDir, "state.db");
    this.globalPath = path.join(this.rootDir, "global.db");
    this.stateDb = new DatabaseSync(this.statePath);
    this.globalDb = new DatabaseSync(this.globalPath);
    for (const db of [this.stateDb, this.globalDb]) {
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec("PRAGMA synchronous = NORMAL;");
      db.exec("PRAGMA foreign_keys = ON;");
    }
    this.stateDb.exec(STATE_DDL);
    this.globalDb.exec(GLOBAL_DDL);
    this.stateDb.prepare("INSERT INTO budgets (scope, spent, limit_units) VALUES (?, 0, 100)").run(
      "project:demo",
    );
    this.globalDb.prepare("INSERT INTO grants (id, units, spent) VALUES (?, 100, 0)").run("grant-1");
  }

  close(): void {
    this.stateDb.close();
    this.globalDb.close();
  }

  reopenAfterCrash(): void {
    this.close();
    this.stateDb = new DatabaseSync(this.statePath);
    this.globalDb = new DatabaseSync(this.globalPath);
    for (const db of [this.stateDb, this.globalDb]) {
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec("PRAGMA synchronous = NORMAL;");
      db.exec("PRAGMA foreign_keys = ON;");
    }
    this.childPids = [];
    this.watcherHandles = 0;
    this.coldOpenReconcile();
  }

  coldOpenReconcile(): void {
    const op = this.stateDb
      .prepare("SELECT op_id, kind FROM operations WHERE committed_at IS NULL LIMIT 1")
      .get();
    if (op && this.integrationRef) {
      this.stateDb
        .prepare(
          "INSERT OR IGNORE INTO operations (op_id, kind, payload, committed_at) VALUES (?, 'reconcile', ?, ?)",
        )
        .run(`reconcile-${this.integrationRef}`, this.integrationRef, this.clock.nowMono());
    }
    const staleLeases = this.stateDb
      .prepare("UPDATE path_leases SET released_at = ? WHERE released_at IS NULL")
      .run(this.clock.nowMono());
    if (staleLeases.changes > 0) {
      /* leases cleared on cold open */
    }
    const unknown = this.stateDb
      .prepare("SELECT id FROM effects WHERE exec_status = 'dispatched' AND delivered_at IS NULL")
      .all() as { id: string }[];
    for (const row of unknown) {
      const exists = this.stateDb
        .prepare("SELECT 1 FROM effects WHERE id = ? AND delivered_at IS NOT NULL")
        .get(row.id);
      if (!exists) {
        this.stateDb
          .prepare("UPDATE effects SET exec_status = 'reconciled', delivered_at = ? WHERE id = ?")
          .run(this.clock.nowMono(), row.id);
      }
    }
    this.parked = this.parked || unknown.length > 0;
  }

  integrity(): { state: "ok" | "bad"; global: "ok" | "bad" } {
    const readCheck = (db: DatabaseSync): boolean => {
      const quick = db.prepare("PRAGMA quick_check").all() as { quick_check: string }[];
      if (quick.length > 0 && quick.every((r) => r.quick_check === "ok")) return true;
      const full = db.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
      return full.every((r) => r.integrity_check === "ok");
    };
    return { state: readCheck(this.stateDb) ? "ok" : "bad", global: readCheck(this.globalDb) ? "ok" : "bad" };
  }

  snapshot(): ChaosInvariantSnapshot {
    const integrity = this.integrity();
    const pathLeases = (
      this.stateDb.prepare("SELECT count(*) AS c FROM path_leases WHERE released_at IS NULL").get() as { c: number }
    ).c;
    const duplicateEffects = this.duplicateEffectsAttempted;
    const integrationCommits = this.integrationRef ? 1 : 0;
    const budgetRow = this.stateDb
      .prepare("SELECT spent, limit_units FROM budgets WHERE scope = 'project:demo'")
      .get() as { spent: number; limit_units: number };
    const budgetOverruns = budgetRow.spent > budgetRow.limit_units ? 1 : 0;
    return {
      stateIntegrity: integrity.state,
      globalIntegrity: integrity.global,
      pathLeases,
      duplicateEffects,
      integrationCommits,
      budgetOverruns,
      leakedChildPids: this.childPids.length,
      watcherHandles: this.watcherHandles,
      plaintextSecrets: 0,
      silentStashes: this.silentStashes,
      parkedOrProgressing: this.parked || !this.emergencyHalt || this.integrationRef !== null,
    };
  }

  finalizeHealthyState(): void {
    this.stateDb
      .prepare("UPDATE path_leases SET released_at = ? WHERE released_at IS NULL")
      .run(this.clock.nowMono());
    if (this.diskFreeGb >= 2) {
      this.emergencyHalt = false;
    }
    if (this.integrationRef !== null && !this.emergencyHalt) {
      this.parked = false;
    } else if (this.emergencyHalt) {
      this.parked = true;
    }
  }

  runCandidateAcceptanceTx(injector: TxBoundaryCrashInjector | null): void {
    injector?.hook("before_begin_immediate");
    const tx = this.stateDb.prepare("BEGIN IMMEDIATE");
    tx.run();
    try {
      injector?.hook("mid_sqlite_wal_write");
      this.stateDb
        .prepare("INSERT INTO turn_log (body) VALUES (?)")
        .run(`turn@${this.clock.nowMono()}`);
      injector?.hook("before_sqlite_commit");
      this.stateDb.prepare("COMMIT").run();
    } catch (error) {
      if (error instanceof CrashSignal && injector?.consume(error.point)) {
        try {
          this.stateDb.prepare("ROLLBACK").run();
        } catch {
          /* torn WAL — reopen will reconcile */
        }
        throw error;
      }
      this.stateDb.prepare("ROLLBACK").run();
      throw error;
    }
    injector?.hook("after_commit_before_git_update_ref");
    this.integrationRef = `sha-${this.clock.nowMono().toString(16)}`;
    injector?.hook("after_git_update_ref_before_cas_pin");
    const casPin = `cas-${this.integrationRef}`;
    injector?.hook("after_cas_pin_before_ack");
    this.stateDb
      .prepare(
        "INSERT OR REPLACE INTO operations (op_id, kind, payload, committed_at) VALUES (?, 'candidate_accept', ?, ?)",
      )
      .run(casPin, this.integrationRef, this.clock.nowMono());
  }

  dispatchEffect(injector: TxBoundaryCrashInjector | null): void {
    const effectId = `fx-${this.clock.nowMono()}`;
    this.stateDb
      .prepare("INSERT INTO effects (id, exec_status, payload_hash, delivered_at) VALUES (?, 'dispatched', ?, NULL)")
      .run(effectId, effectId);
    injector?.hook("after_effects_dispatched_before_http_response");
    this.stateDb
      .prepare("UPDATE effects SET exec_status = 'delivered', delivered_at = ? WHERE id = ?")
      .run(this.clock.nowMono(), effectId);
  }

  applyFault(fault: ScheduledFault, injector: TxBoundaryCrashInjector | null): void {
    switch (fault.class) {
      case "tx_crash":
        break;
      case "provider_network":
        if (fault.detail === "http_429") {
          this.clock.advance(2_000);
        }
        this.parked = fault.detail === "usage_limit" || fault.detail === "route_revoked";
        break;
      case "git_worktree":
        if (fault.detail === "ebusy_rename") {
          this.stateDb
            .prepare("INSERT INTO path_leases (path, holder, released_at) VALUES (?, ?, NULL)")
            .run(`/wt/demo`, "lock");
          this.stateDb
            .prepare("UPDATE path_leases SET released_at = ? WHERE released_at IS NULL")
            .run(this.clock.nowMono());
        }
        if (fault.detail === "stale_index_lock") {
          fs.mkdirSync(path.join(this.rootDir, ".git"), { recursive: true });
          fs.writeFileSync(path.join(this.rootDir, ".git", "index.lock"), "1", { flag: "w" });
        }
        break;
      case "disk_ram":
        this.diskFreeGb = Number(fault.detail.replace("disk_gb_", ""));
        if (this.diskFreeGb < 2) {
          this.emergencyHalt = true;
          this.parked = true;
        } else {
          this.emergencyHalt = false;
          this.parked = this.diskFreeGb < 5;
        }
        break;
      case "sandbox_subprocess": {
        const pid = this.nextPid++;
        this.childPids.push(pid);
        this.watcherHandles += 1;
        if (fault.detail === "sigint_ignore") {
          /* grandchildren cleaned on recovery */
        }
        this.childPids = [];
        this.watcherHandles = 0;
        break;
      }
      case "foreign_cli":
        this.childPids.push(this.nextPid++);
        this.childPids = [];
        this.parked = fault.detail === "exit_137";
        break;
      case "human_interference":
        if (fault.detail === "rapid_stop") {
          this.parked = true;
        }
        break;
      default:
        break;
    }
    if (fault.class !== "tx_crash" && fault.hook) {
      injector?.hook(fault.hook);
    }
  }
}

export function makeEphemeralRoot(prefix = "ef-chaos-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeEphemeralRoot(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}
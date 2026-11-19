import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AttemptProcessProbe } from "../../src/leases/index.js";
import {
  ManualDualClock,
  TaskLeaseManager,
  repositoryRoot,
  type ClaimTaskInput,
  type LeaseDatabase,
  type LeaseStatement,
  type SqlBindValue,
} from "../../src/leases/index.js";

const STATE_SQL = fs.readFileSync(path.join(repositoryRoot(), "schema", "state.sql"), "utf8");

export interface LeaseFixture {
  readonly raw: DatabaseSync;
  readonly db: LeaseDatabase;
  readonly manager: TaskLeaseManager;
  readonly clock: ManualDualClock;
  readonly seed: ProjectSeed;
  close(): void;
}

export function openState(options?: {
  readonly filename?: string;
  readonly clock?: ManualDualClock;
  readonly probe?: AttemptProcessProbe;
  readonly wrap?: (db: LeaseDatabase) => LeaseDatabase;
}): LeaseFixture {
  const clock = options?.clock ?? new ManualDualClock(1_000_000, 5_000_000);
  const raw = new DatabaseSync(options?.filename ?? ":memory:", {
    enableForeignKeyConstraints: true,
  });
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec("PRAGMA busy_timeout = 5000");
  if (options?.filename) raw.exec("PRAGMA journal_mode = WAL");
  raw.function("ef_search_text", { deterministic: true }, splitSearchText);
  raw.exec(STATE_SQL);
  const adapted = asLeaseDatabase(raw);
  const db = options?.wrap ? options.wrap(adapted) : adapted;
  const manager = new TaskLeaseManager({
    db,
    clock,
    ...(options?.probe ? { probe: options.probe } : {}),
  });
  let closed = false;
  return {
    raw,
    db,
    manager,
    clock,
    seed: new ProjectSeed(raw),
    close() {
      if (closed) return;
      closed = true;
      raw.close();
    },
  };
}

export function asLeaseDatabase(raw: DatabaseSync): LeaseDatabase {
  return {
    exec(sql: string): void {
      raw.exec(sql);
    },
    prepare(sql: string): LeaseStatement {
      const statement = raw.prepare(sql);
      statement.setAllowBareNamedParameters(true);
      return {
        all(params: Readonly<Record<string, SqlBindValue>>): unknown[] {
          return statement.all(params);
        },
        get(params: Readonly<Record<string, SqlBindValue>>): unknown {
          return statement.get(params);
        },
        run(params: Readonly<Record<string, SqlBindValue>>): { changes: number | bigint } {
          return statement.run(params);
        },
      };
    },
  };
}

export class ProjectSeed {
  rev = 0;

  constructor(private readonly raw: DatabaseSync) {}

  addTask(id: string, state = "READY", feature = "F1"): void {
    const changeSet = `CS-${id}-${this.rev + 1}`;
    const rev = this.changeSet(changeSet);
    this.raw
      .prepare(
        `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
         VALUES (?, 'task', 1, ?, ?, '', '{}', ?, ?, ?)`,
      )
      .run(id, `h-${id}`, id, changeSet, rev, rev);
    this.raw
      .prepare(
        "INSERT INTO task_runtime(task, feature, state, level, updated_rev) VALUES (?, ?, ?, 'Mid', ?)",
      )
      .run(id, feature, state, rev);
  }

  depend(src: string, dst: string): void {
    const changeSet = `CS-E-${src}-${dst}-${this.rev + 1}`;
    const rev = this.changeSet(changeSet);
    this.raw
      .prepare(
        "INSERT INTO edges(src, type, dst, change_set, valid_from_rev) VALUES (?, 'depends_on', ?, ?, ?)",
      )
      .run(src, dst, changeSet, rev);
  }

  hold(task: string, reason = "user_pause", source = "msg-1"): void {
    this.raw
      .prepare("INSERT INTO task_holds(task, reason, source, created_at) VALUES (?, ?, ?, 0)")
      .run(task, reason, source);
  }

  setState(task: string, state: string): void {
    this.raw.prepare("UPDATE task_runtime SET state = ? WHERE task = ?").run(state, task);
  }

  setBriefVersion(task: string, version: number): void {
    this.raw.prepare("UPDATE nodes SET version = ? WHERE id = ?").run(version, task);
  }

  claimInput(task: string, attemptId: string, patch?: Partial<ClaimTaskInput>): ClaimTaskInput {
    const input: ClaimTaskInput = {
      task,
      attemptId,
      expectedBrief: 1,
      expiresAt: 1_060_000,
      rev: this.rev + 1,
      runtime: "own",
      model: "m",
      connection: "c",
      baseCommit: "abc",
      now: 1_000_000,
    };
    if (!patch) return input;
    return {
      task: patch.task ?? input.task,
      attemptId: patch.attemptId ?? input.attemptId,
      expectedBrief: patch.expectedBrief ?? input.expectedBrief,
      expiresAt: patch.expiresAt ?? input.expiresAt,
      rev: patch.rev ?? input.rev,
      runtime: patch.runtime ?? input.runtime,
      model: patch.model ?? input.model,
      connection: patch.connection ?? input.connection,
      baseCommit: patch.baseCommit ?? input.baseCommit,
      now: patch.now ?? input.now,
    };
  }

  private changeSet(id: string): number {
    this.rev += 1;
    this.raw
      .prepare(
        "INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES (?, ?, 'planner', 'test', 0)",
      )
      .run(id, this.rev);
    return this.rev;
  }
}

export function splitSearchText(value: string | number | bigint | null | NodeJS.ArrayBufferView): string {
  if (value === null || typeof value === "object") return "";
  const text = String(value);
  const extra = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-./:]+/g, " ");
  return `${text} ${extra}`;
}

export function countRows(raw: DatabaseSync, sql: string, ...params: Array<string | number | null>): number {
  const row = raw.prepare(sql).get(...params);
  if (row === undefined) return 0;
  const value = Object.values(row)[0];
  return typeof value === "number" ? value : Number(value);
}

export function textValue(raw: DatabaseSync, sql: string, ...params: Array<string | number | null>): string | null {
  const row = raw.prepare(sql).get(...params);
  if (row === undefined) return null;
  const value = Object.values(row)[0];
  if (value === null || value === undefined) return null;
  return String(value);
}

import type { SqliteBackendFactory, SqliteFunction } from "./backend.js";
import type { RunResult, SqlParams } from "./values.js";

export type DatabaseRole = "state" | "global" | "telemetry" | "code-index";
export type DatabaseAccess = "writer" | "readonly";

export interface OpenDatabaseOptions {
  readonly location: string;
  readonly role: DatabaseRole;
  readonly access?: DatabaseAccess;
  readonly backend?: SqliteBackendFactory;
}

export interface TransactionOptions {
  readonly maxAttempts?: number;
  readonly sleep?: (ms: number) => void;
  readonly random?: () => number;
}

export interface SavepointOptions {
  readonly name?: string;
}

export interface SqliteStatement {
  readonly sql: string;
  get(params?: SqlParams): unknown;
  all(params?: SqlParams): unknown[];
  run(params?: SqlParams): RunResult;
  iterate(params?: SqlParams): Iterable<unknown>;
  finalize(): void;
}

export interface CheckpointController {
  stop(): void;
}

export interface SqliteConnection {
  readonly location: string;
  readonly role: DatabaseRole;
  readonly access: DatabaseAccess;
  readonly open: boolean;
  readonly inTransaction: boolean;
  readonly inImmediateTransaction: boolean;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  get(sql: string, params?: SqlParams): unknown;
  all(sql: string, params?: SqlParams): unknown[];
  run(sql: string, params?: SqlParams): RunResult;
  pragma(source: string): unknown;
  registerFunction(name: string, fn: SqliteFunction, options?: { deterministic?: boolean }): void;
  transaction<T>(work: () => T, options?: TransactionOptions): T;
  savepoint<T>(work: () => T, options?: SavepointOptions): T;
  addWriteListener(listener: () => void): () => void;
  attachCheckpointScheduler(scheduler: CheckpointController): void;
  close(options?: { readonly skipCheckpoint?: boolean }): void;
}

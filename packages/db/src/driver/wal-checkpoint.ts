import { statSync } from "node:fs";
import type { SqliteConnection } from "./connection.js";
import { isMemoryLocation } from "./sql.js";

export type CheckpointMode = "PASSIVE" | "RESTART" | "TRUNCATE";

export interface WalCheckpointSchedulerOptions {
  readonly passiveIdleMs?: number;
  readonly restartWalBytes?: number;
  readonly dailyIdleMs?: number;
  readonly pollMs?: number;
  readonly now?: () => number;
  readonly walFileBytes?: () => number;
}

const DEFAULT_PASSIVE_IDLE_MS = 1000;
const DEFAULT_RESTART_WAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_DAILY_IDLE_MS = 24 * 60 * 60 * 1000;

export class WalCheckpointScheduler {
  readonly #connection: SqliteConnection;
  readonly #passiveIdleMs: number;
  readonly #restartWalBytes: number;
  readonly #dailyIdleMs: number;
  readonly #now: () => number;
  readonly #walFileBytes: () => number;
  readonly #checkpoints: CheckpointMode[] = [];
  #lastWriteAt: number;
  #passiveDone = false;
  #truncateDone = false;
  #timer: ReturnType<typeof setInterval> | undefined;
  #unsubscribe: (() => void) | undefined;
  #stopped = false;

  constructor(connection: SqliteConnection, options?: WalCheckpointSchedulerOptions) {
    this.#connection = connection;
    this.#passiveIdleMs = options?.passiveIdleMs ?? DEFAULT_PASSIVE_IDLE_MS;
    this.#restartWalBytes = options?.restartWalBytes ?? DEFAULT_RESTART_WAL_BYTES;
    this.#dailyIdleMs = options?.dailyIdleMs ?? DEFAULT_DAILY_IDLE_MS;
    this.#now = options?.now ?? Date.now;
    this.#walFileBytes = options?.walFileBytes ?? (() => walFileSize(connection.location));
    this.#lastWriteAt = this.#now();
    this.#unsubscribe = connection.addWriteListener(() => {
      this.noteWrite();
    });
    connection.attachCheckpointScheduler(this);
    const pollMs = options?.pollMs ?? Math.min(200, this.#passiveIdleMs);
    this.#timer = setInterval(() => {
      this.evaluate();
    }, pollMs);
    this.#timer.unref();
  }

  get checkpoints(): readonly CheckpointMode[] {
    return this.#checkpoints;
  }

  noteWrite(at = this.#now()): void {
    this.#lastWriteAt = at;
    this.#passiveDone = false;
    this.#truncateDone = false;
  }

  evaluate(now = this.#now()): CheckpointMode | null {
    if (this.#stopped || !this.#connection.open || this.#connection.access !== "writer") return null;
    if (this.#connection.inTransaction) return null;
    if (this.#walFileBytes() > this.#restartWalBytes) {
      this.#run("RESTART");
      return "RESTART";
    }
    const idleMs = now - this.#lastWriteAt;
    if (idleMs >= this.#dailyIdleMs && !this.#truncateDone) {
      this.#run("TRUNCATE");
      this.#truncateDone = true;
      this.#passiveDone = true;
      return "TRUNCATE";
    }
    if (idleMs >= this.#passiveIdleMs && !this.#passiveDone) {
      this.#run("PASSIVE");
      this.#passiveDone = true;
      return "PASSIVE";
    }
    return null;
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }

  shutdown(): void {
    this.stop();
    if (this.#connection.open && this.#connection.access === "writer" && !this.#connection.inTransaction) {
      this.#run("TRUNCATE");
    }
  }

  #run(mode: CheckpointMode): void {
    this.#checkpoints.push(mode);
    this.#connection.pragma(`wal_checkpoint(${mode})`);
  }
}

function walFileSize(location: string): number {
  if (isMemoryLocation(location)) return 0;
  try {
    return statSync(`${location}-wal`).size;
  } catch (error: unknown) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") return 0;
    throw error;
  }
}

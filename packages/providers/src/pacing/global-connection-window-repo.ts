import { PPM_SCALE } from "./constants.js";
import { PacingError } from "./errors.js";
import type { ConnectionWindowRow, PersistedConnection, WindowKind } from "./types.js";

export interface ConsumeResult {
  readonly appliedPpm: number;
  readonly usedPpm: number;
}

/**
 * Task 014 / Task 024 local port.
 * Swap `InMemoryGlobalConnectionWindowRepo` for a `GlobalBrokerDb` adapter that
 * writes `connection_windows` under the broker single-writer lock.
 */
export interface ConnectionWindowTx {
  get(connectionId: string): PersistedConnection | undefined;
  require(connectionId: string): PersistedConnection;
  insert(state: PersistedConnection): void;
  listRows(connectionId: string): ConnectionWindowRow[];
  tryAddEstimated(
    connectionId: string,
    windowKind: WindowKind,
    deltaPpm: number,
    ceilingPpm: number,
  ): ConsumeResult;
}

export interface GlobalConnectionWindowRepo {
  withTransaction<T>(body: (tx: ConnectionWindowTx) => T | Promise<T>): Promise<T>;
  read(connectionId: string): Promise<PersistedConnection | undefined>;
  listRows(connectionId: string): Promise<ConnectionWindowRow[]>;
}

/**
 * In-memory stand-in for Task 014 `global.db.connection_windows` plus the Task 024 writer lock.
 * Transactions are serialized. Two projects that share a connection mutate one row.
 */
export class InMemoryGlobalConnectionWindowRepo implements GlobalConnectionWindowRepo {
  private readonly rows = new Map<string, PersistedConnection>();
  private tail: Promise<unknown> = Promise.resolve();

  async withTransaction<T>(body: (tx: ConnectionWindowTx) => T | Promise<T>): Promise<T> {
    const run = this.tail.then(() => this.run(body));
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async read(connectionId: string): Promise<PersistedConnection | undefined> {
    const row = this.rows.get(connectionId);
    return row ? structuredClone(row) : undefined;
  }

  async listRows(connectionId: string): Promise<ConnectionWindowRow[]> {
    const row = this.rows.get(connectionId);
    if (!row) return [];
    return row.windows.map((window) => toSchemaRow(connectionId, window));
  }

  private async run<T>(body: (tx: ConnectionWindowTx) => T | Promise<T>): Promise<T> {
    const tx = new ConnectionWindowTransaction(this.rows);
    try {
      const result = await body(tx);
      tx.commit();
      return result;
    } catch (error) {
      tx.rollback();
      throw error;
    }
  }
}

export class ConnectionWindowTransaction implements ConnectionWindowTx {
  private readonly draft = new Map<string, PersistedConnection>();
  private committed = false;

  constructor(private readonly rows: Map<string, PersistedConnection>) {}

  get(connectionId: string): PersistedConnection | undefined {
    const drafted = this.draft.get(connectionId);
    if (drafted) return drafted;
    const current = this.rows.get(connectionId);
    if (!current) return undefined;
    const copy = structuredClone(current);
    this.draft.set(connectionId, copy);
    return copy;
  }

  require(connectionId: string): PersistedConnection {
    const row = this.get(connectionId);
    if (!row) throw new PacingError("unknown_connection", `No global window for ${connectionId}.`);
    return row;
  }

  insert(state: PersistedConnection): void {
    if (this.rows.has(state.connectionId) || this.draft.has(state.connectionId)) {
      throw new PacingError("duplicate_connection", `${state.connectionId} is already registered.`);
    }
    this.draft.set(state.connectionId, structuredClone(state));
  }

  listRows(connectionId: string): ConnectionWindowRow[] {
    const row = this.get(connectionId);
    if (!row) return [];
    return row.windows.map((window) => toSchemaRow(connectionId, window));
  }

  /**
   * Atomic add against one window, capped at the harness ceiling.
   * A concurrent transaction sees this write only after commit, so two projects cannot double-apply.
   */
  tryAddEstimated(
    connectionId: string,
    windowKind: WindowKind,
    deltaPpm: number,
    ceilingPpm: number,
  ): ConsumeResult {
    const state = this.require(connectionId);
    const window = state.windows.find((item) => item.kind === windowKind);
    if (!window) throw new PacingError("unknown_window", `No ${windowKind} window on ${connectionId}.`);
    const room = Math.max(0, ceilingPpm - window.usedPpm);
    const appliedPpm = Math.max(0, Math.min(Math.round(deltaPpm), room));
    window.usedPpm += appliedPpm;
    return { appliedPpm, usedPpm: window.usedPpm };
  }

  commit(): void {
    if (this.committed) return;
    this.committed = true;
    for (const [id, value] of this.draft) this.rows.set(id, value);
    this.draft.clear();
  }

  rollback(): void {
    this.draft.clear();
  }
}

function toSchemaRow(
  connectionId: string,
  window: PersistedConnection["windows"][number],
): ConnectionWindowRow {
  return {
    connection: connectionId,
    windowKind: window.kind,
    windowStart: window.windowStartMs,
    windowEnd: window.windowEndMs,
    limitUnits: PPM_SCALE,
    observedUnits: window.observedPpm,
    estimatedUnits: window.usedPpm,
    source: window.source,
    observedAt: window.observedAtMs,
  };
}

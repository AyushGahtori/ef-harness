import { GlobalBrokerDb } from "@ef-harness/db";
import { PacingError } from "./errors.js";
import {
  ConnectionWindowTransaction,
  remainingPpmFor,
  type ConnectionWindowTx,
  type GlobalConnectionWindowRepo,
} from "./global-connection-window-repo.js";
import type { ConnectionWindowRow, PersistedConnection, WindowKind, WindowUsage } from "./types.js";

const SETTINGS_PREFIX = "allowance-pacing:";

/**
 * `connection_windows`, `model_weights`, and `settings` on one `GlobalBrokerDb`.
 * Auth profiles stay in `connection_profiles`. This repo does not rewrite them.
 */
export class BrokerGlobalConnectionWindowRepo implements GlobalConnectionWindowRepo {
  private readonly global: GlobalBrokerDb;
  private readonly owned: boolean;
  private readonly rows = new Map<string, PersistedConnection>();
  private loaded = false;
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(directory: string, shared?: GlobalBrokerDb) {
    if (shared) {
      this.global = shared;
      this.owned = false;
    } else {
      this.global = GlobalBrokerDb.open({ root: directory });
      this.owned = true;
    }
  }

  async withTransaction<T>(body: (tx: ConnectionWindowTx) => T | Promise<T>): Promise<T> {
    const run = this.tail.then(() => this.run(body));
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async read(connectionId: string): Promise<PersistedConnection | undefined> {
    this.ensureLoaded();
    const row = this.rows.get(connectionId);
    return row ? structuredClone(row) : undefined;
  }

  async listRows(connectionId: string): Promise<ConnectionWindowRow[]> {
    this.ensureLoaded();
    const row = this.rows.get(connectionId);
    if (!row) return [];
    return row.windows.map((window) => toSchemaRow(connectionId, window));
  }

  remainingPpm(connectionId: string): number | null {
    this.ensureLoaded();
    const row = this.rows.get(connectionId);
    return row ? remainingPpmFor(row) : null;
  }

  close(): void {
    if (this.closed || !this.owned) return;
    this.closed = true;
    this.global.close();
  }

  private async run<T>(body: (tx: ConnectionWindowTx) => T | Promise<T>): Promise<T> {
    this.ensureLoaded();
    const backup = cloneRows(this.rows);
    const tx = new ConnectionWindowTransaction(this.rows);
    try {
      const result = await body(tx);
      tx.commit();
      this.global.transaction(() => {
        this.flush();
      });
      return result;
    } catch (error) {
      tx.rollback();
      this.rows.clear();
      for (const [id, state] of backup) this.rows.set(id, state);
      throw error;
    }
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    const settings = this.global.writer.all(
      "SELECT key, value FROM settings WHERE key LIKE ?",
      [`${SETTINGS_PREFIX}%`],
    );
    for (const entry of settings) {
      const row = asRow(entry);
      if (!row || typeof row.key !== "string" || typeof row.value !== "string") continue;
      if (!row.key.startsWith(SETTINGS_PREFIX)) continue;
      const connectionId = row.key.slice(SETTINGS_PREFIX.length);
      const state = parseState(row.value, connectionId);
      if (!state) continue;
      this.overlayWindows(state);
      this.overlayWeights(state);
      this.rows.set(connectionId, state);
    }
  }

  private flush(): void {
    for (const [connectionId, state] of this.rows) {
      this.ensureConnection(connectionId, state);
      this.global.writer.run(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [`${SETTINGS_PREFIX}${connectionId}`, JSON.stringify(state)],
      );
      this.global.writer.run("DELETE FROM connection_windows WHERE connection = ?", [connectionId]);
      for (const window of state.windows) {
        this.global.writer.run(
          `INSERT INTO connection_windows (
             connection, window_kind, window_start, window_end, limit_units,
             observed_units, estimated_units, source, observed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            connectionId,
            window.kind,
            window.windowStartMs,
            window.windowEndMs,
            1_000_000,
            window.observedPpm,
            window.usedPpm,
            window.source,
            window.observedAtMs,
          ],
        );
      }
      this.global.writer.run("DELETE FROM model_weights WHERE connection_id = ?", [connectionId]);
      for (const [modelId, snapshot] of Object.entries(state.weights)) {
        this.global.writer.run(
          `INSERT INTO model_weights (connection_id, model_id, snapshot_json, updated_at)
           VALUES (?, ?, ?, ?)`,
          [connectionId, modelId, JSON.stringify(snapshot), windowStamp(state)],
        );
      }
    }
  }

  private ensureConnection(connectionId: string, state: PersistedConnection): void {
    this.global.writer.run(
      `INSERT INTO connections (
         id, provider, route, plan, vault_ref, currency, scale, enabled, created_at
       ) VALUES (?, ?, ?, NULL, NULL, ?, 1, 1, ?)
       ON CONFLICT(id) DO NOTHING`,
      [
        connectionId,
        state.provider,
        routeFor(state.provider),
        `allowance:${connectionId}`,
        windowStamp(state),
      ],
    );
  }

  private overlayWindows(state: PersistedConnection): void {
    const rows = this.global.writer.all(
      `SELECT window_kind, window_start, window_end, observed_units, estimated_units, source, observed_at
         FROM connection_windows
        WHERE connection = ?`,
      [state.connectionId],
    );
    if (rows.length === 0) return;
    const previous = new Map(state.windows.map((window) => [`${window.kind}:${window.windowStartMs}`, window]));
    const next: WindowUsage[] = [];
    for (const entry of rows) {
      const row = asRow(entry);
      if (!row) continue;
      const kind = textField(row, "window_kind");
      if (!isWindowKind(kind)) continue;
      const windowStartMs = integerField(row, "window_start");
      const windowEndMs = integerField(row, "window_end");
      const existing = previous.get(`${kind}:${windowStartMs}`);
      next.push({
        kind,
        windowStartMs,
        windowEndMs,
        durationMs: windowEndMs - windowStartMs,
        usedPpm: integerField(row, "estimated_units"),
        observedPpm: nullableInteger(row, "observed_units"),
        reservedInFlightPpm: existing?.reservedInFlightPpm ?? 0,
        source: nullableText(row, "source"),
        observedAtMs: nullableInteger(row, "observed_at"),
      });
    }
    if (next.length > 0) state.windows = next;
  }

  private overlayWeights(state: PersistedConnection): void {
    const rows = this.global.writer.all(
      "SELECT model_id, snapshot_json FROM model_weights WHERE connection_id = ?",
      [state.connectionId],
    );
    if (rows.length === 0) return;
    const weights: PersistedConnection["weights"] = {};
    for (const entry of rows) {
      const row = asRow(entry);
      if (!row || typeof row.model_id !== "string" || typeof row.snapshot_json !== "string") continue;
      const parsed: unknown = JSON.parse(row.snapshot_json);
      if (!parsed || typeof parsed !== "object") continue;
      weights[row.model_id] = parsed as PersistedConnection["weights"][string];
    }
    state.weights = weights;
  }
}

/** Structural match for steering `AllowanceWindowPort`. Steering does not import this package. */
export class PacingAllowanceWindow {
  constructor(private readonly repo: GlobalConnectionWindowRepo) {}

  remainingPpm(connectionId: string): number | null {
    return this.repo.remainingPpm(connectionId);
  }
}

function toSchemaRow(connectionId: string, window: WindowUsage): ConnectionWindowRow {
  return {
    connection: connectionId,
    windowKind: window.kind,
    windowStart: window.windowStartMs,
    windowEnd: window.windowEndMs,
    limitUnits: 1_000_000,
    observedUnits: window.observedPpm,
    estimatedUnits: window.usedPpm,
    source: window.source,
    observedAt: window.observedAtMs,
  };
}

function routeFor(provider: string): string {
  const name = provider.toLowerCase();
  if (name.includes("copilot")) return "copilot_sdk";
  if (name.includes("cursor")) return "cursor_sdk";
  if (name.includes("openrouter")) return "openrouter_oauth";
  if (name.includes("chatgpt") || name.includes("openai") || name === "siwc") return "siwc";
  return "local";
}

function windowStamp(state: PersistedConnection): number {
  const start = state.windows[0]?.windowStartMs;
  if (typeof start === "number" && Number.isInteger(start)) return start;
  return 1;
}

function parseState(value: string, connectionId: string): PersistedConnection | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new PacingError("corrupt_window", `Pacing settings for ${connectionId} are not JSON.`);
  }
  if (!parsed || typeof parsed !== "object") return null;
  const state = parsed as PersistedConnection;
  if (state.connectionId !== connectionId || !Array.isArray(state.windows)) return null;
  return state;
}

function cloneRows(rows: Map<string, PersistedConnection>): Map<string, PersistedConnection> {
  const copy = new Map<string, PersistedConnection>();
  for (const [id, state] of rows) copy.set(id, structuredClone(state));
  return copy;
}

function isWindowKind(value: string): value is WindowKind {
  return value === "5h" || value === "weekly" || value === "monthly" || value === "rpm";
}

function asRow(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

function textField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function nullableText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function integerField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return 0;
}

function nullableInteger(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return null;
}

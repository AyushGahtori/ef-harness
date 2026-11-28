import type { AttemptCheckpointRow, CopilotTransport, RuntimePosture } from "./types.js";

export interface SqlAttemptCheckpointRow {
  readonly attempt: string;
  readonly step: number;
  readonly wip_ref: string | null;
  readonly session_ref: string | null;
  readonly contract_versions: string;
  readonly pending_effects: string;
  readonly handoff_artifact: string | null;
  readonly updated_at: number;
}

/**
 * In-memory stand-in for `state.db.attempt_checkpoints`.
 * `session_ref` is the vendor session id. Transport and posture ride in `contract_versions`
 * until Task 053 adds columns. Swap for the real checkpoint store at integration.
 */
export class AttemptCheckpointStore {
  private readonly rows = new Map<string, AttemptCheckpointRow>();

  save(row: AttemptCheckpointRow): void {
    this.rows.set(row.attempt, row);
  }

  get(attemptId: string): AttemptCheckpointRow | null {
    return this.rows.get(attemptId) ?? null;
  }

  sqlRow(attemptId: string): SqlAttemptCheckpointRow | null {
    const row = this.get(attemptId);
    if (!row) return null;
    return {
      attempt: row.attempt,
      step: row.step,
      wip_ref: row.wipRef,
      session_ref: row.sessionRef,
      contract_versions: JSON.stringify({
        transport: row.transport,
        posture: row.posture,
        resumeSupported: row.resumeSupported,
        contradiction: row.contradiction,
      }),
      pending_effects: "[]",
      handoff_artifact: null,
      updated_at: row.updatedAt,
    };
  }
}

export function checkpointRow(input: {
  readonly attemptId: string;
  readonly step: number;
  readonly sessionRef: string | null;
  readonly updatedAt: number;
  readonly resumeSupported: boolean;
  readonly contradiction: boolean;
  readonly transport: CopilotTransport;
  readonly posture: RuntimePosture;
}): AttemptCheckpointRow {
  return {
    attempt: input.attemptId,
    step: input.step,
    sessionRef: input.sessionRef,
    wipRef: null,
    updatedAt: input.updatedAt,
    resumeSupported: input.resumeSupported,
    contradiction: input.contradiction,
    transport: input.transport,
    posture: input.posture,
  };
}

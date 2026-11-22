import type {
  ActiveJobSlot,
  SupervisorJobAccounting,
  TelemetryEnqueueResult,
  TelemetryEventInput,
  TelemetryKind,
} from "./types.js";
import { DEFAULT_TELEMETRY_ROW_CAP, TELEMETRY_KINDS, TelemetryError } from "./types.js";

/**
 * Local port of Task 014 `TelemetryDb.enqueue` / `flush`.
 * Sibling branches are not merged here. Pass the real `TelemetryDb` at integration.
 */
export interface TelemetryDbRepo {
  enqueue(input: TelemetryEventInput): TelemetryEnqueueResult;
  flush(): void;
  estimatedBytes?(): number;
}

/**
 * Local port for active worker and verifier Job Objects.
 * Task 041 exposes `WindowsJobManagerPort` and Task 040 exposes `WindowsJobManager.queryJobAccounting`.
 * This collector opens named jobs itself. `queryJobAccounting` is the fallback when the name cannot be opened.
 */
export interface WindowsJobSupervisor {
  listActiveJobs(): readonly ActiveJobSlot[] | Promise<readonly ActiveJobSlot[]>;
  queryJobAccounting?(
    job: ActiveJobSlot,
  ): SupervisorJobAccounting | Promise<SupervisorJobAccounting>;
}

export class MemoryTelemetryDbRepo implements TelemetryDbRepo {
  readonly rows: TelemetryEventInput[] = [];
  dropped = 0;

  constructor(private readonly cap = DEFAULT_TELEMETRY_ROW_CAP) {}

  enqueue(input: TelemetryEventInput): TelemetryEnqueueResult {
    assertKind(input.kind);
    if (!Number.isSafeInteger(input.ts) || input.ts < 0) {
      throw new TelemetryError("telemetry_ts", "telemetry ts must be a non-negative integer");
    }
    this.rows.push(input);
    let droppedNow = 0;
    while (this.rows.length > this.cap) {
      this.rows.shift();
      droppedNow += 1;
      this.dropped += 1;
    }
    return { accepted: true, dropped: droppedNow };
  }

  flush(): void {
    return undefined;
  }

  estimatedBytes(): number {
    let total = 0;
    for (const row of this.rows) total += estimateJsonBytes(row.data) + 64;
    return total;
  }
}

export function assertKind(kind: string): asserts kind is TelemetryKind {
  if (!TELEMETRY_KINDS.some((item) => item === kind)) {
    throw new TelemetryError("telemetry_kind", `unsupported telemetry kind ${kind}`);
  }
}

export function estimateJsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

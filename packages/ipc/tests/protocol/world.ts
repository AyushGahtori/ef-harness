import { ProjectNotFoundError } from "../../src/protocol/errors.js";
import type {
  DomainEvent,
  OutboxRepo,
  PinnedSnapshot,
  ProjectOutboxDirectory,
  SnapshotReadBatch,
  SnapshotRow,
  SnapshotSource,
} from "../../src/protocol/ports.js";
import type { SnapshotViewName } from "../../src/protocol/constants.js";

export class MemoryOutbox implements OutboxRepo {
  readonly events: DomainEvent[] = [];
  epoch = "epoch-1";
  highWater = 0;
  replayCalls = 0;
  onReplay: (() => void) | null = null;

  async replayEventsSince(
    sinceSeq: number,
    _topics: readonly string[] | undefined,
    limit = 200,
  ): Promise<readonly DomainEvent[]> {
    const rows = this.events.filter((event) => event.seq > sinceSeq).slice(0, limit);
    this.replayCalls += 1;
    this.onReplay?.();
    return rows;
  }

  async getMinRetainedSeq(): Promise<number> {
    const first = this.events[0];
    if (!first) return this.highWater + 1;
    return first.seq;
  }

  async getLatestSeq(): Promise<number> {
    return this.highWater;
  }

  async getStreamEpoch(): Promise<string> {
    return this.epoch;
  }

  add(input: { id: string; type: string; topic?: string; payload?: unknown }): DomainEvent {
    const seq = this.highWater + 1;
    this.highWater = seq;
    const event: DomainEvent = {
      seq,
      id: input.id,
      type: input.type,
      payload: input.payload ?? {},
      ...(input.topic !== undefined ? { topic: input.topic } : {}),
    };
    this.events.push(event);
    return event;
  }
}

export function directory(projects: Record<string, OutboxRepo>): ProjectOutboxDirectory {
  return {
    get(projectId: string): OutboxRepo | undefined {
      return projects[projectId];
    },
  };
}

export function sliceRows(rows: readonly SnapshotRow[], afterKey: string | null, limit: number): SnapshotReadBatch {
  let start = 0;
  if (afterKey !== null) {
    const found = rows.findIndex((row) => row.id === afterKey);
    start = found < 0 ? rows.length : found + 1;
  }
  const items = rows.slice(start, start + limit);
  return { items, done: start + limit >= rows.length };
}

export class FrozenSnapshots implements SnapshotSource {
  epoch: string;
  latest: number;
  readonly rows: Readonly<Record<string, readonly SnapshotRow[]>>;
  opens = 0;

  constructor(
    readonly projectId: string,
    init: { epoch: string; latest: number; rows?: Record<string, readonly SnapshotRow[]> },
  ) {
    this.epoch = init.epoch;
    this.latest = init.latest;
    this.rows = init.rows ?? {};
  }

  async open(projectId: string, views: readonly SnapshotViewName[]): Promise<PinnedSnapshot> {
    if (projectId !== this.projectId) throw new ProjectNotFoundError(projectId);
    this.opens += 1;
    const asOfSeq = this.latest;
    const streamEpoch = this.epoch;
    const requested = new Set(views);
    const tables = new Map<string, readonly SnapshotRow[]>();
    for (const [view, rows] of Object.entries(this.rows)) {
      if (!requested.has(view as SnapshotViewName)) continue;
      tables.set(view, rows.map((row) => ({ ...row })));
    }
    return {
      asOfSeq,
      streamEpoch,
      async read(view, afterKey, limit) {
        return sliceRows(tables.get(view) ?? [], afterKey, limit);
      },
    };
  }

  async currentEpoch(projectId: string): Promise<string> {
    if (projectId !== this.projectId) throw new ProjectNotFoundError(projectId);
    return this.epoch;
  }

  async currentLatestSeq(projectId: string): Promise<number> {
    if (projectId !== this.projectId) throw new ProjectNotFoundError(projectId);
    return this.latest;
  }
}

export function emptySnapshots(projectId: string): FrozenSnapshots {
  return new FrozenSnapshots(projectId, {
    epoch: "epoch-1",
    latest: 0,
    rows: { board: [{ id: "board", lanes: [] }] },
  });
}

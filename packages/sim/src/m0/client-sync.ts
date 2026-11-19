export interface TaskProjection {
  task: string;
  state: string;
  epoch: number;
  holder: string;
}

export interface OutboxProjection {
  seq: number;
  id: string;
}

export interface ClientSnapshot {
  epoch: number;
  tasks: TaskProjection[];
  outbox: OutboxProjection[];
}

/**
 * Window projection of state.db. A stream_epoch bump forces a full resync so the
 * client cannot keep a gapped or stale view.
 */
export class ClientStateSyncer {
  private snapshot: ClientSnapshot = { epoch: 0, tasks: [], outbox: [] };
  private disconnected = false;

  get epoch(): number {
    return this.snapshot.epoch;
  }

  get connected(): boolean {
    return !this.disconnected;
  }

  current(): ClientSnapshot {
    return {
      epoch: this.snapshot.epoch,
      tasks: this.snapshot.tasks.map((row) => ({ ...row })),
      outbox: this.snapshot.outbox.map((row) => ({ ...row })),
    };
  }

  disconnect(): void {
    this.disconnected = true;
  }

  resync(next: ClientSnapshot): void {
    this.snapshot = {
      epoch: next.epoch,
      tasks: next.tasks.map((row) => ({ ...row })),
      outbox: next.outbox.map((row) => ({ ...row })),
    };
    this.disconnected = false;
  }

  /** Exact ordered parity with state.db, including a strictly increasing seq stream. */
  parityErrors(db: ClientSnapshot): string[] {
    const errors: string[] = [];
    if (this.disconnected) errors.push("client is disconnected");
    if (this.snapshot.epoch !== db.epoch) {
      errors.push(`client epoch ${this.snapshot.epoch} != state epoch ${db.epoch}`);
    }
    if (this.snapshot.tasks.length !== db.tasks.length) {
      errors.push(`client tasks ${this.snapshot.tasks.length} != state tasks ${db.tasks.length}`);
    }
    const limit = Math.max(this.snapshot.tasks.length, db.tasks.length);
    for (let i = 0; i < limit; i += 1) {
      const left = this.snapshot.tasks[i];
      const right = db.tasks[i];
      if (!left || !right) continue;
      if (left.task !== right.task || left.state !== right.state || left.epoch !== right.epoch || left.holder !== right.holder) {
        errors.push(`task projection mismatch at ${right.task}`);
      }
    }
    if (this.snapshot.outbox.length !== db.outbox.length) {
      errors.push(`client outbox ${this.snapshot.outbox.length} != state outbox ${db.outbox.length}`);
    }
    const outLimit = Math.max(this.snapshot.outbox.length, db.outbox.length);
    let previous = -1;
    for (let i = 0; i < outLimit; i += 1) {
      const left = this.snapshot.outbox[i];
      const right = db.outbox[i];
      if (right) {
        if (right.seq <= previous) errors.push(`outbox seq is not strictly increasing at ${right.id}`);
        previous = right.seq;
      }
      if (!left || !right) continue;
      if (left.seq !== right.seq || left.id !== right.id) {
        errors.push(`outbox projection mismatch at ${right.id}`);
      }
    }
    return errors;
  }
}

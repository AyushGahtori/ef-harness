import type { AttemptCoordinator } from "./ports.js";
import type {
  AttemptRecord,
  CheckpointRow,
  ProviderItem,
  TurnLogRow,
} from "./types.js";

interface Snapshot {
  attempts: [string, AttemptRecord][];
  turns: [string, TurnLogRow[]][];
  checkpoints: [string, CheckpointRow][];
  items: [string, ProviderItem[]][];
}

export class MemoryAttemptCoordinator implements AttemptCoordinator {
  private readonly attempts = new Map<string, AttemptRecord>();
  private readonly turnLists = new Map<string, TurnLogRow[]>();
  private readonly checkpoints = new Map<string, CheckpointRow>();
  private readonly itemBlobs = new Map<string, ProviderItem[]>();

  registerAttempt(attempt: AttemptRecord): void {
    if (this.attempts.has(attempt.id)) {
      throw new Error(`attempt ${attempt.id} is already registered`);
    }
    this.attempts.set(attempt.id, attempt);
    this.turnLists.set(attempt.id, []);
  }

  getAttempt(id: string): AttemptRecord {
    const attempt = this.attempts.get(id);
    if (!attempt) throw new Error(`unknown attempt ${id}`);
    return attempt;
  }

  turns(id: string): readonly TurnLogRow[] {
    return this.turnLists.get(id) ?? [];
  }

  checkpoint(id: string): CheckpointRow | null {
    return this.checkpoints.get(id) ?? null;
  }

  items(artifactId: string): readonly ProviderItem[] | null {
    return this.itemBlobs.get(artifactId) ?? null;
  }

  transaction<T>(fn: () => T): T {
    const snap = this.capture();
    try {
      return fn();
    } catch (error) {
      this.restore(snap);
      throw error;
    }
  }

  updateAttempt(id: string, patch: Partial<AttemptRecord>): void {
    const current = this.getAttempt(id);
    Object.assign(current, patch);
  }

  appendTurn(row: TurnLogRow): void {
    const list = this.turnLists.get(row.attempt) ?? [];
    const expected = list.length + 1;
    if (row.step !== expected) {
      throw new Error(`turn_log step ${row.step} is not contiguous; expected ${expected}`);
    }
    this.turnLists.set(row.attempt, [...list, row]);
  }

  saveCheckpoint(row: CheckpointRow): void {
    this.checkpoints.set(row.attempt, row);
  }

  putItems(artifactId: string, items: readonly ProviderItem[]): void {
    this.itemBlobs.set(
      artifactId,
      items.map((item) => ({ ...item })),
    );
  }

  private capture(): Snapshot {
    return structuredClone({
      attempts: [...this.attempts.entries()],
      turns: [...this.turnLists.entries()],
      checkpoints: [...this.checkpoints.entries()],
      items: [...this.itemBlobs.entries()],
    });
  }

  private restore(snap: Snapshot): void {
    this.attempts.clear();
    this.turnLists.clear();
    this.checkpoints.clear();
    this.itemBlobs.clear();
    for (const [id, attempt] of snap.attempts) this.attempts.set(id, attempt);
    for (const [id, rows] of snap.turns) this.turnLists.set(id, rows);
    for (const [id, row] of snap.checkpoints) this.checkpoints.set(id, row);
    for (const [id, items] of snap.items) this.itemBlobs.set(id, items);
  }
}

export function reconstructProviderItems(
  turns: readonly TurnLogRow[],
  load: (artifactId: string) => readonly ProviderItem[] | null,
): ProviderItem[] {
  const seen = new Set<string>();
  const items: ProviderItem[] = [];
  for (const turn of turns) {
    if (!turn.itemsArtifact || seen.has(turn.itemsArtifact)) continue;
    seen.add(turn.itemsArtifact);
    const stored = load(turn.itemsArtifact);
    if (!stored) throw new Error(`missing items artifact ${turn.itemsArtifact}`);
    items.push(...stored);
  }
  return items;
}

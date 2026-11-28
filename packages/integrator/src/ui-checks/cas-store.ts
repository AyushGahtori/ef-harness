import type { CasArtifactRecord } from "./types.js";
import type { CasStorePort } from "./ports.js";

export class InMemoryCasStore implements CasStorePort {
  private readonly records = new Map<string, CasArtifactRecord>();
  private seq = 0;

  put(record: CasArtifactRecord): string {
    const id = record.id || `cas-ui-${++this.seq}`;
    const stored = { ...record, id };
    this.records.set(id, stored);
    return id;
  }

  get(id: string): CasArtifactRecord | null {
    return this.records.get(id) ?? null;
  }

  list(): readonly CasArtifactRecord[] {
    return [...this.records.values()];
  }
}
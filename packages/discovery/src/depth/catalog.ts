import { CatalogError } from "./errors.js";
import type { DepthCatalogEntry } from "./types.js";

export class CatalogIndex {
  private readonly byId = new Map<string, DepthCatalogEntry>();
  private readonly ordered: DepthCatalogEntry[];

  constructor(entries: readonly DepthCatalogEntry[]) {
    this.ordered = [...entries];
    for (const entry of entries) {
      if (this.byId.has(entry.criterionId)) {
        throw new CatalogError(`duplicate criterion ${entry.criterionId}`);
      }
      if (!Number.isInteger(entry.downstreamTaskCount) || entry.downstreamTaskCount < 0) {
        throw new CatalogError(`${entry.criterionId} downstream task count must be a non-negative integer`);
      }
      this.byId.set(entry.criterionId, entry);
    }
  }

  entries(): readonly DepthCatalogEntry[] {
    return this.ordered;
  }

  get(criterionId: string): DepthCatalogEntry {
    const entry = this.byId.get(criterionId);
    if (!entry) throw new CatalogError(`unknown criterion ${criterionId}`);
    return entry;
  }

  has(criterionId: string): boolean {
    return this.byId.has(criterionId);
  }
}

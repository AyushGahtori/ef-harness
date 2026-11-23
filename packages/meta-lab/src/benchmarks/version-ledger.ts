import { BenchmarkVersionMismatchError } from "./errors.js";
import type { MetaLabBenchmarkRegistry } from "./registry.js";

export interface BenchmarkVersionLedgerEntry {
  readonly suiteId: string;
  readonly suiteVersion: string;
  readonly manifestDigest: string;
}

export class BenchmarkVersionLedger {
  private readonly entries: readonly BenchmarkVersionLedgerEntry[];

  constructor(registry: MetaLabBenchmarkRegistry) {
    this.entries = registry.manifestLedger().map((row) => ({ ...row }));
  }

  entriesForSuite(suiteId: string): readonly BenchmarkVersionLedgerEntry[] {
    return this.entries.filter((row) => row.suiteId === suiteId);
  }

  assertPairedComparison(digestA: string, digestB: string): void {
    if (digestA !== digestB) {
      throw new BenchmarkVersionMismatchError(
        "historical results must compare runs on the exact same frozen suite digest",
      );
    }
  }
}
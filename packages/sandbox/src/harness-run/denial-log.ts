import type { DenialLogger, DenialRecord } from "./types.js";

export class MemoryDenialLogger implements DenialLogger {
  readonly records: DenialRecord[] = [];

  logDenial(record: DenialRecord): void {
    this.records.push(record);
  }
}

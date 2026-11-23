import type { ShipRunRecord } from "./types.js";
import type { ShipRunStore } from "./contracts.js";

export class InMemoryShipRunStore implements ShipRunStore {
  readonly #records = new Map<string, ShipRunRecord>();

  get(id: string): ShipRunRecord | undefined {
    return this.#records.get(id);
  }

  upsert(record: ShipRunRecord): void {
    this.#records.set(record.id, record);
  }

  listOpen(): readonly ShipRunRecord[] {
    return [...this.#records.values()].filter((row) => row.status === "pending" || row.status === "running");
  }

  clear(): void {
    this.#records.clear();
  }
}
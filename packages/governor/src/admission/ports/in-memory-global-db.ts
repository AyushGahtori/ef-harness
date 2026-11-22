import type { FootprintRecord } from "../types.js";
import type {
  FootprintsRepo,
  GlobalDbPort,
  MachineProfileEntry,
  MachineProfileRepo,
} from "./global-db.js";

export class InMemoryMachineProfileRepo implements MachineProfileRepo {
  private readonly rows = new Map<string, MachineProfileEntry>();

  get(key: string): MachineProfileEntry | null {
    return this.rows.get(key) ?? null;
  }

  set(key: string, value: string, measuredAt: number): void {
    this.rows.set(key, { key, value, measuredAt });
  }

  list(): readonly MachineProfileEntry[] {
    return [...this.rows.values()];
  }
}

export class InMemoryFootprintsRepo implements FootprintsRepo {
  private readonly rows = new Map<string, FootprintRecord>();

  get(consumer: string, project: string): FootprintRecord | null {
    return this.rows.get(this.key(consumer, project)) ?? null;
  }

  upsert(record: FootprintRecord): void {
    this.rows.set(this.key(record.consumer, record.project), record);
  }

  list(): readonly FootprintRecord[] {
    return [...this.rows.values()];
  }

  private key(consumer: string, project: string): string {
    return `${project}\u0000${consumer}`;
  }
}

export class InMemoryGlobalDb implements GlobalDbPort {
  readonly machineProfile = new InMemoryMachineProfileRepo();
  readonly footprints = new InMemoryFootprintsRepo();
}

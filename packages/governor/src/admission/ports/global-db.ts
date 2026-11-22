import type { FootprintRecord } from "../types.js";

/**
 * Local port of Task 014 `GlobalDbRepo.machine_profile` and `GlobalDbRepo.footprints`.
 * Column names match `schema/global.sql`. Extended footprint metrics are carried on the
 * same record until a schema migration adds columns for them.
 */
export interface MachineProfileEntry {
  readonly key: string;
  readonly value: string;
  readonly measuredAt: number;
}

export interface MachineProfileRepo {
  get(key: string): MachineProfileEntry | null;
  set(key: string, value: string, measuredAt: number): void;
  list(): readonly MachineProfileEntry[];
}

export interface FootprintsRepo {
  get(consumer: string, project: string): FootprintRecord | null;
  upsert(record: FootprintRecord): void;
  list(): readonly FootprintRecord[];
}

export interface GlobalDbPort {
  readonly machineProfile: MachineProfileRepo;
  readonly footprints: FootprintsRepo;
}

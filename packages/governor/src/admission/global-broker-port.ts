import { GlobalBrokerDb, type FootprintEntry, type MachineProfileEntry } from "@ef-harness/db";
import type { FootprintRecord } from "./types.js";
import type { FootprintsRepo, GlobalDbPort, MachineProfileRepo } from "./ports/global-db.js";

function recordFromEntry(entry: FootprintEntry): FootprintRecord {
  return {
    consumer: entry.consumer,
    project: entry.project,
    p50Mb: entry.p50Mb,
    p95Mb: entry.p95Mb,
    samples: entry.samples,
    updatedAt: entry.updatedAt,
    p90Mb: entry.p90Mb ?? 0,
    peakRamMb: entry.peakRamMb ?? 0,
    peakCpuTimeMs: entry.peakCpuTimeMs ?? 0,
    diskWriteBytes: entry.diskWriteBytes ?? 0,
    wallClockMs: entry.wallClockMs ?? 0,
    highWatermarkMb: entry.highWatermarkMb ?? 0,
    predictedMb: entry.predictedMb ?? 0,
    peakRamSamplesMb: entry.peakRamSamplesMb ?? [],
  };
}

class BrokerMachineProfile implements MachineProfileRepo {
  constructor(private readonly db: GlobalBrokerDb) {}

  get(key: string): MachineProfileEntry | null {
    return this.db.getMachineProfile(key);
  }

  set(key: string, value: string, measuredAt: number): void {
    this.db.setMachineProfile(key, value, measuredAt);
  }

  list(): readonly MachineProfileEntry[] {
    return this.db.listMachineProfiles();
  }
}

class BrokerFootprints implements FootprintsRepo {
  constructor(private readonly db: GlobalBrokerDb) {}

  get(consumer: string, project: string): FootprintRecord | null {
    const entry = this.db.getFootprint(consumer, project);
    return entry ? recordFromEntry(entry) : null;
  }

  upsert(record: FootprintRecord): void {
    this.db.setFootprint(record);
  }

  list(): readonly FootprintRecord[] {
    return this.db.listFootprints().map((entry) => recordFromEntry(entry));
  }
}

/** Persists learned footprints through the single-writer global broker. */
export function openGlobalBrokerPort(db: GlobalBrokerDb): GlobalDbPort {
  return {
    machineProfile: new BrokerMachineProfile(db),
    footprints: new BrokerFootprints(db),
  };
}

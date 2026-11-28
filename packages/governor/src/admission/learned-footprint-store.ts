import type { JobObjectFootprintReading } from "./ports/hardware-snapshot.js";
import type { GlobalDbPort } from "./ports/global-db.js";
import {
  EMA_HIGH_WATERMARK_ALPHA,
  FOOTPRINT_SAMPLE_CAP,
  defaultFootprintMb,
  mbFromBytes,
} from "./thresholds.js";
import {
  footprintSchemaColumns,
  type CommandClass,
  type FootprintRecord,
  type FootprintSchemaColumns,
} from "./types.js";

export interface FootprintObservation {
  readonly projectId: string;
  readonly commandClass: CommandClass;
  readonly reading: JobObjectFootprintReading;
  readonly observedAtMs: number;
}

export interface WorkloadFootprintEstimate {
  readonly taskId: string;
  readonly predictedMb: number;
  readonly wallClockMs: number;
}

function percentileNearestRank(sortedAsc: readonly number[], percentile: number): number {
  const count = sortedAsc.length;
  const last = sortedAsc[count - 1];
  if (count === 0 || last === undefined) {
    throw new Error("percentile requires at least one sample");
  }
  const rank = Math.ceil((percentile / 100) * count);
  const index = Math.min(count - 1, Math.max(0, rank - 1));
  return sortedAsc[index] ?? last;
}

function nextHighWatermark(previous: number | null, sample: number): number {
  if (previous === null) return sample;
  if (sample >= previous) return sample;
  return EMA_HIGH_WATERMARK_ALPHA * sample + (1 - EMA_HIGH_WATERMARK_ALPHA) * previous;
}

/**
 * Learns per `(project, command class)` RAM, CPU, disk writes, and duration.
 * Admission uses max(p90, exponential high-watermark). Empty projects keep the
 * conservative class defaults until the first Job Object reading.
 */
export class LearnedFootprintStore {
  constructor(private readonly db: GlobalDbPort) {}

  predictionMb(projectId: string, commandClass: CommandClass): number {
    return this.get(projectId, commandClass)?.predictedMb ?? defaultFootprintMb(commandClass);
  }

  estimate(taskId: string, projectId: string, commandClass: CommandClass): WorkloadFootprintEstimate | null {
    const record = this.get(projectId, commandClass);
    if (!record || record.samples < 1 || record.wallClockMs < 1) return null;
    return {
      taskId,
      predictedMb: record.predictedMb,
      wallClockMs: Math.ceil(record.wallClockMs),
    };
  }

  get(projectId: string, commandClass: CommandClass): FootprintRecord | null {
    return this.db.footprints.get(commandClass, projectId);
  }

  schemaRow(projectId: string, commandClass: CommandClass): FootprintSchemaColumns | null {
    const record = this.get(projectId, commandClass);
    return record ? footprintSchemaColumns(record) : null;
  }

  record(observation: FootprintObservation): FootprintRecord {
    const previous = this.get(observation.projectId, observation.commandClass);
    const peakRamMb = mbFromBytes(observation.reading.peakJobMemoryUsedBytes);
    const cpuMs = Math.max(
      0,
      observation.reading.totalUserTimeMs + observation.reading.totalKernelTimeMs,
    );
    const samples = [...(previous?.peakRamSamplesMb ?? []), peakRamMb].slice(-FOOTPRINT_SAMPLE_CAP);
    const sorted = [...samples].sort((left, right) => left - right);
    const p50Mb = Math.ceil(percentileNearestRank(sorted, 50));
    const p90Mb = Math.ceil(percentileNearestRank(sorted, 90));
    const p95Mb = Math.ceil(percentileNearestRank(sorted, 95));
    const highWatermarkMb = nextHighWatermark(previous?.highWatermarkMb ?? null, peakRamMb);
    const predictedMb = Math.max(p90Mb, Math.ceil(highWatermarkMb));
    const record: FootprintRecord = {
      consumer: observation.commandClass,
      project: observation.projectId,
      p50Mb,
      p95Mb,
      samples: (previous?.samples ?? 0) + 1,
      updatedAt: observation.observedAtMs,
      p90Mb,
      peakRamMb: Math.max(previous?.peakRamMb ?? 0, peakRamMb),
      peakCpuTimeMs: Math.max(previous?.peakCpuTimeMs ?? 0, cpuMs),
      diskWriteBytes: Math.max(previous?.diskWriteBytes ?? 0, observation.reading.diskWriteBytes),
      wallClockMs: Math.max(previous?.wallClockMs ?? 0, observation.reading.wallClockMs),
      highWatermarkMb,
      predictedMb,
      peakRamSamplesMb: samples,
    };
    this.db.footprints.upsert(record);
    return record;
  }
}

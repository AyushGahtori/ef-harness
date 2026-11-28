export const PRESSURE_LEVELS = ["GREEN", "YELLOW", "ORANGE", "RED"] as const;

export type PressureLevel = (typeof PRESSURE_LEVELS)[number];

export const COMMAND_CLASSES = [
  "typecheck",
  "unit_test",
  "playwright",
  "build",
  "pnpm_install",
  "db_migrate",
] as const;

export type CommandClass = (typeof COMMAND_CLASSES)[number];

export const HEAVY_LANE_ROLES = ["verifier", "worker", "background"] as const;

export type HeavyLaneRole = (typeof HEAVY_LANE_ROLES)[number];

export const HEAVY_COMMAND_CLASSES = [
  "typecheck",
  "playwright",
  "build",
  "pnpm_install",
  "db_migrate",
] as const satisfies readonly CommandClass[];

export type HeavyCommandClass = (typeof HEAVY_COMMAND_CLASSES)[number];

export function isHeavyCommandClass(commandClass: CommandClass): commandClass is HeavyCommandClass {
  return (HEAVY_COMMAND_CLASSES as readonly CommandClass[]).includes(commandClass);
}

export function pressureRank(level: PressureLevel): number {
  return PRESSURE_LEVELS.indexOf(level);
}

export interface FootprintRecord {
  readonly consumer: string;
  readonly project: string;
  readonly p50Mb: number;
  readonly p95Mb: number;
  readonly samples: number;
  readonly updatedAt: number;
  readonly p90Mb: number;
  readonly peakRamMb: number;
  readonly peakCpuTimeMs: number;
  readonly diskWriteBytes: number;
  readonly wallClockMs: number;
  readonly highWatermarkMb: number;
  readonly predictedMb: number;
  readonly peakRamSamplesMb: readonly number[];
}

export interface FootprintSchemaColumns {
  readonly consumer: string;
  readonly project: string;
  readonly p50_mb: number;
  readonly p95_mb: number;
  readonly samples: number;
  readonly updated_at: number;
}

export function footprintSchemaColumns(record: FootprintRecord): FootprintSchemaColumns {
  return {
    consumer: record.consumer,
    project: record.project,
    p50_mb: record.p50Mb,
    p95_mb: record.p95Mb,
    samples: record.samples,
    updated_at: record.updatedAt,
  };
}

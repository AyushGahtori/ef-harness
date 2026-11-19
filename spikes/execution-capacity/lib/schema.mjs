export const MACHINE_PROFILE_KEYS = ["ram_total_mb", "cores", "gpu", "dev_drive", "calibration_run"];

export const FOOTPRINT_CONSUMERS = ["worker_cli", "dev_server", "build", "browser"];

/**
 * @param {string} key
 * @param {string} value
 * @param {number} measuredAt
 */
export function machineProfileRow(key, value, measuredAt) {
  if (!MACHINE_PROFILE_KEYS.includes(key)) {
    throw new Error(`machine_profile key is not in the global schema: ${key}`);
  }
  if (!Number.isInteger(measuredAt) || measuredAt < 0) {
    throw new Error("measured_at must be a non-negative integer millisecond timestamp");
  }
  return { key, value: String(value), measured_at: measuredAt };
}

/**
 * @param {{ consumer: string, project?: string, p50Mb: number, p95Mb: number, samples: number, updatedAt: number }} input
 */
export function footprintRow(input) {
  const p50 = Math.round(input.p50Mb);
  const p95 = Math.round(input.p95Mb);
  if (!Number.isInteger(p50) || !Number.isInteger(p95) || p50 < 0 || p95 < 0) {
    throw new Error("footprint memory fields must be non-negative integers");
  }
  if (!Number.isInteger(input.samples) || input.samples < 1) {
    throw new Error("footprint samples must be a positive integer");
  }
  if (!Number.isInteger(input.updatedAt) || input.updatedAt < 0) {
    throw new Error("footprint updated_at must be a non-negative integer");
  }
  return {
    consumer: input.consumer,
    project: input.project ?? "",
    p50_mb: p50,
    p95_mb: p95,
    samples: input.samples,
    updated_at: input.updatedAt,
  };
}

/**
 * @param {readonly { key: string, value: string, measured_at: number }[]} rows
 */
export function assertMachineProfile(rows) {
  const keys = new Set(rows.map((row) => row.key));
  for (const key of MACHINE_PROFILE_KEYS) {
    if (!keys.has(key)) throw new Error(`machine_profile is missing ${key}`);
  }
  for (const row of rows) {
    if (typeof row.value !== "string") throw new Error(`machine_profile ${row.key} value must be text`);
    if (!Number.isInteger(row.measured_at)) throw new Error(`machine_profile ${row.key} measured_at must be an integer`);
  }
}

/**
 * @param {readonly { consumer: string, project: string, p50_mb: number, p95_mb: number, samples: number, updated_at: number }[]} rows
 */
export function assertFootprints(rows) {
  for (const row of rows) {
    for (const field of ["p50_mb", "p95_mb", "samples", "updated_at"]) {
      if (!Number.isInteger(row[field])) {
        throw new Error(`footprints.${row.consumer}.${field} must be an integer`);
      }
    }
    if (typeof row.consumer !== "string" || typeof row.project !== "string") {
      throw new Error("footprints consumer and project must be text");
    }
  }
}

import type {
  ConformanceRow,
  ConformanceStatusValue,
  HardwareSample,
  PoolUtilization,
  PressureLevel,
  ProviderHealth,
  StorageHygiene,
  WorkerHealth,
} from "./types.js";

const PRESSURE: readonly PressureLevel[] = ["Green", "Yellow", "Orange", "Red"];

export function parseHardwareRows(
  kind: string,
  ts: number,
  data: string,
): HardwareSample[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  if (kind === "hw_1hz") {
    const sample = parseSample(parsed, ts);
    return sample ? [sample] : [];
  }
  if (kind === "hw_minute") {
    return parseMinute(parsed, ts);
  }
  return [];
}

export function parseSqliteWrite(data: string): {
  readonly latencyMs: number;
  readonly busyRetries: number;
} | null {
  const record = parseRecord(data);
  if (!record) return null;
  const latencyMs = asNumber(record.latencyMs);
  const busyRetries = asNumber(record.busyRetries) ?? 0;
  if (latencyMs === null) return null;
  return { latencyMs, busyRetries };
}

export function parseProvider(data: string): ProviderHealth | null {
  const record = parseRecord(data);
  if (!record) return null;
  const connectionId = asString(record.connectionId);
  const latencyMs = asNumber(record.latencyMs);
  const rateLimit429 = asNumber(record.rateLimit429);
  const aimdConcurrency = asNumber(record.aimdConcurrency);
  if (!connectionId || latencyMs === null || rateLimit429 === null || aimdConcurrency === null) {
    return null;
  }
  return { connectionId, latencyMs, rateLimit429, aimdConcurrency };
}

export function parseWorker(data: string): WorkerHealth | null {
  const record = parseRecord(data);
  if (!record) return null;
  const pass = asNumber(record.pass);
  const retry = asNumber(record.retry);
  const stuck = asNumber(record.stuck);
  const loop = asNumber(record.loop);
  if (pass === null || retry === null || stuck === null || loop === null) return null;
  return { pass, retry, stuck, loop };
}

export function parseConformance(data: string): ConformanceRow | null {
  const record = parseRecord(data);
  if (!record) return null;
  const adapterId = asString(record.adapterId);
  const status = asString(record.status);
  const detail = asString(record.detail) ?? "";
  if (!adapterId || !isConformance(status)) return null;
  return { adapterId, status, detail };
}

export function parseStorage(data: string): StorageHygiene | null {
  const record = parseRecord(data);
  if (!record) return null;
  const casBlobBytes = asNumber(record.casBlobBytes);
  const archivedZstdLogBytes = asNumber(record.archivedZstdLogBytes);
  const activeWorktreeCount = asNumber(record.activeWorktreeCount);
  if (
    casBlobBytes === null ||
    archivedZstdLogBytes === null ||
    activeWorktreeCount === null
  ) {
    return null;
  }
  return { casBlobBytes, archivedZstdLogBytes, activeWorktreeCount };
}

export function parseBackup(data: string): number | null {
  const record = parseRecord(data);
  if (!record) return null;
  return asNumber(record.verifiedAt);
}

export function emptyPools(): [PoolUtilization, PoolUtilization, PoolUtilization] {
  return [
    { id: 1, name: "Thinking", used: 0, capacity: 0 },
    { id: 2, name: "Warm execution", used: 0, capacity: 0 },
    { id: 3, name: "Services", used: 0, capacity: 0 },
  ];
}

export function emptyWorker(): WorkerHealth {
  return { pass: 0, retry: 0, stuck: 0, loop: 0 };
}

export function emptyStorage(): StorageHygiene {
  return { casBlobBytes: 0, archivedZstdLogBytes: 0, activeWorktreeCount: 0 };
}

function parseMinute(value: object, ts: number): HardwareSample[] {
  const record = value as Record<string, unknown>;
  const count = asNumber(record.count);
  if (count === null || count <= 0) return [];
  const stepMs = asNumber(record.stepMs) ?? 1000;
  const samples: HardwareSample[] = [];
  for (let index = 0; index < count; index += 1) {
    const sample = parseSample(
      {
        ramUsedBytes: arrayNumber(record.ramUsedBytes, index),
        ramTotalBytes: arrayNumber(record.ramTotalBytes, index),
        commitUsedBytes: arrayNumber(record.commitUsedBytes, index),
        commitLimitBytes: arrayNumber(record.commitLimitBytes, index),
        diskFreeProjectBytes: arrayNumber(record.diskFreeProjectBytes, index),
        diskFreeAppDataBytes: arrayNumber(record.diskFreeAppDataBytes, index),
        avCpuPercent: arrayNumber(record.avCpuPercent, index),
        uiInputToPaintP95Ms: arrayNumber(record.uiInputToPaintP95Ms, index),
        pressure: arrayString(record.pressure, index),
        pools: arrayPools(record.pools, index),
      },
      ts + index * stepMs,
    );
    if (sample) samples.push(sample);
  }
  return samples;
}

function parseSample(value: object, at: number): HardwareSample | null {
  const record = value as Record<string, unknown>;
  const ramUsedBytes = asNumber(record.ramUsedBytes);
  const ramTotalBytes = asNumber(record.ramTotalBytes);
  const commitUsedBytes = asNumber(record.commitUsedBytes);
  const commitLimitBytes = asNumber(record.commitLimitBytes);
  const diskFreeProjectBytes = asNumber(record.diskFreeProjectBytes);
  const diskFreeAppDataBytes = asNumber(record.diskFreeAppDataBytes);
  const avCpuPercent = asNumber(record.avCpuPercent);
  const uiInputToPaintP95Ms = asNumber(record.uiInputToPaintP95Ms);
  const pressure = asPressure(record.pressure);
  const pools = asPools(record.pools);
  if (
    ramUsedBytes === null ||
    ramTotalBytes === null ||
    commitUsedBytes === null ||
    commitLimitBytes === null ||
    diskFreeProjectBytes === null ||
    diskFreeAppDataBytes === null ||
    avCpuPercent === null ||
    uiInputToPaintP95Ms === null ||
    !pressure ||
    !pools
  ) {
    return null;
  }
  return {
    at,
    ramUsedBytes,
    ramTotalBytes,
    commitUsedBytes,
    commitLimitBytes,
    diskFreeProjectBytes,
    diskFreeAppDataBytes,
    avCpuPercent,
    uiInputToPaintP95Ms,
    pressure,
    pools,
  };
}

function asPools(value: unknown): HardwareSample["pools"] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const names = ["Thinking", "Warm execution", "Services"] as const;
  const pools: PoolUtilization[] = [];
  for (let index = 0; index < 3; index += 1) {
    const item = value[index];
    const id = (index + 1) as 1 | 2 | 3;
    const name = names[index] ?? `Pool ${id}`;
    if (Array.isArray(item)) {
      const used = asNumber(item[0]);
      const capacity = asNumber(item[1]);
      if (used === null || capacity === null) return null;
      pools.push({ id, name, used, capacity });
      continue;
    }
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const used = asNumber(record.used);
    const capacity = asNumber(record.capacity);
    if (used === null || capacity === null) return null;
    pools.push({ id, name: asString(record.name) ?? name, used, capacity });
  }
  const [first, second, third] = pools;
  if (!first || !second || !third) return null;
  return [first, second, third];
}

function arrayPools(value: unknown, index: number): unknown {
  if (!Array.isArray(value)) return null;
  return value[index] ?? null;
}

function arrayNumber(value: unknown, index: number): number | null {
  if (!Array.isArray(value)) return null;
  return asNumber(value[index]);
}

function arrayString(value: unknown, index: number): string | null {
  if (!Array.isArray(value)) return null;
  return asString(value[index]);
}

function parseRecord(data: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(data) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

function asPressure(value: unknown): PressureLevel | null {
  return typeof value === "string" && PRESSURE.includes(value as PressureLevel)
    ? (value as PressureLevel)
    : null;
}

function isConformance(value: string | null): value is ConformanceStatusValue {
  return value === "pass" || value === "fail" || value === "skipped";
}

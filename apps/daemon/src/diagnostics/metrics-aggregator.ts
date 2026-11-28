import { existsSync } from "node:fs";
import type {
  BackupStatusPort,
  ConformancePort,
  HardwareRingBufferPort,
  LearnedFootprintPort,
  PressureHistoryPort,
  ProviderHealthPort,
  StorageHygienePort,
} from "./ports.js";
import { downsampleSeries, percentileNearestRank } from "./percentile.js";
import {
  emptyPools,
  emptyStorage,
  emptyWorker,
  parseBackup,
  parseConformance,
  parseHardwareRows,
  parseProvider,
  parseSqliteWrite,
  parseStorage,
  parseWorker,
} from "./telemetry-parse.js";
import {
  inspectSqliteFile,
  readLatestTelemetryKind,
  readTelemetryRows,
} from "./telemetry-db.js";
import {
  SPARKLINE_POINT_CAP,
  SQLITE_WRITE_SLO_MS,
  TELEMETRY_UNAVAILABLE_MESSAGE,
  type DiagnosticsSnapshot,
  type HardwareSample,
  type NamedSparkline,
  type PoolUtilization,
  type PressureLevel,
  type PressurePoint,
  type ProviderHealth,
  type SqliteDatabaseHealth,
} from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DiagnosticsMetricsDependencies {
  readonly telemetryPath: string;
  readonly stateDbPath: string;
  readonly globalDbPath: string;
  readonly ringBuffer: HardwareRingBufferPort;
  readonly pressure: PressureHistoryPort;
  readonly footprints: LearnedFootprintPort;
  readonly backup: BackupStatusPort;
  readonly providers: ProviderHealthPort;
  readonly conformance: ConformancePort;
  readonly storage: StorageHygienePort;
  readonly clock?: () => number;
}

export class DiagnosticsMetricsAggregator {
  constructor(private readonly deps: DiagnosticsMetricsDependencies) {}

  aggregate(nowMs?: number): DiagnosticsSnapshot {
    const generatedAt = nowMs ?? this.deps.clock?.() ?? Date.now();
    const since = generatedAt - DAY_MS;
    const databases = [
      inspectSqliteFile(this.deps.stateDbPath, "state.db"),
      inspectSqliteFile(this.deps.globalDbPath, "global.db"),
      inspectSqliteFile(this.deps.telemetryPath, "telemetry.db"),
    ];
    try {
      const telemetry = databases.find((row) => row.name === "telemetry.db");
      if (!existsSync(this.deps.telemetryPath) || telemetry?.quickCheck !== "ok") {
        return this.unavailable(generatedAt, databases, "unreadable");
      }
      const rows = readTelemetryRows(this.deps.telemetryPath, since);
      const samples: HardwareSample[] = [];
      const latencies: number[] = [];
      let busyRetryCount = 0;
      const providers = new Map<string, ProviderHealth>();
      let workers = emptyWorker();
      const conformance = new Map<string, ReturnType<typeof parseConformance>>();
      for (const row of rows) {
        if (row.kind === "hw_1hz" || row.kind === "hw_minute") {
          samples.push(...parseHardwareRows(row.kind, row.ts, row.data));
        } else if (row.kind === "sqlite_write") {
          const write = parseSqliteWrite(row.data);
          if (!write) continue;
          latencies.push(write.latencyMs);
          busyRetryCount += write.busyRetries;
        } else if (row.kind === "provider") {
          const provider = parseProvider(row.data);
          if (!provider) continue;
          const prior = providers.get(provider.connectionId);
          providers.set(provider.connectionId, {
            connectionId: provider.connectionId,
            latencyMs: provider.latencyMs,
            rateLimit429: (prior?.rateLimit429 ?? 0) + provider.rateLimit429,
            aimdConcurrency: provider.aimdConcurrency,
          });
        } else if (row.kind === "worker") {
          const worker = parseWorker(row.data);
          if (!worker) continue;
          workers = {
            pass: workers.pass + worker.pass,
            retry: workers.retry + worker.retry,
            stuck: workers.stuck + worker.stuck,
            loop: workers.loop + worker.loop,
          };
        } else if (row.kind === "conformance") {
          const rowConformance = parseConformance(row.data);
          if (rowConformance) conformance.set(rowConformance.adapterId, rowConformance);
        }
      }
      for (const live of this.deps.ringBuffer.readSince(since)) {
        if (live.at >= since && live.at <= generatedAt) samples.push(live);
      }
      samples.sort((left, right) => left.at - right.at);
      for (const live of this.deps.providers.current()) {
        if (!providers.has(live.connectionId)) providers.set(live.connectionId, live);
      }
      for (const live of this.deps.conformance.current()) {
        if (!conformance.has(live.adapterId)) conformance.set(live.adapterId, live);
      }
      const latest = samples[samples.length - 1] ?? null;
      const storage = this.readStorage();
      const backupAt = this.readBackup(generatedAt);
      const pressureHistory = this.pressureHistory(since, generatedAt, samples);
      const currentPressure = this.deps.pressure.current() ?? pressureHistory[pressureHistory.length - 1] ?? null;
      const sortedLatency = [...latencies].sort((left, right) => left - right);
      const p99Ms = percentileNearestRank(sortedLatency, 99);
      const conformanceRows = [...conformance.values()].filter(
        (row): row is NonNullable<typeof row> => row !== null,
      );
      return {
        generatedAt,
        windowMs: DAY_MS,
        telemetryAvailable: true,
        unavailableMessage: null,
        databases,
        writeLatency: {
          sampleCount: sortedLatency.length,
          p50Ms: percentileNearestRank(sortedLatency, 50),
          p95Ms: percentileNearestRank(sortedLatency, 95),
          p99Ms,
          busyRetryCount,
          sloMs: SQLITE_WRITE_SLO_MS,
          withinSlo: p99Ms !== null && p99Ms < SQLITE_WRITE_SLO_MS,
        },
        lastVerifiedBackupAt: backupAt,
        sparklines: buildSparklines(samples),
        pressureHistory,
        currentPressure,
        pools: latest ? [...latest.pools] : [...emptyPools()],
        footprints: this.deps.footprints.list(),
        providers: [...providers.values()],
        workers,
        conformance: conformanceRows,
        storage,
        recentErrors: [],
      };
    } catch {
      return this.unavailable(generatedAt, databases, "unreadable");
    }
  }

  private unavailable(
    generatedAt: number,
    databases: readonly SqliteDatabaseHealth[],
    reason: string,
  ): DiagnosticsSnapshot {
    return {
      generatedAt,
      windowMs: DAY_MS,
      telemetryAvailable: false,
      unavailableMessage: TELEMETRY_UNAVAILABLE_MESSAGE,
      databases,
      writeLatency: {
        sampleCount: 0,
        p50Ms: null,
        p95Ms: null,
        p99Ms: null,
        busyRetryCount: 0,
        sloMs: SQLITE_WRITE_SLO_MS,
        withinSlo: false,
      },
      lastVerifiedBackupAt: null,
      sparklines: [],
      pressureHistory: [],
      currentPressure: null,
      pools: [...emptyPools()],
      footprints: [],
      providers: [],
      workers: emptyWorker(),
      conformance: [],
      storage: emptyStorage(),
      recentErrors: [TELEMETRY_UNAVAILABLE_MESSAGE, reason],
    };
  }

  private readStorage() {
    try {
      const row = readLatestTelemetryKind(this.deps.telemetryPath, "storage");
      const parsed = row ? parseStorage(row.data) : null;
      return parsed ?? this.deps.storage.current() ?? emptyStorage();
    } catch {
      return this.deps.storage.current() ?? emptyStorage();
    }
  }

  private readBackup(nowMs: number): number | null {
    let fromDb: number | null = null;
    try {
      const row = readLatestTelemetryKind(this.deps.telemetryPath, "backup");
      fromDb = row ? parseBackup(row.data) : null;
    } catch {
      fromDb = null;
    }
    const fromPort = this.deps.backup.lastVerifiedAt();
    if (fromDb === null) return fromPort;
    if (fromPort === null) return fromDb;
    return Math.max(fromDb, fromPort) <= nowMs + DAY_MS ? Math.max(fromDb, fromPort) : fromDb;
  }

  private pressureHistory(
    since: number,
    nowMs: number,
    samples: readonly HardwareSample[],
  ): PressurePoint[] {
    const fromPort = this.deps.pressure.history(since).filter((point) => point.at >= since && point.at <= nowMs);
    if (fromPort.length > 0) return [...fromPort].sort((left, right) => left.at - right.at);
    const derived: PressurePoint[] = [];
    let previous: PressureLevel | null = null;
    for (const sample of samples) {
      if (sample.pressure === previous) continue;
      previous = sample.pressure;
      derived.push({
        at: sample.at,
        level: sample.pressure,
        reason: pressureReason(sample),
      });
    }
    return derived;
  }
}

function pressureReason(sample: HardwareSample): string {
  const freeRatio =
    sample.ramTotalBytes <= 0 ? 1 : (sample.ramTotalBytes - sample.ramUsedBytes) / sample.ramTotalBytes;
  if (sample.pressure === "Red") return "RAM low or commit charge critical";
  if (sample.pressure === "Orange") return `RAM low (${Math.round(freeRatio * 100)}% free)`;
  if (sample.avCpuPercent > 25) return "Windows Defender scanning";
  if (sample.uiInputToPaintP95Ms > 50) return "UI latency > 50 ms";
  if (sample.diskFreeAppDataBytes < 5 * 1024 * 1024 * 1024) return "Disk headroom is low";
  return `${sample.pressure} pressure`;
}

function buildSparklines(samples: readonly HardwareSample[]): NamedSparkline[] {
  const specs: readonly {
    readonly id: string;
    readonly label: string;
    readonly unit: string;
    readonly value: (sample: HardwareSample) => number;
  }[] = [
    {
      id: "ram",
      label: "RAM used",
      unit: "bytes",
      value: (sample) => sample.ramUsedBytes,
    },
    {
      id: "commit",
      label: "Commit used",
      unit: "bytes",
      value: (sample) => sample.commitUsedBytes,
    },
    {
      id: "disk-project",
      label: "Project drive free",
      unit: "bytes",
      value: (sample) => sample.diskFreeProjectBytes,
    },
    {
      id: "disk-appdata",
      label: "AppData drive free",
      unit: "bytes",
      value: (sample) => sample.diskFreeAppDataBytes,
    },
    {
      id: "av-cpu",
      label: "MsMpEng.exe CPU",
      unit: "percent",
      value: (sample) => sample.avCpuPercent,
    },
    {
      id: "ui-latency",
      label: "UI input-to-paint p95",
      unit: "ms",
      value: (sample) => sample.uiInputToPaintP95Ms,
    },
    {
      id: "pool-1",
      label: "Pool 1 slot utilization",
      unit: "percent",
      value: (sample) => utilization(sample.pools[0]),
    },
    {
      id: "pool-2",
      label: "Pool 2 slot utilization",
      unit: "percent",
      value: (sample) => utilization(sample.pools[1]),
    },
    {
      id: "pool-3",
      label: "Pool 3 slot utilization",
      unit: "percent",
      value: (sample) => utilization(sample.pools[2]),
    },
  ];
  return specs.map((spec) => {
    const raw = samples.map((sample) => ({ at: sample.at, value: spec.value(sample) }));
    const values = raw.map((point) => point.value);
    return {
      id: spec.id,
      label: spec.label,
      unit: spec.unit,
      points: downsampleSeries(raw, SPARKLINE_POINT_CAP),
      min: values.length === 0 ? 0 : Math.min(...values),
      max: values.length === 0 ? 0 : Math.max(...values),
      latest: values[values.length - 1] ?? 0,
    };
  });
}

function utilization(pool: PoolUtilization | undefined): number {
  if (!pool || pool.capacity <= 0) return 0;
  return (pool.used / pool.capacity) * 100;
}

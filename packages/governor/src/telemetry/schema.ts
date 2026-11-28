import { commitIsExhausted, freeRatio, hardwareSnapshot } from "./snapshot.js";
import {
  COLLECTOR_CADENCES,
  DEFENDER_CONTENTION_CPU_PERCENT,
  DEFENDER_PROCESS_NAME,
  HARDWARE_SNAPSHOT_SCHEMA_ID,
  HardwareSnapshotError,
  JOB_ROLES,
  PROVIDER_KINDS,
  UI_HEARTBEAT_HZ,
  UI_LATENCY_PRESSURE_MS,
  VOLUME_ROLES,
  type CollectorCadence,
  type DefenderSample,
  type DiskSample,
  type GpuSample,
  type HardwareSnapshot,
  type JobAccountingSample,
  type JobRole,
  type MemorySample,
  type ProviderKind,
  type UiLatencySample,
  type VolumeSample,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export const HardwareSnapshotSchema = {
  schemaId: HARDWARE_SNAPSHOT_SCHEMA_ID,
  parse(value: unknown): HardwareSnapshot {
    const issues: string[] = [];
    const snapshot = readSnapshot(value, issues);
    if (issues.length > 0 || !snapshot) throw new HardwareSnapshotError(issues);
    return snapshot;
  },
  safeParse(
    value: unknown,
  ): { success: true; data: HardwareSnapshot } | { success: false; error: HardwareSnapshotError } {
    try {
      return { success: true, data: this.parse(value) };
    } catch (error) {
      if (error instanceof HardwareSnapshotError) return { success: false, error };
      throw error;
    }
  },
};

function readSnapshot(value: unknown, issues: string[]): HardwareSnapshot | null {
  if (!isRecord(value)) {
    issues.push("snapshot must be an object");
    return null;
  }
  if (value["schemaId"] !== HARDWARE_SNAPSHOT_SCHEMA_ID) issues.push("schemaId is not hardware snapshot v1");
  const provider = readEnum(value["provider"], PROVIDER_KINDS, "provider", issues);
  const cadence = readEnum(value["cadence"], COLLECTOR_CADENCES, "cadence", issues);
  const sampledAtMs = value["sampledAtMs"];
  const sampleDurationMs = value["sampleDurationMs"];
  if (!nonNegativeInt(sampledAtMs)) issues.push("sampledAtMs must be a non-negative integer");
  if (!finite(sampleDurationMs) || sampleDurationMs < 0) {
    issues.push("sampleDurationMs must be a non-negative finite number");
  }
  const memory = readMemory(value["memory"], issues);
  const jobs = readJobs(value["jobs"], issues);
  const gpu = readGpu(value["gpu"], issues);
  const disk = readDisk(value["disk"], issues);
  const defender = readDefender(value["defender"], issues);
  const ui = readUi(value["ui"], issues);
  const unavailableMetrics = readStrings(value["unavailableMetrics"], "unavailableMetrics", issues);
  if (
    issues.length > 0 ||
    !provider ||
    !cadence ||
    !memory ||
    !jobs ||
    !gpu ||
    !disk ||
    !defender ||
    !ui ||
    !unavailableMetrics ||
    !nonNegativeInt(sampledAtMs) ||
    !finite(sampleDurationMs)
  ) {
    return null;
  }
  return hardwareSnapshot({
    sampledAtMs,
    provider,
    cadence,
    memory,
    jobs,
    gpu,
    disk,
    defender,
    ui,
    unavailableMetrics,
    sampleDurationMs,
  });
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
  issues: string[],
): T | null {
  if (typeof value === "string" && allowed.some((item) => item === value)) return value as T;
  issues.push(`${label} is invalid`);
  return null;
}

function readMemory(value: unknown, issues: string[]): MemorySample | null {
  if (!isRecord(value)) {
    issues.push("memory must be an object");
    return null;
  }
  const totalPhysicalBytes = intField(value, "totalPhysicalBytes", "memory", issues);
  const availablePhysicalBytes = intField(value, "availablePhysicalBytes", "memory", issues);
  const totalPageFileBytes = intField(value, "totalPageFileBytes", "memory", issues);
  const availablePageFileBytes = intField(value, "availablePageFileBytes", "memory", issues);
  const memoryLoadPercent = intField(value, "memoryLoadPercent", "memory", issues);
  const physicalFreeRatio = numField(value, "physicalFreeRatio", "memory", issues);
  const commitFreeRatio = numField(value, "commitFreeRatio", "memory", issues);
  const commitExhausted = boolField(value, "commitExhausted", "memory", issues);
  const commitMetricUnavailable = boolField(value, "commitMetricUnavailable", "memory", issues);
  const lowMemoryNotification = boolField(value, "lowMemoryNotification", "memory", issues);
  const lowMemoryNotificationUnavailable = boolField(value, "lowMemoryNotificationUnavailable", "memory", issues);
  const metricUnavailable = boolField(value, "metricUnavailable", "memory", issues);
  if (
    totalPhysicalBytes === null ||
    availablePhysicalBytes === null ||
    totalPageFileBytes === null ||
    availablePageFileBytes === null ||
    memoryLoadPercent === null ||
    physicalFreeRatio === null ||
    commitFreeRatio === null ||
    commitExhausted === null ||
    commitMetricUnavailable === null ||
    lowMemoryNotification === null ||
    lowMemoryNotificationUnavailable === null ||
    metricUnavailable === null
  ) {
    return null;
  }
  if (memoryLoadPercent > 100) issues.push("memory.memoryLoadPercent must be between 0 and 100");
  if (availablePhysicalBytes > totalPhysicalBytes && totalPhysicalBytes > 0) {
    issues.push("memory.availablePhysicalBytes exceeds totalPhysicalBytes");
  }
  const expectedCommit = commitIsExhausted({
    totalPageFileBytes,
    availablePageFileBytes,
    commitMetricUnavailable,
  });
  if (commitExhausted !== expectedCommit) {
    issues.push("memory.commitExhausted does not match commit headroom");
  }
  const expectedPhysical = freeRatio(availablePhysicalBytes, totalPhysicalBytes);
  if (Math.abs(physicalFreeRatio - expectedPhysical) > 1e-9) {
    issues.push("memory.physicalFreeRatio does not match physical bytes");
  }
  return {
    totalPhysicalBytes,
    availablePhysicalBytes,
    totalPageFileBytes,
    availablePageFileBytes,
    memoryLoadPercent,
    physicalFreeRatio,
    commitFreeRatio,
    commitExhausted,
    commitMetricUnavailable,
    lowMemoryNotification,
    lowMemoryNotificationUnavailable,
    metricUnavailable,
  };
}

function readJobs(value: unknown, issues: string[]): readonly JobAccountingSample[] | null {
  if (!Array.isArray(value)) {
    issues.push("jobs must be an array");
    return null;
  }
  const jobs: JobAccountingSample[] = [];
  for (const entry of value) {
    const job = readJob(entry, issues);
    if (job) jobs.push(job);
  }
  return jobs;
}

function readJob(value: unknown, issues: string[]): JobAccountingSample | null {
  if (!isRecord(value)) {
    issues.push("job must be an object");
    return null;
  }
  const role = readEnum(value["role"], JOB_ROLES, "job.role", issues);
  if (typeof value["jobId"] !== "string" || value["jobId"].length === 0) issues.push("job.jobId is required");
  if (typeof value["jobName"] !== "string") issues.push("job.jobName is required");
  const peakJobMemoryUsedBytes = intField(value, "peakJobMemoryUsedBytes", "job", issues);
  const currentWorkingSetBytes = intField(value, "currentWorkingSetBytes", "job", issues);
  const totalUserTimeMs = intField(value, "totalUserTimeMs", "job", issues);
  const totalKernelTimeMs = intField(value, "totalKernelTimeMs", "job", issues);
  const activeProcessCount = intField(value, "activeProcessCount", "job", issues);
  const metricUnavailable = boolField(value, "metricUnavailable", "job", issues);
  if (
    !role ||
    typeof value["jobId"] !== "string" ||
    typeof value["jobName"] !== "string" ||
    peakJobMemoryUsedBytes === null ||
    currentWorkingSetBytes === null ||
    totalUserTimeMs === null ||
    totalKernelTimeMs === null ||
    activeProcessCount === null ||
    metricUnavailable === null
  ) {
    return null;
  }
  return {
    jobId: value["jobId"],
    jobName: value["jobName"],
    role,
    peakJobMemoryUsedBytes,
    currentWorkingSetBytes,
    totalUserTimeMs,
    totalKernelTimeMs,
    activeProcessCount,
    metricUnavailable,
  };
}

function readGpu(value: unknown, issues: string[]): GpuSample | null {
  if (!isRecord(value)) {
    issues.push("gpu must be an object");
    return null;
  }
  const gpuAvailable = boolField(value, "gpuAvailable", "gpu", issues);
  const metricUnavailable = boolField(value, "metricUnavailable", "gpu", issues);
  const adapterName = nullableString(value["adapterName"], "gpu.adapterName", issues);
  const budgetBytes = nullableInt(value["budgetBytes"], "gpu.budgetBytes", issues);
  const currentUsageBytes = nullableInt(value["currentUsageBytes"], "gpu.currentUsageBytes", issues);
  const availableForReservationBytes = nullableInt(
    value["availableForReservationBytes"],
    "gpu.availableForReservationBytes",
    issues,
  );
  const sharedVramBudgetBytes = nullableInt(value["sharedVramBudgetBytes"], "gpu.sharedVramBudgetBytes", issues);
  if (
    gpuAvailable === null ||
    metricUnavailable === null ||
    adapterName === undefined ||
    budgetBytes === undefined ||
    currentUsageBytes === undefined ||
    availableForReservationBytes === undefined ||
    sharedVramBudgetBytes === undefined
  ) {
    return null;
  }
  if (!gpuAvailable && !metricUnavailable && sharedVramBudgetBytes === null) {
    issues.push("gpu fallback requires sharedVramBudgetBytes");
  }
  return {
    gpuAvailable,
    adapterName,
    budgetBytes,
    currentUsageBytes,
    availableForReservationBytes,
    sharedVramBudgetBytes,
    metricUnavailable,
  };
}

function readDisk(value: unknown, issues: string[]): DiskSample | null {
  if (!isRecord(value)) {
    issues.push("disk must be an object");
    return null;
  }
  if (!Array.isArray(value["volumes"]) || value["volumes"].length !== 2) {
    issues.push("disk.volumes must monitor workspace and appdata");
    return null;
  }
  const first = readVolume(value["volumes"][0], issues);
  const second = readVolume(value["volumes"][1], issues);
  if (!first || !second) return null;
  const roles = new Set([first.role, second.role]);
  if (!roles.has("workspace") || !roles.has("appdata")) {
    issues.push("disk.volumes must include workspace and appdata");
    return null;
  }
  const workspace = first.role === "workspace" ? first : second;
  const appData = first.role === "appdata" ? first : second;
  const tightestFreeBytes = intField(value, "tightestFreeBytes", "disk", issues);
  if (typeof value["tightestDrive"] !== "string") issues.push("disk.tightestDrive is required");
  const tightestRole = readEnum(value["tightestRole"], VOLUME_ROLES, "disk.tightestRole", issues);
  const queueLength = nullableNum(value["queueLength"], "disk.queueLength", issues);
  const ioBusyPercent = nullableNum(value["ioBusyPercent"], "disk.ioBusyPercent", issues);
  const queueMetricUnavailable = boolField(value, "queueMetricUnavailable", "disk", issues);
  const belowWarning15Gb = boolField(value, "belowWarning15Gb", "disk", issues);
  const belowPause5Gb = boolField(value, "belowPause5Gb", "disk", issues);
  const belowEmergency2Gb = boolField(value, "belowEmergency2Gb", "disk", issues);
  if (
    tightestFreeBytes === null ||
    typeof value["tightestDrive"] !== "string" ||
    !tightestRole ||
    queueLength === undefined ||
    ioBusyPercent === undefined ||
    queueMetricUnavailable === null ||
    belowWarning15Gb === null ||
    belowPause5Gb === null ||
    belowEmergency2Gb === null
  ) {
    return null;
  }
  const known = [workspace, appData].filter((volume) => !volume.metricUnavailable);
  const expectedTightest = known.reduce<number | null>((best, volume) => {
    if (best === null || volume.freeBytes < best) return volume.freeBytes;
    return best;
  }, null);
  if ((expectedTightest ?? 0) !== tightestFreeBytes) {
    issues.push("disk.tightestFreeBytes is not the smaller monitored volume");
  }
  return {
    volumes: [workspace, appData],
    tightestFreeBytes,
    tightestDrive: value["tightestDrive"],
    tightestRole,
    queueLength,
    ioBusyPercent,
    queueMetricUnavailable,
    belowWarning15Gb,
    belowPause5Gb,
    belowEmergency2Gb,
  };
}

function readVolume(value: unknown, issues: string[]): VolumeSample | null {
  if (!isRecord(value)) {
    issues.push("volume must be an object");
    return null;
  }
  const role = readEnum(value["role"], VOLUME_ROLES, "volume.role", issues);
  if (typeof value["path"] !== "string") issues.push("volume.path is required");
  if (typeof value["drive"] !== "string") issues.push("volume.drive is required");
  const freeBytes = intField(value, "freeBytes", "volume", issues);
  const totalBytes = intField(value, "totalBytes", "volume", issues);
  const metricUnavailable = boolField(value, "metricUnavailable", "volume", issues);
  if (
    !role ||
    typeof value["path"] !== "string" ||
    typeof value["drive"] !== "string" ||
    freeBytes === null ||
    totalBytes === null ||
    metricUnavailable === null
  ) {
    return null;
  }
  return { role, path: value["path"], drive: value["drive"], freeBytes, totalBytes, metricUnavailable };
}

function readDefender(value: unknown, issues: string[]): DefenderSample | null {
  if (!isRecord(value)) {
    issues.push("defender must be an object");
    return null;
  }
  if (value["processName"] !== DEFENDER_PROCESS_NAME) issues.push("defender.processName must be MsMpEng.exe");
  if (value["settingsMutated"] !== false) issues.push("defender.settingsMutated must stay false");
  const cpuPercent = numField(value, "cpuPercent", "defender", issues);
  const avContentionActive = boolField(value, "avContentionActive", "defender", issues);
  const metricUnavailable = boolField(value, "metricUnavailable", "defender", issues);
  const exclusionTip = nullableString(value["exclusionTip"], "defender.exclusionTip", issues);
  if (cpuPercent === null || avContentionActive === null || metricUnavailable === null || exclusionTip === undefined) {
    return null;
  }
  const expected = !metricUnavailable && cpuPercent > DEFENDER_CONTENTION_CPU_PERCENT;
  if (avContentionActive !== expected) issues.push("defender.avContentionActive does not match the 25% threshold");
  if (avContentionActive && exclusionTip === null) issues.push("defender contention requires an educational exclusion tip");
  if (!avContentionActive && exclusionTip !== null) issues.push("defender exclusion tip is only present during contention");
  if (value["settingsMutated"] !== false || value["processName"] !== DEFENDER_PROCESS_NAME) return null;
  return {
    processName: DEFENDER_PROCESS_NAME,
    cpuPercent,
    avContentionActive,
    settingsMutated: false,
    metricUnavailable,
    exclusionTip,
  };
}

function readUi(value: unknown, issues: string[]): UiLatencySample | null {
  if (!isRecord(value)) {
    issues.push("ui must be an object");
    return null;
  }
  if (value["heartbeatHz"] !== UI_HEARTBEAT_HZ) issues.push("ui.heartbeatHz must be 1");
  const uiLatencyMs = nullableNum(value["uiLatencyMs"], "ui.uiLatencyMs", issues);
  const windowVisible = boolField(value, "windowVisible", "ui", issues);
  const interacting = boolField(value, "interacting", "ui", issues);
  const pressure = boolField(value, "pressure", "ui", issues);
  const suppressedHidden = boolField(value, "suppressedHidden", "ui", issues);
  const consecutiveLagSamples = intField(value, "consecutiveLagSamples", "ui", issues);
  if (
    uiLatencyMs === undefined ||
    windowVisible === null ||
    interacting === null ||
    pressure === null ||
    suppressedHidden === null ||
    consecutiveLagSamples === null
  ) {
    return null;
  }
  if (pressure && !windowVisible) issues.push("hidden windows cannot emit UI latency pressure");
  if (pressure && suppressedHidden) issues.push("suppressed hidden heartbeats cannot emit UI latency pressure");
  if (pressure && (uiLatencyMs === null || uiLatencyMs <= UI_LATENCY_PRESSURE_MS)) {
    issues.push("UI pressure requires foreground latency above 50 ms");
  }
  if (value["heartbeatHz"] !== UI_HEARTBEAT_HZ) return null;
  return {
    uiLatencyMs,
    windowVisible,
    interacting,
    pressure,
    suppressedHidden,
    consecutiveLagSamples,
    heartbeatHz: UI_HEARTBEAT_HZ,
  };
}

function readStrings(value: unknown, label: string, issues: string[]): readonly string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    issues.push(`${label} must be a string array`);
    return null;
  }
  return value as readonly string[];
}

function intField(record: Record<string, unknown>, key: string, label: string, issues: string[]): number | null {
  const value = record[key];
  if (!nonNegativeInt(value)) {
    issues.push(`${label}.${key} must be a non-negative integer`);
    return null;
  }
  return value;
}

function numField(record: Record<string, unknown>, key: string, label: string, issues: string[]): number | null {
  const value = record[key];
  if (!finite(value) || value < 0) {
    issues.push(`${label}.${key} must be a non-negative finite number`);
    return null;
  }
  return value;
}

function boolField(record: Record<string, unknown>, key: string, label: string, issues: string[]): boolean | null {
  const value = record[key];
  if (typeof value !== "boolean") {
    issues.push(`${label}.${key} must be a boolean`);
    return null;
  }
  return value;
}

function nullableString(value: unknown, label: string, issues: string[]): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string") return value;
  issues.push(`${label} must be a string or null`);
  return undefined;
}

function nullableInt(value: unknown, label: string, issues: string[]): number | null | undefined {
  if (value === null) return null;
  if (nonNegativeInt(value)) return value;
  issues.push(`${label} must be a non-negative integer or null`);
  return undefined;
}

function nullableNum(value: unknown, label: string, issues: string[]): number | null | undefined {
  if (value === null) return null;
  if (finite(value) && value >= 0) return value;
  issues.push(`${label} must be a non-negative finite number or null`);
  return undefined;
}

export function assertProviderKind(value: string): ProviderKind {
  if (PROVIDER_KINDS.some((kind) => kind === value)) return value as ProviderKind;
  throw new HardwareSnapshotError([`unknown provider ${value}`]);
}

export function assertCadence(value: string): CollectorCadence {
  if (COLLECTOR_CADENCES.some((kind) => kind === value)) return value as CollectorCadence;
  throw new HardwareSnapshotError([`unknown cadence ${value}`]);
}

export function assertJobRole(value: string): JobRole {
  if (JOB_ROLES.some((kind) => kind === value)) return value as JobRole;
  throw new HardwareSnapshotError([`unknown job role ${value}`]);
}

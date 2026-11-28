import type { GlobalDbPort } from "./ports/global-db.js";
import {
  CALIBRATION_BUDGET_MS,
  concurrencyCaps,
  storageClassFromLatency,
} from "./thresholds.js";

export type CalibrationReason = "first_launch" | "hardware_change" | "manual";

export interface MachineHardwareProbe {
  readonly cpuCoreCount: number;
  readonly totalPhysicalRamMb: number;
  readonly gpuAvailable: boolean;
  readonly vramBudgetMb: number;
  readonly ioLatencyMs: number;
  readonly devDrive: boolean;
  readonly inspectionDurationMs: number;
}

export interface CalibrationProfile {
  readonly reason: CalibrationReason;
  readonly ramTotalMb: number;
  readonly cores: number;
  readonly gpu: string;
  readonly devDrive: boolean;
  readonly storageClass: "ssd" | "hdd";
  readonly ioLatencyMs: number;
  readonly warmExecutionSlots: number;
  readonly thinkingSlots: number;
  readonly heavyLanePermits: number;
  readonly elapsedMs: number;
  readonly measuredAtMs: number;
}

export interface CalibrationClock {
  now(): number;
}

export class CalibrationBudgetExceededError extends Error {
  readonly inspectionDurationMs: number;

  constructor(inspectionDurationMs: number) {
    super(
      `Machine calibration probe took ${inspectionDurationMs} ms, which exceeds the ${CALIBRATION_BUDGET_MS} ms non-intrusive budget`,
    );
    this.name = "CalibrationBudgetExceededError";
    this.inspectionDurationMs = inspectionDurationMs;
  }
}

function gpuLabel(probe: MachineHardwareProbe): string {
  if (!probe.gpuAvailable || probe.vramBudgetMb <= 0) return "none";
  const kind = probe.vramBudgetMb >= 2_048 ? "discrete" : "integrated";
  return `${kind}:${probe.vramBudgetMb}mb`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * First launch, hardware change, or a manual recalibrate.
 * Reads a caller-supplied probe and writes `machine_profile`. It does not
 * install, build, or touch the disk; the probe itself must finish within 3 s.
 */
export class MachineCalibrationRunner {
  constructor(
    private readonly db: GlobalDbPort,
    private readonly clock: CalibrationClock = Date,
  ) {}

  needsCalibration(probe: MachineHardwareProbe): Exclude<CalibrationReason, "manual"> | null {
    const stamp = this.db.machineProfile.get("calibration_run");
    const ram = this.db.machineProfile.get("ram_total_mb");
    const cores = this.db.machineProfile.get("cores");
    if (!stamp || !ram || !cores) return "first_launch";
    if (ram.value !== String(probe.totalPhysicalRamMb) || cores.value !== String(probe.cpuCoreCount)) {
      return "hardware_change";
    }
    return null;
  }

  ensure(probe: MachineHardwareProbe): CalibrationProfile {
    const reason = this.needsCalibration(probe);
    if (reason === null) {
      const existing = this.readExisting();
      if (existing) return existing;
      return this.run(probe, "first_launch");
    }
    return this.run(probe, reason);
  }

  run(probe: MachineHardwareProbe, reason: CalibrationReason): CalibrationProfile {
    if (probe.inspectionDurationMs > CALIBRATION_BUDGET_MS) {
      throw new CalibrationBudgetExceededError(probe.inspectionDurationMs);
    }
    const started = this.clock.now();
    const caps = concurrencyCaps(probe.totalPhysicalRamMb);
    const storageClass = storageClassFromLatency(probe.ioLatencyMs);
    const gpu = gpuLabel(probe);
    const measuredAtMs = this.clock.now();
    const elapsedMs = measuredAtMs - started;
    if (elapsedMs > CALIBRATION_BUDGET_MS) {
      throw new CalibrationBudgetExceededError(elapsedMs);
    }
    const profile: CalibrationProfile = {
      reason,
      ramTotalMb: probe.totalPhysicalRamMb,
      cores: probe.cpuCoreCount,
      gpu,
      devDrive: probe.devDrive,
      storageClass,
      ioLatencyMs: probe.ioLatencyMs,
      warmExecutionSlots: caps.warmExecutionSlots,
      thinkingSlots: caps.thinkingSlots,
      heavyLanePermits: caps.heavyLanePermits,
      elapsedMs,
      measuredAtMs,
    };
    this.persist(profile);
    return profile;
  }

  private persist(profile: CalibrationProfile): void {
    const at = profile.measuredAtMs;
    const write = (key: string, value: string): void => {
      this.db.machineProfile.set(key, value, at);
    };
    write("ram_total_mb", String(profile.ramTotalMb));
    write("cores", String(profile.cores));
    write("gpu", profile.gpu);
    write("dev_drive", profile.devDrive ? "true" : "false");
    write("storage_class", profile.storageClass);
    write("io_latency_ms", String(profile.ioLatencyMs));
    write("warm_execution_slots", String(profile.warmExecutionSlots));
    write("thinking_slots", String(profile.thinkingSlots));
    write("heavy_lane_permits", String(profile.heavyLanePermits));
    write(
      "calibration_run",
      JSON.stringify({
        reason: profile.reason,
        measuredAtMs: profile.measuredAtMs,
        warmExecutionSlots: profile.warmExecutionSlots,
        thinkingSlots: profile.thinkingSlots,
        heavyLanePermits: profile.heavyLanePermits,
        storageClass: profile.storageClass,
        ioLatencyMs: profile.ioLatencyMs,
        gpu: profile.gpu,
        elapsedMs: profile.elapsedMs,
        nonIntrusive: true,
      }),
    );
  }

  private readExisting(): CalibrationProfile | null {
    const raw = this.db.machineProfile.get("calibration_run")?.value;
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!isRecord(parsed)) return null;
    const reason = parsed.reason;
    const measuredAtMs = parsed.measuredAtMs;
    const warm = parsed.warmExecutionSlots;
    const thinking = parsed.thinkingSlots;
    const heavy = parsed.heavyLanePermits;
    const storageClass = parsed.storageClass;
    const ioLatencyMs = parsed.ioLatencyMs;
    const gpu = parsed.gpu;
    const elapsedMs = parsed.elapsedMs;
    if (
      (reason !== "first_launch" && reason !== "hardware_change" && reason !== "manual") ||
      typeof measuredAtMs !== "number" ||
      typeof warm !== "number" ||
      typeof thinking !== "number" ||
      typeof heavy !== "number" ||
      (storageClass !== "ssd" && storageClass !== "hdd") ||
      typeof ioLatencyMs !== "number" ||
      typeof gpu !== "string" ||
      typeof elapsedMs !== "number"
    ) {
      return null;
    }
    const ram = Number(this.db.machineProfile.get("ram_total_mb")?.value);
    const cores = Number(this.db.machineProfile.get("cores")?.value);
    const dev = this.db.machineProfile.get("dev_drive")?.value === "true";
    if (!Number.isFinite(ram) || !Number.isFinite(cores)) return null;
    return {
      reason,
      ramTotalMb: ram,
      cores,
      gpu,
      devDrive: dev,
      storageClass,
      ioLatencyMs,
      warmExecutionSlots: warm,
      thinkingSlots: thinking,
      heavyLanePermits: heavy,
      elapsedMs,
      measuredAtMs,
    };
  }
}

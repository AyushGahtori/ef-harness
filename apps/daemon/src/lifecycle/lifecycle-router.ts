import type { DaemonShutdownCoordinator } from "./daemon-shutdown-coordinator.js";
import type { PowerLifecycleHandler } from "./power-lifecycle-handler.js";
import {
  LISTENS_ON_LOCALHOST,
  type LifecyclePowerEvent,
  type LifecycleRouteResult,
  type LifecycleRpcRequest,
  type LifecycleShutdownRequest,
  type ShutdownMode,
} from "./protocol.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMode(value: unknown): value is ShutdownMode {
  return value === "drain_and_exit" || value === "detach_ui_keep_running";
}

function readShutdown(body: unknown): LifecycleShutdownRequest | { error: string } {
  if (!isRecord(body) || !isMode(body.mode) || typeof body.reason !== "string" || body.reason.length === 0) {
    return { error: "shutdown body requires mode and reason" };
  }
  const mode = body.mode;
  const reason = body.reason;
  const deadlineMs = typeof body.deadlineMs === "number" ? body.deadlineMs : undefined;
  const idle = body.idle === true;
  if (deadlineMs !== undefined && idle) return { mode, reason, deadlineMs, idle };
  if (deadlineMs !== undefined) return { mode, reason, deadlineMs };
  if (idle) return { mode, reason, idle: true };
  return { mode, reason };
}

function isPowerEvent(value: unknown): value is LifecyclePowerEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "suspend" || value.type === "lock-screen" || value.type === "unlock-screen" || value.type === "shutdown") {
    return typeof value.at === "number";
  }
  if (value.type === "resume") {
    return typeof value.at === "number" && typeof value.sleepDurationMs === "number" && typeof value.resumeClaiming === "boolean";
  }
  if (value.type === "on-battery") {
    return (value.batteryPercent === null || typeof value.batteryPercent === "number") && typeof value.ecoOnBattery === "boolean";
  }
  if (value.type === "on-ac") return typeof value.ecoOnBattery === "boolean";
  return false;
}

export class LifecycleRouter {
  readonly listensOnLocalhost = LISTENS_ON_LOCALHOST;

  constructor(
    private readonly shutdown: DaemonShutdownCoordinator,
    private readonly power: PowerLifecycleHandler,
  ) {}

  async handle(request: LifecycleRpcRequest): Promise<LifecycleRouteResult> {
    if (request.method === "daemon.shutdown") {
      const parsed = readShutdown(request.params);
      if ("error" in parsed) return { status: 400, body: { ok: false, error: parsed.error } };
      const body = await this.shutdown.shutdown(parsed);
      return { status: 200, body };
    }
    if (request.method === "run.pause") {
      const reason = readPauseReason(request.params);
      const body = await this.shutdown.shutdown({
        mode: "detach_ui_keep_running",
        reason,
      });
      return { status: 200, body };
    }
    if (request.method === "lifecycle.power") {
      if (!isPowerEvent(request.params)) {
        return { status: 400, body: { ok: false, error: "power body is not a lifecycle power event" } };
      }
      await this.power.handle(request.params);
      return { status: 200, body: { ok: true } };
    }
    return { status: 404, body: { ok: false, error: "method not found" } };
  }
}

function readPauseReason(params: unknown): string {
  if (!isRecord(params) || typeof params.reason !== "string" || params.reason.length === 0) {
    return "run.pause";
  }
  return params.reason;
}

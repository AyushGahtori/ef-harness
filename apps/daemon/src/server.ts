import path from "node:path";
import { SecretRedactor, StreamingRedactor } from "@ef-harness/shared-contracts";
import { TelemetryDb } from "@ef-harness/db";
import { handleShipMethod } from "./ship-rpc.js";
import {
  DaemonShutdownCoordinator,
  LifecycleRouter,
  LocalClaimGate,
  LocalHardwareGovernor,
  LocalRetryLedger,
  LocalSleepSkewGuard,
  LocalStuckClockGuard,
  PowerLifecycleHandler,
  RecordingCheckpoints,
  RecordingJobObjects,
  RecordingSqlite,
  wallClock,
} from "./lifecycle/index.js";
import { SignedComponentDownloader, type DownloadProgress } from "./components/index.js";
import { RedactedDiagnosticsBundleExporter } from "./diagnostics/bundle-exporter.js";
import { DiagnosticsMetricsAggregator } from "./diagnostics/metrics-aggregator.js";
import type { PacketSecurityRedactorPort } from "./diagnostics/ports.js";
import { rebuildTelemetryDatabase } from "./diagnostics/telemetry-db.js";
import { dispatchCanvasDaemon, type CanvasDaemonSession } from "./canvas/session.js";

export interface IntegratedDaemonContext {
  readonly profileDir: string;
  readonly appVersion: string;
  readonly statePath: string;
  readonly globalPath: string;
  telemetry(): TelemetryDb;
  replaceTelemetry(next: TelemetryDb): void;
  pauseBuild(): void;
  canvasSession?: () => CanvasDaemonSession;
}

export type IntegratedDispatch =
  | { readonly handled: false }
  | { readonly handled: true; readonly result: unknown };

export function handleIntegratedMethod(
  method: string,
  params: Record<string, unknown>,
  ctx: IntegratedDaemonContext,
): IntegratedDispatch {
  const ship = handleShipMethod(method, params, ctx);
  if (ship.handled) return ship;
  if (method === "component.downloadProgress" || method === "component.pause") {
    return { handled: true, result: componentResult(method, params, ctx) };
  }
  if (method === "diagnostics.metrics") {
    return { handled: true, result: metrics(ctx) };
  }
  if (method === "diagnostics.bundle") {
    return { handled: true, result: bundle(params) };
  }
  if (method === "diagnostics.rebuildTelemetry") {
    return { handled: true, result: rebuild(ctx) };
  }
  if (ctx.canvasSession) {
    const canvas = dispatchCanvasDaemon(ctx.canvasSession(), method, params);
    if (canvas.handled) return canvas;
  }
  return { handled: false };
}

export async function handleLifecycleMethod(
  method: string,
  params: Record<string, unknown>,
  ctx: IntegratedDaemonContext,
): Promise<unknown> {
  const router = lifecycleRouter();
  if (method === "run.pause") {
    ctx.pauseBuild();
    const routed = await router.handle({ method, params });
    return routed.body;
  }
  if (method === "lifecycle.power") {
    if (isSuspend(params)) ctx.pauseBuild();
    const routed = await router.handle({ method, params });
    return routed.body;
  }
  const routed = await router.handle({ method: "daemon.shutdown", params });
  return routed.body;
}

function lifecycleRouter(): LifecycleRouter {
  const claims = new LocalClaimGate();
  const checkpoints = new RecordingCheckpoints();
  const jobs = new RecordingJobObjects();
  const sqlite = new RecordingSqlite();
  const shutdown = new DaemonShutdownCoordinator({
    clock: wallClock(),
    claims,
    checkpoints,
    jobs,
    sqlite,
  });
  const power = new PowerLifecycleHandler({
    now: () => Date.now(),
    claims,
    clocks: new LocalStuckClockGuard(),
    leases: new LocalSleepSkewGuard(),
    retries: new LocalRetryLedger(),
    governor: new LocalHardwareGovernor(),
    shutdown,
    checkpoints,
  });
  return new LifecycleRouter(shutdown, power);
}

const downloaders = new Map<string, SignedComponentDownloader>();
const progress = new Map<string, DownloadProgress>();

function componentResult(method: string, params: Record<string, unknown>, ctx: IntegratedDaemonContext): unknown {
  const componentId = typeof params.componentId === "string" ? params.componentId : "";
  const downloader = downloaderFor(ctx.profileDir);
  if (method === "component.pause") {
    if (componentId.length > 0) downloader.pause(componentId);
    const current = progress.get(componentId);
    return {
      componentId,
      paused: true,
      fraction: current?.fraction ?? 0,
      state: current?.state ?? "paused",
    };
  }
  const current = componentId.length > 0 ? progress.get(componentId) : undefined;
  return {
    componentId,
    fraction: current?.fraction ?? 0,
    receivedBytes: current?.receivedBytes ?? 0,
    totalBytes: current?.totalBytes ?? 0,
    state: current?.state ?? "paused",
  };
}

function downloaderFor(profileDir: string): SignedComponentDownloader {
  const existing = downloaders.get(profileDir);
  if (existing) return existing;
  const created = new SignedComponentDownloader({
    componentsRoot: path.join(profileDir, "components"),
    manifestUrl: "https://components.ef-harness.local/manifest.json",
  });
  downloaders.set(profileDir, created);
  return created;
}

function metrics(ctx: IntegratedDaemonContext): unknown {
  const snapshot = new DiagnosticsMetricsAggregator({
    telemetryPath: ctx.telemetry().filePath,
    stateDbPath: ctx.statePath,
    globalDbPath: ctx.globalPath,
    ringBuffer: { readSince: () => [] },
    pressure: { current: () => null, history: () => [] },
    footprints: { list: () => [] },
    backup: { lastVerifiedAt: () => null },
    providers: { current: () => [] },
    conformance: { current: () => [] },
    storage: { current: () => null },
  }).aggregate();
  return {
    generatedAt: snapshot.generatedAt,
    telemetryAvailable: snapshot.telemetryAvailable,
    databases: snapshot.databases,
  };
}

function bundle(params: Record<string, unknown>): unknown {
  const redactor = streamingPort();
  const canary = typeof params.canary === "string" ? params.canary : "";
  if (canary.length > 0) redactor.registerCanary(canary);
  const preview = new RedactedDiagnosticsBundleExporter().createPreview({
    osVersion: "local",
    ramClass: "unknown",
    cpuClass: "unknown",
    appVersion: "0.0.0",
    componentVersions: {},
    metrics24h: {},
    governorTimeline: [],
    daemonLogLines: typeof params.logLine === "string" ? [params.logLine] : [],
    schemaHealth: {},
    includeSanitizedGraph: false,
    graphNodes: [],
    redactor,
    windowsUsernames: [],
    repoFolderNames: [],
    hostnames: [],
    canaries: canary.length > 0 ? [canary] : [],
  });
  const scanner = new SecretRedactor();
  if (canary.length > 0) scanner.register("SECRET", canary);
  let secretCount = 0;
  for (const file of preview.files) {
    secretCount += scanner.scanForSecrets(file.text).length;
    if (canary.length > 0 && file.text.includes(canary)) secretCount += 1;
  }
  return {
    files: preview.files.map((file) => ({ name: file.name, byteLength: file.bytes.byteLength })),
    secretCount,
  };
}

function rebuild(ctx: IntegratedDaemonContext): unknown {
  const current = ctx.telemetry();
  const filePath = current.filePath;
  rebuildTelemetryDatabase(filePath, current);
  const reopened = TelemetryDb.open({ filePath });
  ctx.replaceTelemetry(reopened);
  return { rebuilt: true, filePath, open: true };
}

function streamingPort(): PacketSecurityRedactorPort {
  const secrets = new SecretRedactor();
  return {
    registerCanary(secret: string) {
      secrets.register("SECRET", secret);
    },
    redact(text: string) {
      const stream: StreamingRedactor = secrets.openStream();
      return stream.push(text) + stream.flush();
    },
  };
}

function isSuspend(params: Record<string, unknown>): boolean {
  return params.type === "suspend";
}

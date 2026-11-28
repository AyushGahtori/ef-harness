import { existsSync, statfsSync } from "node:fs";
import path from "node:path";
import { DiskHeadroomGuard } from "@ef-harness/governor";
import { callDaemon } from "./bootstrap/probe.js";
import { bindColdOpenReconciler } from "./lifecycle/cold-open-bind.js";
import {
  DesktopLifecycleCoordinator,
  HEALTHY_ENVIRONMENT,
  LocalClaimGate,
  LocalHardwareGovernor,
  LocalRetryLedger,
  LocalSleepSkewGuard,
  LocalStuckClockGuard,
  MemoryPreferenceStore,
  RecordingCheckpoints,
  RecordingDaemonPresence,
  RecordingEventStream,
  RecordingJobObjects,
  RecordingKernelStop,
  RecordingPopOuts,
  RecordingSqlite,
  RecordingWindowHost,
  ScriptedEnvironmentProbe,
  idleActivity,
  type DaemonLifecycleClient,
  type LifecycleShutdownResponse,
  type TrayFactory,
  type TrayHandle,
  type TrayImage,
} from "./lifecycle/index.js";
import { bindCheckpointUpcaster, createVerifiedCheckpointBackup } from "./updater/checkpoint-db-bind.js";
import { createElectronUpdaterPort } from "./updater/electron-updater-port.js";
import { ParkFirstAutoUpdater } from "./updater/park-first-auto-updater.js";
import type { HeadroomLevel } from "./updater/ports.js";

export interface MountedDesktopLifecycle {
  readonly coordinator: DesktopLifecycleCoordinator;
  readonly updater: ParkFirstAutoUpdater;
  readonly checkpoints: ReturnType<typeof bindCheckpointUpcaster>;
}

export function mountDesktopLifecycle(input: {
  readonly profileDir: string;
  readonly appVersion: string;
  readonly pipePath: string;
}): MountedDesktopLifecycle {
  const tokenFile = path.join(input.profileDir, "session.token");
  const stateDbPath = path.join(input.profileDir, "projects", "m1", "state.db");
  const headroom = new DiskHeadroomGuard();
  const coordinator = new DesktopLifecycleCoordinator({
    now: () => Date.now(),
    daemon: pipeDaemonClient(input.pipePath, tokenFile),
    stop: new RecordingKernelStop(),
    popOuts: new RecordingPopOuts(),
    windows: new RecordingWindowHost(),
    clocks: new LocalStuckClockGuard(),
    leases: new LocalSleepSkewGuard(),
    reconciler: bindColdOpenReconciler(stateDbPath),
    governor: new LocalHardwareGovernor(),
    probe: new ScriptedEnvironmentProbe(HEALTHY_ENVIRONMENT),
    claims: new LocalClaimGate(),
    checkpoints: new RecordingCheckpoints(),
    jobs: new RecordingJobObjects(),
    sqlite: new RecordingSqlite(),
    retries: new LocalRetryLedger(),
    stream: new RecordingEventStream(),
    daemonPresence: new RecordingDaemonPresence(),
    preferences: new MemoryPreferenceStore(),
    trayFactory: memoryTrayFactory(),
    notifier: { show() {} },
    powerSaveBlocker: memoryPowerSaveBlocker(),
    loginItems: {
      setLoginItemSettings() {},
      getLoginItemSettings: () => ({ openAtLogin: false, args: [] }),
    },
    singleInstanceApp: {
      requestSingleInstanceLock: () => true,
      onSecondInstance() {},
      exit() {},
    },
    readBattery: () => null,
    activity: idleActivity(),
  });
  const updater = new ParkFirstAutoUpdater({
    updater: createElectronUpdaterPort(),
    work: {
      activeBuildVerificationOrMergeCount() {
        return 1;
      },
      async pauseAndCheckpointAllWorkers() {
        const paused = await callDaemon(input.pipePath, tokenFile, "run.pause", { reason: "update" });
        if (paused === null) throw new Error("daemon did not park workers");
        return ["parked"];
      },
    },
    shutdown: {
      async flushSqliteWal() {
        await callDaemon(input.pipePath, tokenFile, "daemon.shutdown", {
          op_id: `update-${Date.now()}`,
          mode: "drain_and_exit",
          reason: "update",
        });
      },
      async teardownJobObjects() {
        if (existsSync(path.join(input.profileDir, "harnessd.ready.json"))) {
          throw new Error("daemon is still running; job objects were not torn down");
        }
      },
    },
    backup: {
      createVerifiedStateDbSnapshot: () => createVerifiedCheckpointBackup(input.profileDir, input.appVersion),
    },
    headroom: {
      networkLevel: () => "GREEN",
      diskLevel: () => diskLevel(headroom, input.profileDir),
    },
    settings: { manualUpdatesOnly: false },
  });
  return {
    coordinator,
    updater,
    checkpoints: bindCheckpointUpcaster(input.profileDir, input.appVersion),
  };
}

function pipeDaemonClient(pipePath: string, tokenFile: string): DaemonLifecycleClient {
  return {
    async shutdown(request): Promise<LifecycleShutdownResponse> {
      await callDaemon(pipePath, tokenFile, "daemon.shutdown", {
        op_id: `life-${Date.now()}`,
        mode: request.mode,
        reason: request.reason,
        ...(request.deadlineMs !== undefined ? { deadlineMs: request.deadlineMs } : {}),
        ...(request.idle === true ? { idle: true } : {}),
      });
      const exiting = request.mode === "drain_and_exit";
      return {
        ok: true,
        mode: request.mode,
        exited: exiting,
        daemonKeptRunning: !exiting,
        orphanedProcesses: 0,
        elapsedMs: 0,
        timedOut: false,
        stateDbIntact: true,
        walModes: exiting ? ["PASSIVE", "TRUNCATE"] : [],
        buildsInterrupted: exiting && request.idle !== true,
        uiDetached: request.mode === "detach_ui_keep_running",
      };
    },
    async notifyPower(event) {
      await callDaemon(pipePath, tokenFile, "lifecycle.power", { ...event });
    },
  };
}

function diskLevel(guard: DiskHeadroomGuard, profileDir: string): HeadroomLevel {
  const stat = readStat(profileDir);
  const volume = { letter: profileDir, freeBytes: stat.free, totalBytes: stat.total };
  const view = guard.observe({ project: volume, appData: volume, nowMs: Date.now() });
  if (view.tightestTier === "EMERGENCY") return "RED";
  if (view.tightestTier === "PAUSE") return "ORANGE";
  if (view.tightestTier === "WARN") return "YELLOW";
  return "GREEN";
}

function readStat(profileDir: string): { readonly free: number; readonly total: number } {
  try {
    const stat = statfsSync(profileDir);
    return { free: Number(stat.bavail) * Number(stat.bsize), total: Number(stat.blocks) * Number(stat.bsize) };
  } catch {
    return { free: 0, total: 0 };
  }
}

function memoryTrayFactory(): TrayFactory {
  return {
    createImage(badge): TrayImage {
      return { badge, width: 16, height: 16 };
    },
    createTray(): TrayHandle {
      return {
        setToolTip() {},
        setImage() {},
        setContextMenu() {},
        on() {},
        destroy() {},
      };
    },
  };
}

function memoryPowerSaveBlocker() {
  const active = new Set<number>();
  let next = 1;
  return {
    start(type: "prevent-app-suspension") {
      void type;
      const id = next;
      next += 1;
      active.add(id);
      return id;
    },
    stop(id: number) {
      active.delete(id);
    },
    isStarted(id: number) {
      return active.has(id);
    },
  };
}

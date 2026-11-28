import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryMainShell, InMemoryScreenPort, InMemoryTrayLifecycle } from "../windows/electron-ports.js";
import { PopOutWindowCoordinator } from "../windows/pop-out-window-coordinator.js";
import { SharedHarnessdStream } from "../windows/shared-harnessd-stream.js";
import { MAX_POP_OUT_WINDOWS, type DipRect, type HarnessdEvent, type ManagedWindow, type PopOutResult, type PopOutView, type ThemeName } from "../windows/types.js";
import { mountDesktopLifecycle, type MountedDesktopLifecycle } from "../main.js";
import { ensureHarnessd, launchDetached } from "./launch.js";
import { callDaemon, probeDaemon } from "./probe.js";
import { M1_PRELOAD_CONTRACT, PRELOAD_CJS } from "./preload.js";
import { ELECTRON_SECURITY_DEFAULTS, M1_CONTENT_SECURITY_POLICY, PRELOAD_EXPOSES } from "./security.js";

export interface DesktopOptions {
  readonly appVersion: string;
  readonly appName: string;
  readonly profileDir: string;
  readonly pipePath: string;
  readonly viewerRoot: string;
  readonly daemonScript: string;
  readonly execPath: string;
  readonly idleMs: number;
  readonly simStepMs: number;
  readonly sandboxTier: string;
  readonly diffNote: string;
  readonly simTask: boolean;
}

interface WebContentsLike {
  postMessage(channel: string, message: unknown, transfer?: readonly unknown[]): void;
  on(event: "did-finish-load", listener: () => void): void;
  on(
    event: "render-process-gone",
    listener: (event: unknown, details?: { readonly reason?: string }) => void,
  ): void;
  forcefullyCrashRenderer?: () => void;
}

interface BrowserWindowLike {
  webContents: WebContentsLike;
  loadURL(url: string): Promise<void>;
  focus(): void;
  show(): void;
  hide(): void;
  restore(): void;
  isMinimized(): boolean;
  isVisible(): boolean;
  isDestroyed(): boolean;
  close(): void;
  destroy(): void;
  getBounds(): DipRect;
  setBounds(bounds: DipRect): void;
  on(event: "closed", listener: () => void): void;
}

interface UtilityLike {
  postMessage(message: unknown, transfer?: readonly unknown[]): void;
  on(event: "message", listener: (event: unknown) => void): void;
  stderr?: NodeJS.ReadableStream;
  kill(): void;
}

export interface ElectronHost {
  app: {
    setName(name: string): void;
    setPath(name: string, value: string): void;
    requestSingleInstanceLock(): boolean;
    quit(): void;
    exit(code: number): void;
    whenReady(): Promise<void>;
    on(event: "second-instance", listener: () => void): void;
    on(event: "window-all-closed", listener: () => void): void;
    on(event: "render-process-gone", listener: () => void): void;
  };
  protocol: {
    registerSchemesAsPrivileged(
      schemes: ReadonlyArray<{ scheme: string; privileges: Record<string, boolean> }>,
    ): void;
    handle(scheme: string, handler: (request: { url: string }) => Response): void;
  };
  BrowserWindow: new (options: {
    x?: number;
    y?: number;
    width: number;
    height: number;
    show: boolean;
    webPreferences: {
      contextIsolation: boolean;
      nodeIntegration: boolean;
      sandbox: boolean;
      preload: string;
    };
  }) => BrowserWindowLike;
  utilityProcess: {
    fork(
      modulePath: string,
      args: readonly string[],
      options: { serviceName: string; stdio: "pipe"; env: NodeJS.ProcessEnv },
    ): UtilityLike;
  };
  MessageChannelMain: new () => { port1: unknown; port2: unknown };
}

export interface DesktopRuntime {
  readonly security: typeof ELECTRON_SECURITY_DEFAULTS;
  focusCount(): number;
  crashRenderer(): void;
  popOut(view: PopOutView): PopOutResult;
}

const VIEWER_FILES = new Set(["index.html", "viewer.css", "viewer-client.js"]);

export async function startDesktopMain(host: ElectronHost, options: DesktopOptions): Promise<DesktopRuntime> {
  host.protocol.registerSchemesAsPrivileged([
    {
      scheme: "ef-m1",
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
  ]);
  host.app.setPath("userData", path.join(options.profileDir, "electron-user-data"));
  host.app.setName(options.appName);
  const locked = host.app.requestSingleInstanceLock();
  if (!locked) {
    host.app.quit();
    host.app.exit(0);
    return {
      security: ELECTRON_SECURITY_DEFAULTS,
      focusCount: () => 0,
      crashRenderer: () => undefined,
      popOut: (view) => ({
        ok: false,
        action: "rejected",
        reason: "popout-cap",
        limit: MAX_POP_OUT_WINDOWS,
        view,
      }),
    };
  }
  let focusCount = 0;
  let windowRef: BrowserWindowLike | null = null;
  let utility: UtilityLike | null = null;
  let crashes = 0;
  let recovering = false;
  let windowsReady = false;
  let windowSeq = 0;
  let openWindow: () => Promise<BrowserWindowLike> = () => Promise.reject(new Error("window is not ready"));
  host.app.on("second-instance", () => {
    focusCount += 1;
    const file = path.join(options.profileDir, "logs", "second-instance.log");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${Date.now()} focus\n`);
    if (!windowsReady) return;
    const win = windowRef;
    if (!win || win.isDestroyed()) {
      void openWindow();
      return;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  host.app.on("window-all-closed", () => {
    const file = path.join(options.profileDir, "logs", "window-closed.log");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${Date.now()} window closed; harnessd stays detached\n`);
    // M1 has no tray yet (Task 131). The shell stays up so a second launch can focus or recreate the window.
  });
  host.app.on("render-process-gone", () => {
    const file = path.join(options.profileDir, "logs", "renderer-crash.log");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${Date.now()} app render-process-gone\n`);
  });
  await host.app.whenReady();
  host.protocol.handle("ef-m1", (request) => serveViewer(options.viewerRoot, request.url));
  const preloadPath = writePreload(options.profileDir);
  const tokenFile = path.join(options.profileDir, "session.token");
  const restart = () => ensureRunning(options, tokenFile);
  await restart();
  utility = forkUtility(host, options);
  const stream = new SharedHarnessdStream();
  let coordinator: PopOutWindowCoordinator | null = null;
  openWindow = async () => {
    const created = new host.BrowserWindow({
      width: 1100,
      height: 800,
      show: true,
      webPreferences: {
        ...ELECTRON_SECURITY_DEFAULTS,
        preload: preloadPath,
      },
    });
    windowRef = created;
    created.webContents.on("render-process-gone", (_event, details) => {
      if (details?.reason === "clean-exit" || recovering) return;
      crashes += 1;
      if (crashes > 3) return;
      recovering = true;
      const logFile = path.join(options.profileDir, "logs", "renderer-crash.log");
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.appendFileSync(logFile, `${Date.now()} webContents render-process-gone\n`);
      const crashed = created;
      let replacement = false;
      void openWindow()
        .then(() => {
          replacement = true;
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "renderer reopen failed";
          const file = path.join(options.profileDir, "logs", "renderer-reopen.log");
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.appendFileSync(file, `${message}\n`);
        })
        .finally(() => {
          if (replacement && !crashed.isDestroyed()) crashed.destroy();
          recovering = false;
        });
    });
    created.webContents.on("did-finish-load", () => {
      const channel = new host.MessageChannelMain();
      windowSeq += 1;
      const windowId = `window-${windowSeq}`;
      utility?.postMessage({ type: "renderer-port", windowId }, [channel.port1]);
      created.webContents.postMessage(M1_PRELOAD_CONTRACT.channel, null, [channel.port2]);
    });
    await created.loadURL("ef-m1://viewer/index.html");
    return created;
  };
  utility.on("message", (event: unknown) => {
    const data = messageData(event);
    if (data && typeof data === "object" && (data as { type?: string }).type === "daemon-down") {
      void restart();
    }
    if (data && typeof data === "object" && (data as { type?: string }).type === "harnessd-event") {
      const event = (data as { event?: unknown }).event;
      if (isHarnessdEvent(event)) stream.publish(event);
    }
  });
  if (utility.stderr) {
    utility.stderr.on("data", (chunk: string | Buffer) => {
      const file = path.join(options.profileDir, "logs", "utility.stderr.log");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, chunk);
    });
  }
  windowsReady = true;
  const primary = await openWindow();
  const screen = new InMemoryScreenPort([
    {
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      scaleFactor: 1,
      primary: true,
    },
  ]);
  const managedMain = new ElectronManagedWindow("main", primary);
  primary.on("closed", () => {
    coordinator?.onPrimaryWindowClose();
  });
  coordinator = new PopOutWindowCoordinator({
    screen,
    factory: {
      create(spec) {
        const native = new host.BrowserWindow({
          x: spec.bounds.x,
          y: spec.bounds.y,
          width: spec.bounds.width,
          height: spec.bounds.height,
          show: true,
          webPreferences: {
            ...ELECTRON_SECURITY_DEFAULTS,
            preload: preloadPath,
          },
        });
        native.webContents.on("did-finish-load", () => {
          const channel = new host.MessageChannelMain();
          utility?.postMessage({ type: "renderer-port", windowId: spec.id }, [channel.port1]);
          native.webContents.postMessage(M1_PRELOAD_CONTRACT.channel, null, [channel.port2]);
        });
        void native.loadURL("ef-m1://viewer/index.html");
        return new ElectronManagedWindow(spec.id, native);
      },
    },
    stream,
    shell: new InMemoryMainShell(),
    tray: new InMemoryTrayLifecycle(),
    main: managedMain,
  });
  const security = {
    ...ELECTRON_SECURITY_DEFAULTS,
    preload: preloadPath,
    csp: M1_CONTENT_SECURITY_POLICY,
    preloadExposes: PRELOAD_EXPOSES,
    preloadContract: M1_PRELOAD_CONTRACT,
  };
  (globalThis as { __EF_M1_SECURITY__?: unknown }).__EF_M1_SECURITY__ = security;
  (globalThis as { __EF_DESKTOP_LIFECYCLE__?: MountedDesktopLifecycle }).__EF_DESKTOP_LIFECYCLE__ =
    mountDesktopLifecycle({
      profileDir: options.profileDir,
      appVersion: options.appVersion,
      pipePath: options.pipePath,
    });
  return {
    security: ELECTRON_SECURITY_DEFAULTS,
    focusCount: () => focusCount,
    crashRenderer: () => {
      windowRef?.webContents.forcefullyCrashRenderer?.();
    },
    popOut: (view) =>
      coordinator?.popOut(view) ?? {
        ok: false,
        action: "rejected",
        reason: "popout-cap",
        limit: MAX_POP_OUT_WINDOWS,
        view,
      },
  };
}

async function ensureRunning(options: DesktopOptions, tokenFile: string): Promise<void> {
  await ensureHarnessd({
    appVersion: options.appVersion,
    timeoutMs: 30_000,
    probe: () => probeDaemon(options.pipePath, tokenFile),
    parkAndExit: async () => {
      await callDaemon(options.pipePath, tokenFile, "daemon.parkAndExit", { op_id: `park-${Date.now()}` });
    },
    waitUntilGone: async (pid: number) => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (!alive(pid)) return;
        await delay(50);
      }
    },
    spawn: async () => {
      launchDetached({
        command: options.execPath,
        args: [options.daemonScript],
        env: daemonEnv(options),
      });
    },
  });
}

function daemonEnv(options: DesktopOptions): NodeJS.ProcessEnv {
  return {
    ...process.env,
    EF_HARNESS_PROFILE: options.profileDir,
    EF_HARNESS_PIPE: options.pipePath,
    EF_HARNESS_DAEMON_VERSION: options.appVersion,
    EF_HARNESS_APP_VERSION: options.appVersion,
    EF_HARNESS_SIM_TASK: options.simTask ? "1" : "0",
    EF_HARNESS_SIM_STEP_MS: String(options.simStepMs),
    EF_HARNESS_IDLE_MS: String(options.idleMs),
    EF_HARNESS_SANDBOX_TIER: options.sandboxTier,
    EF_HARNESS_DIFF_NOTE: options.diffNote,
    ELECTRON_RUN_AS_NODE: "1",
  };
}

function forkUtility(host: ElectronHost, options: DesktopOptions): UtilityLike {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    EF_HARNESS_PROFILE: options.profileDir,
    EF_HARNESS_PIPE: options.pipePath,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const bundled = path.join(path.dirname(fileURLToPath(import.meta.url)), "pipe-client.js");
  const modulePath = bundled;
  return host.utilityProcess.fork(modulePath, [], {
    serviceName: "ef-m1-pipe",
    stdio: "pipe",
    env,
  });
}

function writePreload(profileDir: string): string {
  const file = path.join(profileDir, "preload.cjs");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(file, PRELOAD_CJS);
  return file;
}

function serveViewer(viewerRoot: string, requestUrl: string): Response {
  const name = path.basename(new URL(requestUrl).pathname);
  if (!VIEWER_FILES.has(name)) return new Response("not found", { status: 404 });
  const file = path.join(viewerRoot, name);
  const type = name.endsWith(".css") ? "text/css" : name.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8";
  return new Response(fs.readFileSync(file), {
    headers: {
      "content-type": type,
      "content-security-policy": M1_CONTENT_SECURITY_POLICY,
    },
  });
}

class ElectronManagedWindow implements ManagedWindow {
  theme: ThemeName = "light";
  focusMode = false;
  focusCount = 0;

  constructor(
    readonly id: string,
    private readonly native: BrowserWindowLike,
  ) {}

  focus(): void {
    this.focusCount += 1;
    this.native.focus();
  }

  close(): void {
    this.native.close();
  }

  destroy(): void {
    this.native.destroy();
  }

  hide(): void {
    this.native.hide();
  }

  show(): void {
    this.native.show();
  }

  isDestroyed(): boolean {
    return this.native.isDestroyed();
  }

  isVisible(): boolean {
    return this.native.isVisible();
  }

  getBounds(): DipRect {
    return this.native.getBounds();
  }

  setBounds(bounds: DipRect): void {
    this.native.setBounds(bounds);
  }

  setTheme(theme: ThemeName): void {
    this.theme = theme;
  }

  setFocusMode(enabled: boolean): void {
    this.focusMode = enabled;
  }

  on(event: "closed", listener: () => void): void {
    this.native.on(event, listener);
  }
}

function isHarnessdEvent(value: unknown): value is HarnessdEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.seq === "number" &&
    Number.isInteger(record.seq) &&
    typeof record.type === "string" &&
    typeof record.projectId === "string" &&
    record.payload !== null &&
    typeof record.payload === "object" &&
    !Array.isArray(record.payload)
  );
}

function messageData(event: unknown): unknown {
  if (event && typeof event === "object" && "data" in event) return (event as { data: unknown }).data;
  return event;
}

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

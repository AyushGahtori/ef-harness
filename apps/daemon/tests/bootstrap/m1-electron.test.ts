import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PipeClient, repoRoot, tempProfile, uniquePipe, waitForExit } from "./support.js";

const XSS_NOTE = `note </div><img src=x onerror="globalThis.__xss=1"><script>globalThis.__xss=1</script>`;

interface ElectronWindow {
  isDestroyed(): boolean;
  close(): void;
  webContents: {
    getLastWebPreferences(): {
      contextIsolation: boolean;
      nodeIntegration: boolean;
      sandbox: boolean;
    };
    forcefullyCrashRenderer(): void;
  };
}

interface ElectronModule {
  BrowserWindow: {
    getAllWindows(): ElectronWindow[];
  };
}

interface ElectronPage {
  locator(selector: string): {
    click(): Promise<void>;
    textContent(options?: { timeout?: number }): Promise<string | null>;
  };
  waitForFunction(expression: string, arg?: unknown, options?: { timeout?: number }): Promise<unknown>;
  evaluate<T>(expression: string): Promise<T>;
}

interface ElectronApp {
  close(): Promise<void>;
  evaluate<T>(pageFunction: (electron: ElectronModule) => T): Promise<T>;
  process(): { pid: number };
  windows(): ElectronPage[];
}

interface Viewer {
  app: ElectronApp;
  profile: string;
  pipe: string;
}

let current: Viewer | null = null;

beforeAll(() => {
  const result = spawnSync(
    "pnpm --filter @ef-harness/daemon exec tsc -p tsconfig.json --pretty false && pnpm --filter @ef-harness/desktop exec tsc -p tsconfig.json --pretty false",
    { cwd: repoRoot(), encoding: "utf8", shell: true, windowsHide: true },
  );
  if (result.status !== 0) {
    throw new Error(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }
}, 120_000);

afterEach(async () => {
  const viewer = current;
  current = null;
  if (!viewer) return;
  await closeApp(viewer.app);
  await stopDaemon(viewer.profile, viewer.pipe);
}, 30_000);

describe("M1 Electron viewer", () => {
  it("shows the live run, then the accepted diff after the viewer is killed", async () => {
    const viewer = await launchViewer({ simStepMs: "8000", diffNote: XSS_NOTE });
    await waitForText(viewer.app, "connection-badge", "Connected");
    const page = await waitForText(viewer.app, "state-path", "LEASED");
    const prefs = await mainPrefs(viewer.app);
    expect(prefs).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true });
    const ready = readReady(viewer.profile);
    expect(ready.electronRunAsNode).toBe(true);
    expect(ready.pid).not.toBe(viewer.app.process().pid);
    expect(alive(ready.pid)).toBe(true);
    const early = await page.locator("#state-badge").textContent();
    expect(["LEASED", "CODING", "STATIC_AUDIT", "CLEAN_VERIFY"]).toContain(early?.trim());
    const second = spawn(electronBinary(), [desktopEntry()], {
      env: viewerEnv(viewer.profile, viewer.pipe, { simStepMs: "8000", diffNote: XSS_NOTE }),
      windowsHide: true,
      stdio: "ignore",
    });
    expect(await exitWithin(second, 15_000)).toBe(0);
    expect(fs.readFileSync(path.join(viewer.profile, "logs", "second-instance.log"), "utf8")).toContain("focus");
    const daemonPid = ready.pid;
    await closeApp(viewer.app);
    current = { app: closedApp(), profile: viewer.profile, pipe: viewer.pipe };
    expect(alive(daemonPid)).toBe(true);
    await waitForAccepted(viewer.pipe, tokenOf(viewer.profile));
    expect(alive(daemonPid)).toBe(true);
    const reopened = await launchViewer({
      simStepMs: "8000",
      diffNote: XSS_NOTE,
      profile: viewer.profile,
      pipe: viewer.pipe,
    });
    const accepted = await waitForText(reopened.app, "state-badge", "ACCEPTED");
    expect(await accepted.locator("#state-path").textContent()).toContain(
      "LEASED → CODING → STATIC_AUDIT → CLEAN_VERIFY → ACCEPTED",
    );
    expect(await accepted.locator("#ref-line").textContent()).toContain("harness/f/F12");
    expect(await accepted.locator("#receipt").textContent()).toContain("Harness-Task: T03");
    expect(await accepted.locator("#checks").textContent()).toContain("STATIC_AUDIT · pass");
    expect(await accepted.locator("#checks").textContent()).toContain("CLEAN_VERIFY · pass");
    expect(await accepted.locator("#sandbox-badge").textContent()).toContain("tier C");
    expect(await accepted.locator("#sync-status").textContent()).toBe("contiguous");
    expect(Number(await accepted.locator("#last-seq").textContent())).toBeGreaterThan(0);
    const surface = await pageSurface(accepted);
    expect(surface.xss).toBeNull();
    expect(surface.images).toBe(0);
    expect(surface.scripts).toBe(0);
    expect(surface.text).toContain("toPrintRows");
    expect(surface.text).toContain("globalThis.__xss=1");
    expect(surface.html.includes("<script>")).toBe(false);
    expect(surface.html.includes("<img")).toBe(false);
    expect(surface.requireType).toBe("undefined");
    expect(surface.processType).toBe("undefined");
    expect(surface.csp).toContain("default-src 'self'");
    expect(surface.csp.includes("unsafe-eval")).toBe(false);
    expect(surface.bannerHidden).toBe(true);
    process.kill(daemonPid, "SIGKILL");
    await waitForBanner(reopened.app);
    const restored = await waitForExact(reopened.app, "connection-badge", "Connected");
    expect((await restored.locator("#state-badge").textContent())?.trim()).toBe("ACCEPTED");
    expect(await restored.locator("#sync-status").textContent()).toBe("contiguous");
    await reopened.app.evaluate(
      inMain(`
        const win = electron.BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
        if (!win) throw new Error("no window to crash");
        win.webContents.forcefullyCrashRenderer();
      `),
    );
    const recovered = await waitForText(reopened.app, "state-badge", "ACCEPTED");
    expect(await recovered.locator("#diff-view").textContent()).toContain("toPrintRows");
    expect(fs.readFileSync(path.join(reopened.profile, "logs", "renderer-crash.log"), "utf8")).toContain(
      "render-process-gone",
    );
  }, 180_000);

  it("stops the active build and leaves harnessd running after the window closes", async () => {
    const viewer = await launchViewer({ simStepMs: "60000", diffNote: "worker note: grouped print rows" });
    const page = await waitForText(viewer.app, "state-badge", "LEASED");
    const daemonPid = readReady(viewer.profile).pid;
    await page.locator("#stop").click();
    const parked = await waitForText(viewer.app, "state-badge", "PARKED");
    expect(await parked.locator("#state-path").textContent()).toContain("PARKED");
    await viewer.app.evaluate(
      inMain(`
        const win = electron.BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
        if (!win) throw new Error("no window to close");
        win.close();
      `),
    );
    const closedLog = path.join(viewer.profile, "logs", "window-closed.log");
    const closedDeadline = Date.now() + 5_000;
    while (!fs.existsSync(closedLog) && Date.now() < closedDeadline) await delay(50);
    expect(fs.readFileSync(closedLog, "utf8")).toContain("harnessd stays detached");
    expect(alive(daemonPid)).toBe(true);
    expect(alive(viewer.app.process().pid)).toBe(true);
    await closeApp(viewer.app);
    current = { app: closedApp(), profile: viewer.profile, pipe: viewer.pipe };
    expect(alive(daemonPid)).toBe(true);
  }, 90_000);
});

async function launchViewer(input: {
  simStepMs: string;
  diffNote: string;
  profile?: string;
  pipe?: string;
}): Promise<Viewer> {
  const profile = input.profile ?? tempProfile("electron");
  const pipe = input.pipe ?? uniquePipe("electron");
  fs.mkdirSync(profile, { recursive: true });
  const app = await launchElectron(viewerEnv(profile, pipe, { simStepMs: input.simStepMs, diffNote: input.diffNote }));
  current = { app, profile, pipe };
  return current;
}

function viewerEnv(profile: string, pipe: string, input: { simStepMs: string; diffNote: string }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    EF_HARNESS_PROFILE: profile,
    EF_HARNESS_PIPE: pipe,
    EF_HARNESS_APP_VERSION: "0.0.0",
    EF_HARNESS_APP_NAME: `EF Harness ${path.basename(profile)}`,
    EF_HARNESS_SIM_TASK: "1",
    EF_HARNESS_SIM_STEP_MS: input.simStepMs,
    EF_HARNESS_IDLE_MS: "120000",
    EF_HARNESS_SANDBOX_TIER: "C",
    EF_HARNESS_DIFF_NOTE: input.diffNote,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  delete env.VITEST;
  delete env.VITEST_WORKER_ID;
  return env;
}

function launchElectron(env: NodeJS.ProcessEnv): Promise<ElectronApp> {
  const require = createRequire(path.join(repoRoot(), "package.json"));
  const playwright = require("playwright") as {
    _electron: {
      launch(options: {
        executablePath: string;
        args: string[];
        env: NodeJS.ProcessEnv;
        timeout: number;
      }): Promise<ElectronApp>;
    };
  };
  return playwright._electron.launch({
    executablePath: electronBinary(),
    args: [desktopEntry()],
    env,
    timeout: 60_000,
  });
}

function electronBinary(): string {
  const require = createRequire(path.join(repoRoot(), "package.json"));
  const resolved = require("electron") as string;
  if (!fs.existsSync(resolved)) throw new Error("electron executable is missing");
  return resolved;
}

function desktopEntry(): string {
  return path.join(repoRoot(), "apps", "desktop", "dist", "bootstrap", "electron-entry.js");
}

async function waitForExact(app: ElectronApp, id: string, value: string): Promise<ElectronPage> {
  const deadline = Date.now() + 40_000;
  let last = "";
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      try {
        const text = ((await page.locator(`#${id}`).textContent({ timeout: 1_000 })) ?? "").trim();
        last = text;
        if (text === value) return page;
      } catch (error) {
        last = error instanceof Error ? error.message : last;
      }
    }
    await delay(150);
  }
  throw new Error(`timed out waiting for #${id} to equal ${value}; last=${last}\n${current ? trace(current.profile) : ""}`);
}

async function waitForText(app: ElectronApp, id: string, needle: string): Promise<ElectronPage> {
  const deadline = Date.now() + 40_000;
  let last = "";
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      try {
        const text = await page.locator(`#${id}`).textContent({ timeout: 1_000 });
        last = text ?? "";
        if (last.includes(needle)) return page;
      } catch (error) {
        last = error instanceof Error ? error.message : last;
      }
    }
    await delay(150);
  }
  throw new Error(`timed out waiting for #${id} to include ${needle}; last=${last}\n${current ? trace(current.profile) : ""}`);
}

async function pageSurface(page: ElectronPage): Promise<{
  xss: number | null;
  images: number;
  scripts: number;
  text: string;
  html: string;
  requireType: string;
  processType: string;
  csp: string;
  bannerHidden: boolean;
}> {
  return page.evaluate(`(() => {
    const diff = document.getElementById("diff-view");
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    const banner = document.getElementById("banner");
    return {
      xss: globalThis.__xss || null,
      images: diff ? diff.querySelectorAll("img").length : -1,
      scripts: diff ? diff.querySelectorAll("script").length : -1,
      text: diff && diff.textContent ? diff.textContent : "",
      html: diff ? diff.innerHTML : "",
      requireType: typeof globalThis.require,
      processType: typeof globalThis.process,
      csp: meta && meta.content ? meta.content : "",
      bannerHidden: banner ? banner.hidden === true : true,
    };
  })()`);
}

async function mainPrefs(app: ElectronApp): Promise<{
  contextIsolation: boolean;
  nodeIntegration: boolean;
  sandbox: boolean;
} | null> {
  return app.evaluate(
    inMain(`
      const win = electron.BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
      if (!win) return null;
      const pref = win.webContents.getLastWebPreferences();
      return {
        contextIsolation: pref.contextIsolation,
        nodeIntegration: pref.nodeIntegration,
        sandbox: pref.sandbox,
      };
    `),
  );
}

function inMain<T>(body: string): (electron: ElectronModule) => T {
  return new Function("electron", body) as (electron: ElectronModule) => T;
}

async function waitForBanner(app: ElectronApp): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      const visible = await page
        .evaluate(`(() => {
          const banner = document.getElementById("banner");
          if (!banner || banner.hidden) return false;
          return (banner.textContent || "").includes("Reconnecting to build engine...");
        })()`)
        .catch(() => false);
      if (visible) return;
    }
    await delay(100);
  }
  throw new Error(`reconnect banner did not appear\n${current ? trace(current.profile) : ""}`);
}

async function waitForAccepted(pipe: string, token: string): Promise<void> {
  const client = await PipeClient.connect(pipe, token);
  try {
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
      const snap = (await client.request("snapshot.get", { project: "m1" })) as {
        sections: { m1: { state: string } };
      };
      if (snap.sections.m1.state === "ACCEPTED") return;
      await delay(200);
    }
  } finally {
    client.close();
  }
  throw new Error("harnessd did not accept the task after the viewer exited");
}

async function closeApp(app: ElectronApp): Promise<void> {
  const pid = app.process().pid;
  const closed = app.close().then(
    () => true,
    (error: unknown) => {
      const message = error instanceof Error ? error.message : "close failed";
      if (!/closed|failed to find/i.test(message)) throw error instanceof Error ? error : new Error(message);
      return false;
    },
  );
  const finished = await Promise.race([closed, delay(4_000).then(() => false)]);
  if (finished || !Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code !== "ESRCH") throw error;
  }
}

function closedApp(): ElectronApp {
  return {
    close: () => Promise.resolve(),
    evaluate: () => Promise.reject(new Error("viewer already closed")),
    process: () => ({ pid: -1 }),
    windows: () => [],
  };
}

async function stopDaemon(profile: string, pipe: string): Promise<void> {
  const tokenFile = path.join(profile, "session.token");
  if (fs.existsSync(tokenFile)) {
    try {
      const client = await PipeClient.connect(pipe, fs.readFileSync(tokenFile, "utf8").trim());
      await client.request("daemon.shutdown", { op_id: `e2e-${Date.now()}` });
      client.close();
    } catch (error) {
      note(profile, error instanceof Error ? error.message : "daemon stop failed");
    }
  }
  const readyFile = path.join(profile, "harnessd.ready.json");
  if (!fs.existsSync(readyFile)) return;
  const pid = Number((JSON.parse(fs.readFileSync(readyFile, "utf8")) as { pid?: number }).pid ?? 0);
  if (!alive(pid)) return;
  try {
    await waitForExit(pid, 8_000);
  } catch (error) {
    process.kill(pid, "SIGKILL");
    note(profile, error instanceof Error ? error.message : "forced daemon stop");
  }
}

function readReady(profile: string): { pid: number; electronRunAsNode: boolean } {
  return JSON.parse(fs.readFileSync(path.join(profile, "harnessd.ready.json"), "utf8")) as {
    pid: number;
    electronRunAsNode: boolean;
  };
}

function tokenOf(profile: string): string {
  return fs.readFileSync(path.join(profile, "session.token"), "utf8").trim();
}

function trace(profile: string): string {
  const fatal = path.join(os.tmpdir(), "ef-m1-viewer-fatal.log");
  const parts = [fs.existsSync(fatal) ? fs.readFileSync(fatal, "utf8") : ""];
  const dir = path.join(profile, "logs");
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      parts.push(`--- ${name} ---\n${fs.readFileSync(path.join(dir, name), "utf8").slice(-3000)}`);
    }
  }
  return parts.join("\n");
}

function note(profile: string, message: string): void {
  fs.mkdirSync(profile, { recursive: true });
  fs.appendFileSync(path.join(profile, "e2e-cleanup.log"), `${message}\n`);
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

function exitWithin(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve(-1);
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

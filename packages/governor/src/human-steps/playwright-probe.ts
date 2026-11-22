import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { nodeCommandRunner } from "./command-runner.js";
import type { CommandRunner, ProbeLogger } from "./ports.js";
import { PROBE_TIMEOUT_DIAGNOSIS, type ProbeResult } from "./types.js";

export const CHROMIUM_LAUNCH_ARGS = ["--headless=new", "--disable-gpu", "--dump-dom", "about:blank"] as const;

export interface ChromiumLaunchResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export type ChromiumLaunch = (
  executable: string,
  signal: AbortSignal,
  timeoutMs: number,
) => Promise<ChromiumLaunchResult>;

export interface PlaywrightInspection {
  readonly projectVersion: string | null;
  readonly expectedRevision: string | null;
  readonly executablePath: string | null;
  readonly installedRevisions: readonly string[];
}

export function inspectPlaywright(projectRoot: string, browsersPath?: string): PlaywrightInspection {
  const packageJson = readJson(path.join(projectRoot, "node_modules", "playwright", "package.json"));
  const corePackage = readJson(path.join(projectRoot, "node_modules", "playwright-core", "package.json"));
  const projectVersion = stringField(packageJson, "version") ?? stringField(corePackage, "version");
  const browsersJson = readJson(path.join(projectRoot, "node_modules", "playwright-core", "browsers.json"));
  const expectedRevision = chromiumRevision(browsersJson);
  const cache = browsersPath ?? defaultBrowsersPath();
  const installedRevisions = listRevisions(cache);
  const executablePath = expectedRevision === null ? null : findExecutable(cache, expectedRevision);
  return { projectVersion, expectedRevision, executablePath, installedRevisions };
}

export function defaultChromiumLaunch(runner: CommandRunner = nodeCommandRunner()): ChromiumLaunch {
  return async (executable, signal, timeoutMs) => {
    const result = await runner.run({ file: executable, args: CHROMIUM_LAUNCH_ARGS, timeoutMs, signal });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut || result.errorCode === "TIMEOUT" || result.errorCode === "ABORTED",
    };
  };
}

export async function probePlaywright(input: {
  readonly projectRoot: string;
  readonly browsersPath?: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly now: () => number;
  readonly logger: ProbeLogger;
  readonly launch?: ChromiumLaunch;
}): Promise<ProbeResult> {
  const started = input.now();
  input.logger.write("playwright_probe", { readOnly: true });
  const inspection = inspectPlaywright(input.projectRoot, input.browsersPath);
  const evidence = {
    readOnly: true,
    ...(inspection.projectVersion === null ? {} : { projectVersion: inspection.projectVersion }),
    ...(inspection.expectedRevision === null ? {} : { expectedRevision: inspection.expectedRevision }),
  };
  if (inspection.projectVersion === null || inspection.expectedRevision === null) {
    return done(input.now, started, "fail", "PLAYWRIGHT_MISSING", "Playwright is not installed in this project", evidence);
  }
  if (!inspection.executablePath) {
    const mismatch = inspection.installedRevisions.find((revision) => revision !== inspection.expectedRevision);
    if (mismatch) {
      return done(
        input.now,
        started,
        "fail",
        "VERSION_MISMATCH",
        `Playwright ${inspection.projectVersion} needs Chromium ${inspection.expectedRevision}, but ${mismatch} is installed`,
        { ...evidence, installedRevision: mismatch },
      );
    }
    return done(
      input.now,
      started,
      "fail",
      "MISSING_BROWSER",
      "Playwright tests need the Chromium binary — click Install Chromium or click Check again after installing it",
      evidence,
    );
  }
  const launch = input.launch ?? defaultChromiumLaunch();
  const launched = await launch(inspection.executablePath, input.signal, input.timeoutMs);
  if (launched.timedOut) {
    return done(input.now, started, "timeout", "PROBE_TIMEOUT", PROBE_TIMEOUT_DIAGNOSIS, evidence);
  }
  const html = launched.stdout.toLowerCase();
  if (launched.exitCode === 0 && html.includes("<html")) {
    return done(input.now, started, "pass", "PASS", `Chromium ${inspection.expectedRevision} launched about:blank`, evidence);
  }
  return done(input.now, started, "fail", "LAUNCH_FAILED", "Chromium did not open about:blank — click Install Chromium and try again", evidence);
}

function done(
  now: () => number,
  started: number,
  outcome: ProbeResult["outcome"],
  code: string,
  diagnosis: string,
  evidence: Record<string, string | number | boolean>,
): ProbeResult {
  return { outcome, code, diagnosis, durationMs: Math.max(0, now() - started), checkedAt: now(), evidence };
}

function defaultBrowsersPath(): string {
  const override = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (override && override.length > 0) return override;
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  if (process.platform === "darwin") return path.join(process.env.HOME ?? "", "Library", "Caches", "ms-playwright");
  return path.join(process.env.HOME ?? "", ".cache", "ms-playwright");
}

function listRevisions(cache: string): string[] {
  if (!existsSync(cache)) return [];
  return readdirSync(cache)
    .filter((name) => name.startsWith("chromium-"))
    .map((name) => name.slice("chromium-".length));
}

function findExecutable(cache: string, revision: string): string | null {
  const root = path.join(cache, `chromium-${revision}`);
  const candidates = [
    path.join(root, "chrome-win64", "chrome.exe"),
    path.join(root, "chrome-win", "chrome.exe"),
    path.join(root, "chrome-linux64", "chrome"),
    path.join(root, "chrome-linux", "chrome"),
    path.join(root, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function chromiumRevision(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const browsers = (value as { browsers?: unknown }).browsers;
  if (!Array.isArray(browsers)) return null;
  for (const browser of browsers) {
    if (!browser || typeof browser !== "object") continue;
    const record = browser as { name?: unknown; revision?: unknown };
    if (record.name === "chromium" && (typeof record.revision === "string" || typeof record.revision === "number")) {
      return String(record.revision);
    }
  }
  return null;
}

function readJson(file: string): unknown {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function stringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

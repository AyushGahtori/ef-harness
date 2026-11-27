import fs from "node:fs";
import os from "node:os";
import { bundledMinGitPath, resourcesRootFromProcess, scrubGitEnv } from "./paths.js";
import { runProcess } from "./process-runner.js";
import {
  GIT_VERSION_REQUIREMENT_MESSAGE,
  GitBinaryNotFoundError,
  GitVersionRejectedError,
  MINIMUM_GIT_VERSION,
  type GitVersion,
  type ResolveGitBinaryOptions,
  type ResolvedGitBinary,
  type SettingsGitRejection,
  type VersionProbeResult,
} from "./types.js";

const versionCache = new Map<string, GitVersion>();

export function parseGitVersion(text: string): GitVersion | null {
  const match = /git version\s+(\d+)(?:\.(\d+))?(?:\.(\d+))?/i.exec(text);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
  };
}

export function formatGitVersion(version: GitVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

export function gitVersionAtLeast(version: GitVersion, minimum: GitVersion = MINIMUM_GIT_VERSION): boolean {
  if (version.major !== minimum.major) return version.major > minimum.major;
  if (version.minor !== minimum.minor) return version.minor > minimum.minor;
  return version.patch >= minimum.patch;
}

export function clearGitVersionCache(): void {
  versionCache.clear();
}

function harnessIsPackaged(): boolean {
  return process.env.EF_HARNESS_PACKAGED === "1";
}

async function probeBinary(
  binary: string,
  options: ResolveGitBinaryOptions,
  existsCheck: "file" | "command" = "file",
): Promise<{ ok: true; version: GitVersion } | { ok: false; version: string | null; reason: "missing" | "unreadable" }> {
  if (existsCheck === "file" && !fs.existsSync(binary)) return { ok: false, version: null, reason: "missing" };
  const cached = versionCache.get(binary);
  if (cached && !options.runVersion) return { ok: true, version: cached };
  const probed: VersionProbeResult = options.runVersion
    ? await options.runVersion(binary)
    : await runProcess({
        binary,
        args: ["--version"],
        cwd: os.tmpdir(),
        env: scrubGitEnv(options.env ?? process.env),
        timeoutMs: options.timeoutMs ?? 15_000,
      });
  const version = parseGitVersion(`${probed.stdout}\n${probed.stderr}`);
  if (probed.exitCode !== 0 || !version) {
    return { ok: false, version: version ? formatGitVersion(version) : null, reason: "unreadable" };
  }
  if (!options.runVersion) versionCache.set(binary, version);
  return { ok: true, version };
}

function rejection(binary: string, version: string | null, detail: string): SettingsGitRejection {
  return {
    path: binary,
    version,
    message: `${GIT_VERSION_REQUIREMENT_MESSAGE}. ${detail}`,
  };
}

export async function resolveGitBinary(options: ResolveGitBinaryOptions = {}): Promise<ResolvedGitBinary> {
  const resourcesRoot = options.resourcesRoot ?? resourcesRootFromProcess();
  const bundled = resourcesRoot ? bundledMinGitPath(resourcesRoot) : null;
  const settings = options.settingsGitPath?.trim() ? options.settingsGitPath.trim() : null;

  const accept = (
    gitPath: string,
    source: "bundled" | "settings" | "path",
    version: GitVersion,
    settingsRejection: SettingsGitRejection | null,
  ): ResolvedGitBinary => {
    if (!gitVersionAtLeast(version)) {
      throw new GitVersionRejectedError(gitPath, formatGitVersion(version));
    }
    return {
      gitPath,
      source,
      version: formatGitVersion(version),
      settingsRejection,
    };
  };

  if (settings) {
    const probed = await probeBinary(settings, options);
    if (probed.ok && gitVersionAtLeast(probed.version)) {
      options.logger?.info("resolved settings Git", {
        source: "settings",
        version: formatGitVersion(probed.version),
      });
      return accept(settings, "settings", probed.version, null);
    }
    const detectedVersion = probed.ok ? formatGitVersion(probed.version) : probed.version;
    const missingSettings = !probed.ok && probed.reason === "missing";
    const settingsRejection = rejection(
      settings,
      detectedVersion,
      missingSettings
        ? `Settings Git path was not found: ${settings}. Falling back to bundled MinGit.`
        : `Rejected ${settings}. Falling back to bundled MinGit.`,
    );
    options.logger?.warn(settingsRejection.message, {
      path: settings,
      version: settingsRejection.version ?? "unknown",
    });
    if (bundled && fs.existsSync(bundled)) {
      const bundledProbe = await probeBinary(bundled, options);
      if (bundledProbe.ok) {
        return accept(bundled, "bundled", bundledProbe.version, settingsRejection);
      }
    }
    if (probed.ok) throw new GitVersionRejectedError(settings, formatGitVersion(probed.version));
    throw new GitVersionRejectedError(settings, probed.version);
  }

  if (bundled && fs.existsSync(bundled)) {
    const bundledProbe = await probeBinary(bundled, options);
    if (!bundledProbe.ok) {
      throw new GitBinaryNotFoundError(
        `${GIT_VERSION_REQUIREMENT_MESSAGE}. Bundled MinGit at ${bundled} did not report a usable version.`,
      );
    }
    options.logger?.info("resolved bundled MinGit", {
      source: "bundled",
      version: formatGitVersion(bundledProbe.version),
    });
    return accept(bundled, "bundled", bundledProbe.version, null);
  }

  if (!harnessIsPackaged()) {
    const pathProbe = await probeBinary("git", options, "command");
    if (pathProbe.ok) {
      options.logger?.info("resolved Git on PATH", {
        source: "path",
        version: formatGitVersion(pathProbe.version),
      });
      return accept("git", "path", pathProbe.version, null);
    }
  }

  throw new GitBinaryNotFoundError(
    "Bundled MinGit was not found at <resources>/mingit/cmd/git.exe. A Settings override must point at Git 2.38 or newer.",
  );
}

export async function ensureSupportedGit(binary: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<GitVersion> {
  const cached = versionCache.get(binary);
  if (cached) {
    if (!gitVersionAtLeast(cached)) throw new GitVersionRejectedError(binary, formatGitVersion(cached));
    return cached;
  }
  const probed = await runProcess({
    binary,
    args: ["--version"],
    cwd: os.tmpdir(),
    env: scrubGitEnv(env),
    timeoutMs,
  });
  const version = parseGitVersion(`${probed.stdout}\n${probed.stderr}`);
  if (probed.spawnError?.code === "ENOENT" || !version) {
    throw new GitBinaryNotFoundError(`Git binary was not usable: ${binary}`);
  }
  if (probed.exitCode !== 0 || !gitVersionAtLeast(version)) {
    throw new GitVersionRejectedError(binary, formatGitVersion(version));
  }
  versionCache.set(binary, version);
  return version;
}

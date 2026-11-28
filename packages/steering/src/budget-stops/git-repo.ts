import { spawnSync } from "node:child_process";
import fs from "node:fs";
import {
  bundledMinGitPath,
  createDirectGitRunner,
  gitVersionAtLeast,
  parseGitVersion,
  scrubGitEnv,
} from "@ef-harness/git-engine";

export interface GitResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const IDENTITY = {
  GIT_AUTHOR_NAME: "EF Harness",
  GIT_AUTHOR_EMAIL: "foundation@ef-harness.local",
  GIT_COMMITTER_NAME: "EF Harness",
  GIT_COMMITTER_EMAIL: "foundation@ef-harness.local",
};

function resourcesRoot(): string | null {
  const fromEnv = process.env.EF_HARNESS_RESOURCES;
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();
  const electron = process as NodeJS.Process & { resourcesPath?: string };
  if (typeof electron.resourcesPath === "string" && electron.resourcesPath.trim()) return electron.resourcesPath;
  return null;
}

function versionOf(binary: string): string | null {
  const probed = spawnSync(binary, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    env: scrubGitEnv(process.env),
  });
  return parseGitVersion(`${probed.stdout ?? ""}\n${probed.stderr ?? ""}`) ? `${probed.stdout ?? ""}` : null;
}

/**
 * Prefer bundled MinGit. Host `PATH` git is only the resolver fallback when no bundle is present.
 */
export function resolveHarnessGitBinary(): string {
  const root = resourcesRoot();
  if (root) {
    const bundled = bundledMinGitPath(root);
    if (fs.existsSync(bundled)) {
      const text = versionOf(bundled);
      const version = text ? parseGitVersion(text) : null;
      if (version && gitVersionAtLeast(version)) return bundled;
    }
  }
  return "git";
}

/** The ref-layer runner (`039`) bound to the same binary `runGit` executes. */
export function harnessGitRunner(): ReturnType<typeof createDirectGitRunner> {
  return createDirectGitRunner({ gitBinary: resolveHarnessGitBinary() });
}

export function runGit(repo: string, args: readonly string[]): GitResult {
  const gitPath = resolveHarnessGitBinary();
  const result = spawnSync(gitPath, ["-C", repo, ...args], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    env: scrubGitEnv({ ...process.env, ...IDENTITY }),
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: `${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}`,
  };
}

export function gitOrThrow(repo: string, args: readonly string[]): string {
  const result = runGit(repo, args);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`.trim());
  }
  return result.stdout.trim();
}

export function refExists(repo: string, ref: string): boolean {
  return runGit(repo, ["show-ref", "--verify", "--quiet", ref]).status === 0;
}

export const PROTECTED_HEADS = new Set([
  "main",
  "master",
  "harness/integration",
  "refs/heads/main",
  "refs/heads/master",
  "refs/heads/harness/integration",
]);

export function assertNotProtectedRef(ref: string): void {
  if (PROTECTED_HEADS.has(ref) || ref === "HEAD") {
    throw new Error(`refusing to rewrite protected ref ${ref}`);
  }
}

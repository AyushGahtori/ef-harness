import fs from "node:fs";
import { execGit } from "./exec-git.js";
import type { ExecGitResult, InitializeNewRepoOptions, InitializeNewRepoResult, StructuredLogger } from "./types.js";

function requireConsent(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error("initializeNewRepo requires an explicit user consent token.");
  }
  return trimmed;
}

async function runInit(options: {
  readonly cwd: string;
  readonly token: string;
  readonly gitBinary?: string;
  readonly resourcesRoot?: string;
  readonly settingsGitPath?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: StructuredLogger;
  readonly timeoutMs?: number;
}): Promise<ExecGitResult> {
  return execGit({
    args: ["init", "-b", "main"],
    cwd: options.cwd,
    userExplicitConsentToken: options.token,
    developerCheckout: true,
    ...(options.gitBinary !== undefined ? { gitBinary: options.gitBinary } : {}),
    ...(options.resourcesRoot !== undefined ? { resourcesRoot: options.resourcesRoot } : {}),
    ...(options.settingsGitPath !== undefined ? { settingsGitPath: options.settingsGitPath } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
}

export async function initializeNewRepo(options: InitializeNewRepoOptions): Promise<InitializeNewRepoResult> {
  const token = requireConsent(options.userExplicitConsentToken);
  const entries = await fs.promises.readdir(options.cwd);
  if (entries.length > 0) {
    throw new Error(`Refusing to initialize ${options.cwd} because it is not an empty folder.`);
  }
  const git = await runInit({
    cwd: options.cwd,
    token,
    ...(options.gitBinary !== undefined ? { gitBinary: options.gitBinary } : {}),
    ...(options.resourcesRoot !== undefined ? { resourcesRoot: options.resourcesRoot } : {}),
    ...(options.settingsGitPath !== undefined ? { settingsGitPath: options.settingsGitPath } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
  if (git.exitCode !== 0) {
    throw new Error(`git init -b main failed: ${git.stderr || git.stdout}`);
  }
  return { folder: options.cwd, branch: "main", git };
}

export { runInit };

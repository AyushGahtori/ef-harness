import { spawn } from "node:child_process";

/**
 * Consumed shape of Task 035 `GitRunner`.
 * `createProcessGitRunner` is the in-scope adapter used until that module is wired:
 * direct `spawn` (`shell: false`, `windowsHide: true`), `-c core.longpaths=true`,
 * and `GIT_TERMINAL_PROMPT=0`.
 */
export interface GitExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface GitRunOptions {
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly userExplicitConsentToken?: string;
}

export interface GitRunner {
  execGit(args: readonly string[], options: GitRunOptions): Promise<GitExecResult>;
  resolveGitBinary(): Promise<string>;
}

export interface ProcessGitRunnerOptions {
  readonly gitBinary?: string;
  readonly timeoutMs?: number;
}

export function createProcessGitRunner(options: ProcessGitRunnerOptions = {}): GitRunner {
  const gitBinary = options.gitBinary ?? "git";
  const defaultTimeoutMs = options.timeoutMs ?? 180_000;
  return {
    async resolveGitBinary() {
      return gitBinary;
    },
    execGit(args, run) {
      const timeoutMs = run.timeoutMs ?? defaultTimeoutMs;
      const fullArgs = ["-c", "core.longpaths=true", "-c", "core.quotepath=false", ...args];
      const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
      if (run.env) {
        for (const [key, value] of Object.entries(run.env)) {
          if (value === undefined) delete env[key];
          else env[key] = value;
        }
      }
      return new Promise((resolve, reject) => {
        const started = Date.now();
        let stdout = "";
        let stderr = "";
        let settled = false;
        let timedOut = false;
        const child = spawn(gitBinary, fullArgs, {
          cwd: run.cwd,
          env,
          shell: false,
          windowsHide: true,
        });
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill();
        }, timeoutMs);
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
        });
        child.on("error", (error: NodeJS.ErrnoException) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error.code === "ENOENT") {
            reject(new Error(`git binary not found: ${gitBinary}`));
            return;
          }
          reject(error);
        });
        child.on("close", (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (timedOut) {
            reject(new Error(`git ${args.join(" ")} timed out after ${timeoutMs}ms`));
            return;
          }
          resolve({
            exitCode: code ?? 1,
            stdout,
            stderr,
            durationMs: Date.now() - started,
          });
        });
      });
    },
  };
}

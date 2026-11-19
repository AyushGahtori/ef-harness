import { spawn } from "node:child_process";

export interface SpawnCollectResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

const OUTPUT_CAP = 1_000_000;

export function spawnCollect(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly timeoutMs: number;
    readonly env: Readonly<Record<string, string>>;
  },
): Promise<SpawnCollectResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutLength = 0;
    let stderrLength = 0;
    let settled = false;

    const finish = (result: SpawnCollectResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutLength >= OUTPUT_CAP) return;
      stdoutChunks.push(chunk);
      stdoutLength += chunk.length;
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrLength >= OUTPUT_CAP) return;
      stderrChunks.push(chunk);
      stderrLength += chunk.length;
    });

    const timer = setTimeout(() => {
      child.kill();
      finish({
        exitCode: null,
        stdout: "",
        stderr: "",
        durationMs: Date.now() - started,
        timedOut: true,
      });
    }, options.timeoutMs);

    child.on("error", () => {
      finish({
        exitCode: null,
        stdout: "",
        stderr: "",
        durationMs: Date.now() - started,
        timedOut: false,
      });
    });
    child.on("close", (code) => {
      finish({
        exitCode: code,
        stdout: Buffer.concat(stdoutChunks).toString("utf8").slice(0, OUTPUT_CAP),
        stderr: Buffer.concat(stderrChunks).toString("utf8").slice(0, OUTPUT_CAP),
        durationMs: Date.now() - started,
        timedOut: false,
      });
    });
  });
}

export function scrubbedEnv(extra?: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  env.GIT_TERMINAL_PROMPT = "0";
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      env[key] = value;
    }
  }
  return env;
}

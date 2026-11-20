import { spawn, type ChildProcess } from "node:child_process";

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function stopChild(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), 1000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (pid && isAlive(pid) && process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    await new Promise<void>((resolve) => {
      killer.once("exit", () => resolve());
    });
  }
}

export interface BootedKitchen {
  origin: string;
  pid: number;
  stderr: () => string;
  stop: () => Promise<void>;
}

export async function bootKitchen(options: {
  repoDir: string;
  dbPath: string;
  mailpitUrl: string;
  port: number;
  defect?: string;
  bench: boolean;
}): Promise<BootedKitchen> {
  let stderr = "";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(options.port),
    KITCHEN_DB: options.dbPath,
    MAILPIT_URL: options.mailpitUrl,
    KITCHEN_BENCH: options.bench ? "1" : "0",
  };
  if (options.defect) env.KITCHEN_DEFECT = options.defect;
  else delete env.KITCHEN_DEFECT;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: options.repoDir,
    env,
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const origin = `http://127.0.0.1:${options.port}`;
  const started = Date.now();
  let up = false;
  while (Date.now() - started < 8000) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${origin}/`);
      await response.text();
      if (response.ok) {
        up = true;
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
  if (!up) {
    await stopChild(child);
    throw new Error(stderr || "kitchen server did not boot");
  }
  return {
    origin,
    pid: child.pid ?? 0,
    stderr: () => stderr,
    stop: async () => {
      await stopChild(child);
    },
  };
}

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const supervisorPath = fileURLToPath(new URL("./job-supervisor.ps1", import.meta.url));

function existsFile(file) {
  try {
    return fs.existsSync(file) && fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function powershellExe() {
  const root = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  return path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function expandShim(token, shimFile) {
  const dir = path.dirname(shimFile);
  return token
    .replaceAll("%~dp0", `${dir}${path.sep}`)
    .replaceAll("%dp0%", `${dir}${path.sep}`)
    .replaceAll("$basedir", dir)
    .replaceAll("${basedir}", dir);
}

function quotedStrings(text) {
  const values = [];
  const pattern = /"([^"]+)"/g;
  for (const match of text.matchAll(pattern)) {
    values.push(match[1] ?? "");
  }
  return values;
}

function unwrapWindowsShim(file) {
  const ext = path.extname(file).toLowerCase();
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const tokens = quotedStrings(text).map((token) => expandShim(token, file));
  const existing = tokens.map((token) => token.trim()).filter((token) => token && existsFile(token));
  const executable = existing.find((token) => {
    const suffix = path.extname(token).toLowerCase();
    return suffix === ".exe" || suffix === ".cmd" || suffix === ".bat" || suffix === "";
  });
  const script = existing.find((token) => path.extname(token).toLowerCase() === ".js");
  if (executable && path.extname(executable).toLowerCase() === ".exe") {
    const args = existing.filter((token) => token !== executable);
    return { file: executable, args };
  }
  if (script) {
    return { file: process.execPath, args: [script] };
  }
  if (ext === ".ps1") {
    const js = tokens.find((token) => token.trim().toLowerCase().endsWith(".js"));
    if (js && existsFile(js.trim())) {
      return { file: process.execPath, args: [js.trim()] };
    }
  }
  return null;
}

export function resolveExecutable(command) {
  if (typeof command !== "string" || !command.trim() || /[\r\n"]/.test(command)) {
    return { status: "not_installed", command: command ?? "" };
  }
  const direct = command.includes("/") || command.includes("\\") || path.isAbsolute(command);
  const candidates = [];
  if (direct) {
    candidates.push(command);
  } else {
    const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
    const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ".ps1"] : [""];
    for (const dir of dirs) {
      for (const extension of extensions) {
        candidates.push(path.join(dir, `${command}${extension}`));
      }
    }
  }
  for (const candidate of candidates) {
    if (!existsFile(candidate)) continue;
    const ext = path.extname(candidate).toLowerCase();
    if (ext === ".cmd" || ext === ".bat" || ext === ".ps1") {
      const unwrapped = unwrapWindowsShim(candidate);
      if (!unwrapped) {
        return { status: "not_installed", command, reason: "shim-unparsed" };
      }
      return { status: "ok", file: unwrapped.file, args: unwrapped.args, via: candidate };
    }
    return { status: "ok", file: candidate, args: [], via: candidate };
  }
  return { status: "not_installed", command };
}

export function planSpawn(command, args = []) {
  const resolved = resolveExecutable(command);
  if (resolved.status !== "ok") return resolved;
  return {
    status: "ok",
    file: resolved.file,
    args: [...resolved.args, ...args],
    shell: false,
    windowsHide: true,
    via: resolved.via,
  };
}

function readLine(stream) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      cleanup();
      resolve(buffer.slice(0, newline).replace(/\r$/, "").trim());
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      resolve(buffer.trim());
    };
    const cleanup = () => {
      stream.off("data", onData);
      stream.off("error", onError);
      stream.off("end", onEnd);
    };
    stream.on("data", onData);
    stream.on("error", onError);
    stream.on("end", onEnd);
  });
}

async function attachJob(child) {
  if (process.platform !== "win32") {
    return {
      assigned: true,
      detail: "posix-process-group",
      async kill() {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          try {
            child.kill("SIGKILL");
          } catch {
            /* already exited */
          }
        }
      },
      async close() {},
    };
  }
  const supervisor = spawn(
    powershellExe(),
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", supervisorPath],
    { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const ready = await readLine(supervisor.stdout);
  if (ready !== "OK") {
    const stderr = supervisor.stderr?.read?.()?.toString?.() ?? "";
    supervisor.kill();
    throw new Error(`job supervisor failed: ${ready} ${stderr}`.trim());
  }
  supervisor.stdin.write(`ASSIGN ${child.pid}\n`);
  const assigned = await readLine(supervisor.stdout);
  const finish = async (command) => {
    if (supervisor.exitCode !== null || supervisor.stdin.destroyed) return;
    supervisor.stdin.write(`${command}\n`);
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        supervisor.kill();
        resolve();
      }, 2000);
      supervisor.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };
  return {
    assigned: assigned.startsWith("OK"),
    detail: assigned,
    kill: () => finish("KILL"),
    close: () => finish("CLOSE"),
  };
}

export async function spawnRuntime(options) {
  const plan = planSpawn(options.command, options.args ?? []);
  if (plan.status !== "ok") return plan;
  const child = spawn(plan.file, plan.args, {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const spawnError = await new Promise((resolve) => {
    const onError = (error) => {
      child.off("spawn", onSpawn);
      resolve(error);
    };
    const onSpawn = () => {
      child.off("error", onError);
      resolve(null);
    };
    child.once("error", onError);
    child.once("spawn", onSpawn);
  });
  if (spawnError) {
    return { status: "not_installed", command: options.command, reason: spawnError.message };
  }
  const job = options.job === false ? null : await attachJob(child);
  return { status: "ok", child, job, plan };
}

function forceTreeKill(pid) {
  if (!pid || process.platform !== "win32") return Promise.resolve();
  const killer = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
  return new Promise((resolve) => {
    const child = spawn(killer, ["/F", "/T", "/PID", String(pid)], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

export async function interruptRuntime(handle, timeoutMs = 750) {
  if (!handle || handle.status !== "ok") return;
  const { child, job } = handle;
  try {
    child.stdin?.end();
  } catch {
    /* stdin already closed */
  }
  try {
    child.kill("SIGINT");
  } catch {
    /* signal is not delivered to every Windows console child */
  }
  const exited = await waitForExit(child, timeoutMs);
  if (!exited) {
    if (job) await job.kill();
    try {
      child.kill("SIGKILL");
    } catch {
      /* already exited */
    }
    const dead = await waitForExit(child, 1000);
    if (!dead) await forceTreeKill(child.pid);
    return;
  }
  if (job) await job.close();
}

export function scrubbedEnv(extra = {}) {
  const allow = [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "HOMEDRIVE",
    "HOMEPATH",
    "PROCESSOR_ARCHITECTURE",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "COMSPEC",
  ];
  const env = {};
  for (const key of allow) {
    const value = process.env[key];
    if (typeof value === "string") env[key] = value;
  }
  return { ...env, ...extra };
}

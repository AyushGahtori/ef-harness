import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

import { fileURLToPath } from "node:url";

function unrefStream(stream: NodeJS.ReadableStream | NodeJS.WritableStream | null): void {
  if (stream && "unref" in stream && typeof stream.unref === "function") stream.unref();
}

function hostSource(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "windows-pipe-acl.ps1"),
    path.join(here, "..", "..", "src", "transport", "windows-pipe-acl.ps1"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, "utf8");
  }
  throw new Error("windows pipe ACL script is missing");
}

export function securityTrustees(sddl: string): string[] {
  const trustees: string[] = [];
  for (const match of sddl.matchAll(/\([^()]*;;;([^()]*)\)/g)) {
    const trustee = match[1];
    if (trustee) trustees.push(trustee);
  }
  return trustees;
}

function encodeArg(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function decodeArg(value: string): string {
  return Buffer.from(value, "base64").toString("utf8");
}

class WindowsSecurityHost {
  readonly sid: string;
  private readonly child: ChildProcessWithoutNullStreams;
  private pending: ((line: string) => void) | undefined;
  private chain: Promise<void> = Promise.resolve();

  private constructor(child: ChildProcessWithoutNullStreams, sid: string) {
    this.child = child;
    this.sid = sid;
  }

  static async start(): Promise<WindowsSecurityHost> {
    const scriptPath = path.join(os.tmpdir(), `ef-harness-pipe-acl-${process.pid}.ps1`);
    await fs.promises.writeFile(scriptPath, hostSource(), "utf8");
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, String(process.pid)],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    child.unref();
    unrefStream(child.stdin);
    unrefStream(child.stdout);
    unrefStream(child.stderr);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const hostPromise = new Promise<WindowsSecurityHost>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Windows pipe ACL host did not start: ${stderr}`));
      }, 30_000);
      const lines = readline.createInterface({ input: child.stdout });
      const hostBox: { host?: WindowsSecurityHost } = {};
      lines.on("line", (line) => {
        if (!hostBox.host) {
          if (line.startsWith("READY ")) {
            clearTimeout(timer);
            hostBox.host = new WindowsSecurityHost(child, line.slice("READY ".length).trim());
            resolve(hostBox.host);
          }
          return;
        }
        hostBox.host.onLine(line);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (!hostBox.host) reject(new Error(`Windows pipe ACL host exited ${code ?? 0}: ${stderr}`));
      });
    });
    const host = await hostPromise;
    process.once("exit", () => {
      if (!child.killed) child.kill();
    });
    return host;
  }

  private onLine(line: string): void {
    const waiter = this.pending;
    this.pending = undefined;
    waiter?.(line);
  }

  private roundTrip(command: string): Promise<string> {
    const task = this.chain.then(
      () =>
        new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.pending = undefined;
            reject(new Error(`Windows pipe ACL host timed out on ${command.split(" ")[0] ?? "command"}`));
          }, 10_000);
          this.pending = (line) => {
            clearTimeout(timer);
            resolve(line);
          };
          this.child.stdin.write(`${command}\n`, (error) => {
            if (error) {
              clearTimeout(timer);
              this.pending = undefined;
              reject(error);
            }
          });
        }),
    );
    this.chain = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  async fixPipe(leaf: string): Promise<number> {
    const line = await this.roundTrip(`FIX ${encodeArg(leaf)}`);
    if (!line.startsWith("OK ")) throw new Error(line);
    const count = Number(line.slice(3));
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`named pipe ${leaf} was not found for ACL replacement`);
    }
    return count;
  }

  async readPipeSddl(leaf: string): Promise<string[]> {
    const line = await this.roundTrip(`SDDL ${encodeArg(leaf)}`);
    if (!line.startsWith("SDDL ")) throw new Error(line);
    const body = decodeArg(line.slice(5)).trim();
    if (body.length === 0) return [];
    return body.split(/\r?\n/).filter((item) => item.length > 0);
  }

  async lockFile(filePath: string): Promise<void> {
    const line = await this.roundTrip(`LOCK ${encodeArg(filePath)}`);
    if (line !== "OK lock") throw new Error(line);
  }

  async readFileSddl(filePath: string): Promise<string> {
    const line = await this.roundTrip(`FILE ${encodeArg(filePath)}`);
    if (!line.startsWith("FILE ")) throw new Error(line);
    return decodeArg(line.slice(5));
  }
}

let hostPromise: Promise<WindowsSecurityHost> | undefined;

export function windowsSecurityAvailable(): boolean {
  return process.platform === "win32";
}

export async function warmWindowsSecurity(): Promise<void> {
  if (process.platform !== "win32") return;
  await acquireWindowsSecurity();
}

async function acquireWindowsSecurity(): Promise<WindowsSecurityHost> {
  if (!hostPromise) hostPromise = WindowsSecurityHost.start();
  return hostPromise;
}

export async function currentUserSid(): Promise<string> {
  return (await acquireWindowsSecurity()).sid;
}

export async function tightenNamedPipe(leaf: string): Promise<void> {
  await (await acquireWindowsSecurity()).fixPipe(leaf);
}

export async function restrictNamedPipeToCurrentUser(leaf: string): Promise<void> {
  const host = await acquireWindowsSecurity();
  await host.fixPipe(leaf);
  const descriptors = await host.readPipeSddl(leaf);
  if (descriptors.length === 0) throw new Error(`named pipe ${leaf} has no security descriptor`);
  for (const sddl of descriptors) {
    const trustees = securityTrustees(sddl);
    for (const trustee of trustees) {
      if (trustee !== "SY" && trustee !== host.sid) {
        throw new Error(`named pipe ACL grants ${trustee}`);
      }
    }
    if (!trustees.includes("SY") || !trustees.includes(host.sid)) {
      throw new Error("named pipe ACL is missing the current user or SYSTEM");
    }
  }
}

export async function readNamedPipeSddl(leaf: string): Promise<string[]> {
  return (await acquireWindowsSecurity()).readPipeSddl(leaf);
}

export async function restrictFileToCurrentUser(filePath: string): Promise<void> {
  if (process.platform !== "win32") {
    await fs.promises.chmod(filePath, 0o600);
    return;
  }
  await (await acquireWindowsSecurity()).lockFile(filePath);
}

export async function readFileAccessSddl(filePath: string): Promise<string> {
  if (process.platform !== "win32") {
    const stat = await fs.promises.stat(filePath);
    return `mode:${(stat.mode & 0o777).toString(8)}`;
  }
  return (await acquireWindowsSecurity()).readFileSddl(filePath);
}

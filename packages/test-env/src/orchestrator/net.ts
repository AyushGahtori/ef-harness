import { execFile } from "node:child_process";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function canBindPort(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    const finish = (value: boolean) => {
      server.removeAllListeners();
      if (server.listening) {
        server.close(() => resolve(value));
        return;
      }
      resolve(value);
    };
    server.once("error", () => finish(false));
    server.listen({ port, host, exclusive: true }, () => finish(true));
  });
}

export function tcpConnectable(port: number, host: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export function httpStatus(
  port: number,
  path: string,
  hostHeader: string,
  timeoutMs: number,
): Promise<number | null> {
  return new Promise((resolve) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: { host: hostHeader },
        timeout: timeoutMs,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? null);
      },
    );
    request.once("error", () => resolve(null));
    request.once("timeout", () => {
      request.destroy();
      resolve(null);
    });
    request.end();
  });
}

export function parseListeningPid(output: string, port: number): number | null {
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes("LISTENING")) continue;
    const match = /:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/.exec(line.trim());
    if (!match) continue;
    if (Number(match[1]) !== port) continue;
    const pid = Number(match[2]);
    if (Number.isInteger(pid) && pid > 0) return pid;
  }
  return null;
}

export async function listeningPid(port: number, hintPid?: number): Promise<number | null> {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "tcp"], {
        windowsHide: true,
        timeout: 2_000,
      });
      return parseListeningPid(stdout, port);
    } catch (error) {
      if (error instanceof Error) return null;
      return null;
    }
  }
  if (process.platform === "linux") return linuxListeningPid(port, hintPid);
  return null;
}

function linuxListeningPid(port: number, hintPid?: number): number | null {
  const inodes = linuxListenInodes(port);
  if (inodes.size === 0) return null;
  if (hintPid !== undefined && processOwnsSocket(hintPid, inodes)) return hintPid;
  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch (error) {
    if (error instanceof Error) return null;
    return null;
  }
  for (const entry of entries) {
    if (!/^[1-9]\d*$/.test(entry)) continue;
    const pid = Number(entry);
    if (hintPid !== undefined && pid === hintPid) continue;
    if (processOwnsSocket(pid, inodes)) return pid;
  }
  return null;
}

function linuxListenInodes(port: number): Set<string> {
  const inodes = new Set<string>();
  const portHex = port.toString(16).toUpperCase().padStart(4, "0");
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      if (error instanceof Error) continue;
      continue;
    }
    for (const line of text.split("\n")) {
      const fields = line.trim().split(/\s+/);
      const local = fields[1];
      const state = fields[3];
      const inode = fields[9];
      if (!local || !state || !inode) continue;
      const hexPort = local.split(":")[1]?.toUpperCase();
      if (hexPort !== portHex || state.toUpperCase() !== "0A" || inode === "0") continue;
      inodes.add(inode);
    }
  }
  return inodes;
}

function processOwnsSocket(pid: number, inodes: Set<string>): boolean {
  let fds: string[];
  try {
    fds = readdirSync(`/proc/${pid}/fd`);
  } catch (error) {
    if (error instanceof Error) return false;
    return false;
  }
  for (const fd of fds) {
    let link = "";
    try {
      link = readlinkSync(`/proc/${pid}/fd/${fd}`);
    } catch (error) {
      if (error instanceof Error) continue;
      continue;
    }
    const match = /^socket:\[(\d+)\]$/.exec(link);
    const inode = match?.[1];
    if (inode && inodes.has(inode)) return true;
  }
  return false;
}

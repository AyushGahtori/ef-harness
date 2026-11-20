import { execFile } from "node:child_process";
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

export async function listeningPid(port: number): Promise<number | null> {
  if (process.platform !== "win32") return null;
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

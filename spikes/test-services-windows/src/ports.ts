import { randomInt } from "node:crypto";
import { closeSync, mkdirSync, openSync, rmSync, unlinkSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { LOOPBACK_HOST, PORT_MAX, PORT_MIN } from "./constants.ts";
import { SpikeError } from "./errors.ts";

export function assertLoopbackHost(host: string): void {
  if (host !== LOOPBACK_HOST) {
    throw new SpikeError(
      "non_loopback_bind",
      `Refusing to bind ${host}. Test services must bind only ${LOOPBACK_HOST}.`,
    );
  }
}

export function assertPortInRange(port: number): void {
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    throw new SpikeError("port_out_of_range", `Port ${port} is outside ${PORT_MIN}-${PORT_MAX}.`);
  }
}

export interface ReservedPort {
  readonly port: number;
  unhold(): Promise<void>;
  release(): Promise<void>;
}

export async function reserveLoopbackPort(options?: {
  nextPort?: () => number;
}): Promise<ReservedPort> {
  const nextPort = options?.nextPort ?? (() => randomInt(PORT_MIN, PORT_MAX + 1));
  const seen = new Set<number>();
  let lastError = "no attempt";
  for (let attempt = 0; attempt < 256; attempt += 1) {
    const port = nextPort();
    if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
      throw new SpikeError("port_out_of_range", `Allocator proposed ${port}, outside ${PORT_MIN}-${PORT_MAX}.`);
    }
    if (seen.has(port)) continue;
    seen.add(port);
    try {
      return await holdPort(port);
    } catch (error) {
      const code = error instanceof SpikeError ? error.code : "";
      if (code === "eaddrinuse" || code === "lock_busy") {
        lastError = error instanceof Error ? error.message : String(error);
        continue;
      }
      throw error;
    }
  }
  throw new SpikeError(
    "port_exhausted",
    `No free loopback port in ${PORT_MIN}-${PORT_MAX}. Last error: ${lastError}`,
  );
}

async function holdPort(port: number): Promise<ReservedPort> {
  const lock = acquireLock(port);
  let server: Server | undefined;
  try {
    server = await listenLoopback(port);
  } catch (error) {
    lock.release();
    throw error;
  }
  let held: Server | undefined = server;
  return {
    port,
    async unhold() {
      const current = held;
      held = undefined;
      if (current) await closeServer(current);
    },
    async release() {
      const current = held;
      held = undefined;
      if (current) await closeServer(current);
      lock.release();
    },
  };
}

function lockDirectory(): string {
  const root = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "EFHarness", "port-locks")
    : path.join(tmpdir(), "ef-harness-port-locks");
  mkdirSync(root, { recursive: true });
  return root;
}

function acquireLock(port: number): { release(): void } {
  const file = path.join(lockDirectory(), `${port}.lock`);
  let fd: number;
  try {
    fd = openSync(file, "wx");
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "EEXIST") {
      throw new SpikeError("lock_busy", `Port ${port} is already reserved.`);
    }
    throw error;
  }
  closeSync(fd);
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      try {
        unlinkSync(file);
      } catch {
        rmSync(file, { force: true });
      }
    },
  };
}

export function listenLoopback(port: number): Promise<Server> {
  assertPortInRange(port);
  assertLoopbackHost(LOOPBACK_HOST);
  return new Promise((resolve, reject) => {
    const server = createServer();
    const fail = (error: NodeJS.ErrnoException) => {
      server.close();
      if (error.code === "EADDRINUSE") {
        reject(new SpikeError("eaddrinuse", `${LOOPBACK_HOST}:${port} is already in use.`));
        return;
      }
      reject(error);
    };
    server.once("error", fail);
    server.listen(port, LOOPBACK_HOST, () => {
      server.off("error", fail);
      const address = server.address();
      if (!address || typeof address === "string" || address.address !== LOOPBACK_HOST) {
        void closeServer(server).finally(() => {
          reject(new SpikeError("non_loopback_bind", `Socket for ${port} did not bind ${LOOPBACK_HOST}.`));
        });
        return;
      }
      resolve(server);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

export function canConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let socket: Socket;
    try {
      socket = createConnection({ host, port });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

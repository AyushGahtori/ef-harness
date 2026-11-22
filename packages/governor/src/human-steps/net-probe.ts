import net from "node:net";
import tls from "node:tls";

import { HumanStepError } from "./errors.js";
import { PROBE_TIMEOUT_DIAGNOSIS } from "./types.js";

export interface ProbeByteStream {
  write(data: Buffer): void;
  read(timeoutMs: number): Promise<Buffer>;
  close(): void;
}

export async function openProbeStream(
  host: string,
  port: number,
  timeoutMs: number,
  signal: AbortSignal,
  secure: boolean,
): Promise<ProbeByteStream> {
  if (signal.aborted) throw new HumanStepError("PROBE_TIMEOUT", PROBE_TIMEOUT_DIAGNOSIS);
  const socket = await connect(host, port, timeoutMs, signal, secure);
  return wrapSocket(socket, timeoutMs, signal);
}

function connect(
  host: string,
  port: number,
  timeoutMs: number,
  signal: AbortSignal,
  secure: boolean,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const socket = secure
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: true })
      : net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      fail(new HumanStepError("PROBE_TIMEOUT", PROBE_TIMEOUT_DIAGNOSIS));
    }, timeoutMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      socket.destroy();
      fail(new HumanStepError("PROBE_TIMEOUT", PROBE_TIMEOUT_DIAGNOSIS));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    socket.once("secureConnect", () => done());
    if (!secure) socket.once("connect", () => done());
    socket.once("error", (error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      fail(error);
    });
    function done(): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(socket);
    }
  });
}

function wrapSocket(socket: net.Socket, timeoutMs: number, signal: AbortSignal): ProbeByteStream {
  const pending: Buffer[] = [];
  let waiter: ((value: Buffer) => void) | null = null;
  let failure: Error | null = null;
  const failWaiter = (error: Error): void => {
    failure = error;
    if (!waiter) return;
    const resolve = waiter;
    waiter = null;
    resolve(Buffer.alloc(0));
  };
  socket.on("data", (chunk) => {
    const buffer = Buffer.from(chunk);
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve(buffer);
      return;
    }
    pending.push(buffer);
  });
  socket.on("error", (error) => {
    failWaiter(error);
  });
  socket.on("close", () => {
    if (!failure) failWaiter(new HumanStepError("socket_closed", "database connection closed"));
  });
  signal.addEventListener(
    "abort",
    () => {
      socket.destroy();
      failWaiter(new HumanStepError("PROBE_TIMEOUT", PROBE_TIMEOUT_DIAGNOSIS));
    },
    { once: true },
  );
  return {
    write(data: Buffer): void {
      socket.write(data);
    },
    read(): Promise<Buffer> {
      const queued = pending.shift();
      if (queued) return Promise.resolve(queued);
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiter = null;
          socket.destroy();
          reject(new HumanStepError("PROBE_TIMEOUT", PROBE_TIMEOUT_DIAGNOSIS));
        }, timeoutMs);
        waiter = (value) => {
          clearTimeout(timer);
          if (failure && value.length === 0) {
            reject(failure);
            return;
          }
          resolve(value);
        };
      });
    },
    close(): void {
      socket.destroy();
    },
  };
}

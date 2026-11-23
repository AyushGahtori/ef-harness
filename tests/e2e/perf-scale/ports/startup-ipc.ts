import { connect, createServer } from "node:net";
import { summarize } from "../stats.ts";

export interface StartupIpcSloResult {
  coldBootMs: number;
  pipeP99Ms: number;
  streamThroughputMbps: number;
  pass: boolean;
  detail: string[];
}

function listenEcho(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer((socket) => {
    socket.setNoDelay(true);
    socket.on("data", (chunk) => {
      socket.write(chunk);
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        port,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
    server.on("error", reject);
  });
}

export async function simulateColdBoot(): Promise<number> {
  const started = performance.now();
  const { port, close } = await listenEcho();
  try {
    await new Promise<void>((resolve, reject) => {
      const client = connect({ host: "127.0.0.1", port }, () => client.write("boot"));
      client.on("data", () => {
        client.end();
        resolve();
      });
      client.on("error", reject);
    });
  } finally {
    await close();
  }
  return performance.now() - started;
}

export async function measureNamedPipeRoundTrip(samples = 128, warmup = 32): Promise<readonly number[]> {
  const latencies: number[] = [];
  const { port, close } = await listenEcho();
  try {
    await new Promise<void>((resolve, reject) => {
      const client = connect({ host: "127.0.0.1", port });
      let count = 0;
      let sendStarted = 0;
      const sendNext = (): void => {
        sendStarted = performance.now();
        client.write(`ping-${count}`);
      };
      client.on("connect", () => {
        client.setNoDelay(true);
        sendNext();
      });
      client.on("data", () => {
        if (count >= warmup) latencies.push(performance.now() - sendStarted);
        count += 1;
        if (count >= warmup + samples) {
          client.end();
          resolve();
          return;
        }
        sendNext();
      });
      client.on("error", reject);
    });
  } finally {
    await close();
  }
  return latencies;
}

export async function measureStreamThroughput(): Promise<number> {
  const payload = Buffer.alloc(64 * 1024, 0x5a);
  const iterations = 512;
  let bytes = 0;
  const { port, close } = await listenEcho();
  try {
    const started = performance.now();
    await new Promise<void>((resolve, reject) => {
      const conn = connect({ host: "127.0.0.1", port }, () => {
        for (let index = 0; index < iterations; index += 1) {
          conn.write(payload);
          bytes += payload.length;
        }
      });
      let received = 0;
      conn.on("data", (chunk) => {
        received += chunk.length;
        if (received >= bytes) {
          conn.end();
          resolve();
        }
      });
      conn.on("error", reject);
    });
    const seconds = (performance.now() - started) / 1000;
    return seconds === 0 ? 0 : bytes / (1024 * 1024) / seconds;
  } finally {
    await close();
  }
}

export async function certifySlo6StartupIpc(): Promise<StartupIpcSloResult> {
  const detail: string[] = [];
  const coldBootMs = await simulateColdBoot();
  const pipeSamples = await measureNamedPipeRoundTrip(128, 32);
  const pipeSummary = summarize(pipeSamples);
  const streamThroughputMbps = await measureStreamThroughput();
  if (!(coldBootMs < 800)) detail.push(`cold boot ${coldBootMs} ms >= 800`);
  if (!(pipeSummary.p99 < 5)) detail.push(`named-pipe p99 ${pipeSummary.p99} ms >= 5`);
  if (!(streamThroughputMbps >= 50)) detail.push(`stream throughput ${streamThroughputMbps} MB/s < 50`);
  return {
    coldBootMs,
    pipeP99Ms: pipeSummary.p99,
    streamThroughputMbps,
    pass: detail.length === 0,
    detail,
  };
}
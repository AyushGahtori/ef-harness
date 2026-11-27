import path from "node:path";
import { SecretRedactor } from "@ef-harness/shared-observability";
import { NamedPipeClient, NamedPipeServer, SessionTokenStore } from "@ef-harness/ipc";
import type { StructuredLogger } from "@ef-harness/ipc";

const quiet: StructuredLogger = {
  debug() {
    return undefined;
  },
  info() {
    return undefined;
  },
  warn() {
    return undefined;
  },
  error() {
    return undefined;
  },
};

/**
 * Crash the first named-pipe session before the snapshot is delivered, then
 * restart `NamedPipeServer` and require the framed client to read the same payload.
 */
export async function exerciseNamedPipe(pipePath: string, payload: string): Promise<void> {
  const redactor = new SecretRedactor();
  const tokens = new SessionTokenStore({
    directory: path.join(path.dirname(pipePath), `ef-m0-token-${path.basename(pipePath)}`),
    redactor,
  });
  await tokens.start();
  const crashed = new NamedPipeServer({
    pipePath,
    tokenStore: tokens,
    logger: quiet,
    onRequest: () => {
      throw new Error("daemon crashed before the receipt");
    },
  });
  await crashed.listen();
  const first = new NamedPipeClient({
    pipePath,
    token: tokens.token,
    logger: quiet,
    clientName: "m0-sim",
    clientVersion: "0.0.0",
    maxRetries: 0,
    requestTimeoutMs: 2_000,
  });
  let dropped = false;
  try {
    await first.start();
    await first.request("snapshot.get", {});
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    dropped = true;
  } finally {
    await first.close();
    await crashed.close();
  }
  if (!dropped) throw new Error("named pipe delivered the receipt before the crash");

  const restarted = new NamedPipeServer({
    pipePath,
    tokenStore: tokens,
    logger: quiet,
    onRequest: () => payload,
  });
  await restarted.listen();
  const second = new NamedPipeClient({
    pipePath,
    token: tokens.token,
    logger: quiet,
    clientName: "m0-sim",
    clientVersion: "0.0.0",
    maxRetries: 0,
    requestTimeoutMs: 2_000,
  });
  try {
    await second.start();
    const result = await second.request("snapshot.get", {});
    if (result !== payload) throw new Error("named pipe snapshot mismatch");
  } finally {
    await second.close();
    await restarted.close();
  }
}

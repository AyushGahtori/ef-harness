import net from "node:net";

interface Bindable {
  listen(port: number, host: string, callback: () => void): void;
  once(event: "error", listener: (error: Error) => void): void;
  off(event: "error", listener: (error: Error) => void): void;
  address(): string | { port: number } | null;
}

export function listenLoopback(server: Bindable, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("loopback listener did not bind a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

export function closeServer(server: {
  close(callback?: (error?: Error) => void): void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error && nodeCloseError(error) !== "ERR_SERVER_NOT_RUNNING") {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function nodeCloseError(error: Error): string {
  if ("code" in error && typeof error.code === "string") return error.code;
  return "";
}

export async function reserveLoopbackPort(): Promise<number> {
  const probe = net.createServer();
  try {
    return await listenLoopback(probe, 0);
  } finally {
    await closeServer(probe);
  }
}

export function waitForTcp(host: string, port: number, timeoutMs: number): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const socket = net.connect({ host, port });
      const fail = (error: Error): void => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) {
          reject(error);
          return;
        }
        setTimeout(attempt, 50);
      };
      socket.once("error", fail);
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
    };
    attempt();
  });
}

export function ignoreSocketError(socket: { on(event: "error", listener: () => void): void }): void {
  socket.on("error", () => undefined);
}

export async function readLimitedBody(
  req: AsyncIterable<Buffer | string>,
  maxBytes: number,
): Promise<{ readonly tooLarge: true } | { readonly tooLarge: false; readonly body: Buffer }> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBytes) return { tooLarge: true };
    chunks.push(bytes);
  }
  return { tooLarge: false, body: Buffer.concat(chunks) };
}

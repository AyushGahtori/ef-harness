import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export async function listen(
  handler: (req: IncomingMessage, res: ServerResponse, port: number) => void,
): Promise<{ port: number; close: () => Promise<void> }> {
  let port = 0;
  const server = createServer((req, res) => {
    req.on("error", () => undefined);
    res.on("error", () => undefined);
    handler(req, res, port);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("fixture server did not bind a TCP port");
  }
  port = (address as AddressInfo).port;
  return {
    port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

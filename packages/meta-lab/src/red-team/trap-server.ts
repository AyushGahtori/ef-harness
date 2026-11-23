import { createServer, request, type Server } from "node:http";

export type TrapPath = "/health" | "/steal" | "/exfil";

interface TrapHit {
  readonly path: string;
}

export class TrapServer {
  private closed = false;

  private constructor(
    private readonly server: Server,
    readonly port: number,
    readonly hits: TrapHit[],
  ) {}

  static async listen(): Promise<TrapServer> {
    const hits: TrapHit[] = [];
    const server = createServer((req, res) => {
      const pathOnly = (req.url ?? "/").split("?")[0] ?? "/";
      req.resume();
      req.on("end", () => {
        hits.push({ path: pathOnly });
        res.writeHead(204);
        res.end();
      });
    });
    server.on("clientError", (error, socket) => {
      socket.destroy(error instanceof Error ? error : undefined);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      server.close();
      throw new Error("loopback trap did not bind a TCP port");
    }
    return new TrapServer(server, address.port, hits);
  }

  get hitCount(): number {
    return this.hits.length;
  }

  recordLoopbackHit(pathname: TrapPath): Promise<void> {
    const port = this.port;
    return new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port,
          path: pathname,
          method: "POST",
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve());
        },
      );
      req.on("error", reject);
      req.end("fixture");
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (!this.server.listening) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

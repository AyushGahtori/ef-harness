import net from "node:net";

function settleOnce(action: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    action();
  };
}

/**
 * Real Windows named-pipe crash/restart. The first server dies before the receipt.
 * The restarted server delivers the snapshot, which must match byte for byte.
 */
export function exerciseNamedPipe(pipePath: string, payload: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const succeed = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const server = net.createServer((socket) => {
      socket.destroy();
    });
    server.once("error", fail);
    server.listen(pipePath, () => {
      const client = net.connect(pipePath);
      const crashed = settleOnce(() => {
        server.close((closeError) => {
          if (closeError) {
            fail(closeError);
            return;
          }
          restart(succeed, fail);
        });
      });
      client.once("error", crashed);
      client.once("close", crashed);
    });

    function restart(ok: () => void, bad: (error: unknown) => void): void {
      let data = "";
      const server2 = net.createServer((socket) => {
        socket.end(payload);
      });
      server2.once("error", bad);
      server2.listen(pipePath, () => {
        const client2 = net.connect(pipePath);
        client2.setEncoding("utf8");
        client2.on("data", (chunk: string) => {
          data += chunk;
        });
        client2.once("error", bad);
        client2.once("end", () => {
          server2.close(() => {
            if (data !== payload) bad(new Error("named pipe snapshot mismatch"));
            else ok();
          });
        });
      });
    }
  });
}

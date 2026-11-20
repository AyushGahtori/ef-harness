import net from "node:net";

export const PORT_MIN = 41000;
export const PORT_MAX = 48999;

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    const finish = (open: boolean) => {
      server.removeAllListeners();
      resolve(open);
    };
    server.once("error", () => finish(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => finish(true));
    });
  });
}

export async function leasePort(reserved: readonly number[] = []): Promise<number> {
  const span = PORT_MAX - PORT_MIN + 1;
  const start = PORT_MIN + (process.pid % span);
  for (let offset = 0; offset < span; offset += 1) {
    const port = PORT_MIN + ((start - PORT_MIN + offset) % span);
    if (reserved.includes(port)) continue;
    if (await canListen(port)) return port;
  }
  throw new Error("no free port in 41000-48999");
}

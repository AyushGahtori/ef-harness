import dgram from "node:dgram";
import net from "node:net";

function activeHandles(): unknown[] {
  const getter = (
    process as NodeJS.Process & { _getActiveHandles?: () => unknown[] }
  )._getActiveHandles;
  return typeof getter === "function" ? getter.call(process) : [];
}

/** TCP and UDP sockets this process is listening on. Named pipes are not included. */
export function listTcpUdpListeners(): string[] {
  const found: string[] = [];
  for (const handle of activeHandles()) {
    if (handle instanceof net.Server) {
      const address = handle.address();
      if (address && typeof address === "object" && typeof address.port === "number") {
        found.push(`tcp:${address.port}`);
      }
    }
    if (handle instanceof dgram.Socket) {
      try {
        const address = handle.address();
        found.push(`udp:${address.port}`);
      } catch {
        continue;
      }
    }
  }
  return found;
}

export function assertNoNewNetworkListeners(before: readonly string[]): void {
  const after = listTcpUdpListeners();
  for (const item of after) {
    if (!before.includes(item)) {
      throw new Error(`transport opened a network listener: ${item}`);
    }
  }
}

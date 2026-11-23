import net from "node:net";
import { PortLeaseConflictError, PortOutOfRangeError } from "./errors.js";
import type { PortLease, PortLeaseRepo } from "./ports.js";
import { PREVIEW_PORT_MAX, PREVIEW_PORT_MIN } from "./timings.js";

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      server.close(() => resolve());
      return;
    }
    server.close(() => resolve());
  });
}

function resolvePreviewPortStart(): number {
  const raw = process.env.EF_PREVIEW_PORT_BASE;
  if (raw !== undefined) {
    const base = Number(raw);
    if (Number.isInteger(base) && base >= PREVIEW_PORT_MIN && base <= PREVIEW_PORT_MAX) {
      return base;
    }
  }
  return PREVIEW_PORT_MIN + Math.floor(Math.random() * 4_000);
}

function tryListen(port: number): Promise<net.Server | null> {
  return new Promise((resolve) => {
    const server = net.createServer();
    const fail = (): void => {
      server.removeAllListeners();
      server.close(() => resolve(null));
    };
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => {
      server.removeAllListeners("error");
      resolve(server);
    });
  });
}

/**
 * Machine-wide preview port table for `41000–48999`.
 * A held socket keeps the lease exclusive until the preview process binds it.
 */
export class LocalPortLeaseRepo implements PortLeaseRepo {
  private readonly leases = new Map<number, PortLease>();
  private readonly holders = new Map<number, net.Server>();
  private cursor: number;

  constructor(start = resolvePreviewPortStart()) {
    this.cursor = Math.min(Math.max(start, PREVIEW_PORT_MIN), PREVIEW_PORT_MAX);
  }

  async lease(input: {
    readonly projectId: string;
    readonly environment: string;
    readonly purpose: PortLease["purpose"];
    readonly port?: number;
  }): Promise<PortLease> {
    if (input.port !== undefined) {
      if (!Number.isInteger(input.port) || input.port < PREVIEW_PORT_MIN || input.port > PREVIEW_PORT_MAX) {
        throw new PortOutOfRangeError(input.port);
      }
      if (this.leases.has(input.port)) throw new PortLeaseConflictError(input.port);
      const holder = await tryListen(input.port);
      if (!holder) throw new PortLeaseConflictError(input.port);
      const lease: PortLease = {
        port: input.port,
        projectId: input.projectId,
        environment: input.environment,
        purpose: input.purpose,
      };
      this.leases.set(input.port, lease);
      this.holders.set(input.port, holder);
      return lease;
    }
    for (let offset = 0; offset <= PREVIEW_PORT_MAX - PREVIEW_PORT_MIN; offset += 1) {
      const port = PREVIEW_PORT_MIN + ((this.cursor - PREVIEW_PORT_MIN + offset) % (PREVIEW_PORT_MAX - PREVIEW_PORT_MIN + 1));
      if (this.leases.has(port)) continue;
      const holder = await tryListen(port);
      if (!holder) continue;
      const lease: PortLease = {
        port,
        projectId: input.projectId,
        environment: input.environment,
        purpose: input.purpose,
      };
      this.leases.set(port, lease);
      this.holders.set(port, holder);
      this.cursor = port + 1;
      if (this.cursor > PREVIEW_PORT_MAX) this.cursor = PREVIEW_PORT_MIN;
      return lease;
    }
    throw new Error("preview port pool 41000-48999 is exhausted");
  }

  async releaseHolder(port: number): Promise<void> {
    const holder = this.holders.get(port);
    if (!holder) return;
    this.holders.delete(port);
    await closeServer(holder);
  }

  async hold(port: number): Promise<void> {
    if (!this.leases.has(port) || this.holders.has(port)) return;
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const holder = await tryListen(port);
      if (holder) {
        this.holders.set(port, holder);
        return;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 30);
      });
    }
  }

  async release(port: number): Promise<void> {
    await this.releaseHolder(port);
    this.leases.delete(port);
  }

  list(): readonly PortLease[] {
    return [...this.leases.values()].sort((left, right) => left.port - right.port);
  }
}

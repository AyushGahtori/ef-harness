import net from "node:net";
import path from "node:path";
import {
  GlobalBrokerDb,
  PortLeaseConflictError as BrokerPortLeaseConflictError,
  PortLeaseNotFoundError,
} from "@ef-harness/db";
import { PortLeaseConflictError, PortOutOfRangeError } from "./errors.js";
import type { PortLease, PortLeaseRepo } from "./ports.js";
import { PREVIEW_PORT_MAX, PREVIEW_PORT_MIN } from "./timings.js";

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function resolvePreviewPortStart(): number {
  const raw = process.env.EF_PREVIEW_PORT_BASE;
  if (raw !== undefined) {
    const base = Number(raw);
    if (Number.isInteger(base) && base >= PREVIEW_PORT_MIN && base <= PREVIEW_PORT_MAX) return base;
  }
  return PREVIEW_PORT_MIN;
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
 * `global.db.port_leases` (Task 014) plus a loopback holder so the preview
 * process can bind the leased port.
 */
export class BrokerPortLeaseRepo implements PortLeaseRepo {
  private readonly purposes = new Map<number, PortLease["purpose"]>();
  private readonly holders = new Map<number, net.Server>();
  private readonly projects = new Set<string>();
  private cursor: number;

  constructor(
    private readonly broker: GlobalBrokerDb,
    private readonly projectPath: string,
    start = resolvePreviewPortStart(),
  ) {
    this.cursor = Math.min(Math.max(start, PREVIEW_PORT_MIN), PREVIEW_PORT_MAX);
  }

  async lease(input: {
    readonly projectId: string;
    readonly environment: string;
    readonly purpose: PortLease["purpose"];
    readonly port?: number;
  }): Promise<PortLease> {
    this.ensureProject(input.projectId);
    if (input.port !== undefined) {
      return this.leaseExact(input.projectId, input.environment, input.purpose, input.port);
    }
    const span = PREVIEW_PORT_MAX - PREVIEW_PORT_MIN + 1;
    for (let offset = 0; offset < span; offset += 1) {
      const port = PREVIEW_PORT_MIN + ((this.cursor - PREVIEW_PORT_MIN + offset) % span);
      try {
        const lease = await this.leaseExact(input.projectId, input.environment, input.purpose, port);
        this.cursor = port + 1;
        if (this.cursor > PREVIEW_PORT_MAX) this.cursor = PREVIEW_PORT_MIN;
        return lease;
      } catch (error) {
        if (error instanceof PortLeaseConflictError) continue;
        throw error;
      }
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
    if (this.holders.has(port)) return;
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
    this.purposes.delete(port);
    try {
      this.broker.releasePort(port);
    } catch (error) {
      if (!(error instanceof PortLeaseNotFoundError)) throw error;
    }
  }

  list(): readonly PortLease[] {
    return this.broker
      .listPortLeases()
      .map((lease) => ({
        port: lease.port,
        projectId: lease.projectId,
        environment: lease.environment,
        purpose: this.purposes.get(lease.port) ?? "live-preview",
      }))
      .sort((left, right) => left.port - right.port);
  }

  close(): void {
    for (const holder of this.holders.values()) holder.close();
    this.holders.clear();
    this.broker.close();
  }

  private ensureProject(projectId: string): void {
    if (this.projects.has(projectId)) return;
    if (this.broker.getProject(projectId) === null) {
      this.broker.registerProject({
        id: projectId,
        path: path.resolve(this.projectPath, projectId),
        displayName: projectId,
        schemaVersion: 1,
        lastOpenedAt: Date.now(),
        lastSeenAt: Date.now(),
      });
    }
    this.projects.add(projectId);
  }

  private async leaseExact(
    projectId: string,
    environment: string,
    purpose: PortLease["purpose"],
    port: number,
  ): Promise<PortLease> {
    if (!Number.isInteger(port) || port < PREVIEW_PORT_MIN || port > PREVIEW_PORT_MAX) {
      throw new PortOutOfRangeError(port);
    }
    try {
      this.broker.leasePort({
        projectId,
        environment,
        leasedAt: Date.now(),
        port,
      });
    } catch (error) {
      if (error instanceof BrokerPortLeaseConflictError) throw new PortLeaseConflictError(port);
      throw error;
    }
    const holder = await tryListen(port);
    if (!holder) {
      try {
        this.broker.releasePort(port);
      } catch (error) {
        if (!(error instanceof PortLeaseNotFoundError)) throw error;
      }
      throw new PortLeaseConflictError(port);
    }
    const lease: PortLease = { port, projectId, environment, purpose };
    this.purposes.set(port, purpose);
    this.holders.set(port, holder);
    return lease;
  }
}

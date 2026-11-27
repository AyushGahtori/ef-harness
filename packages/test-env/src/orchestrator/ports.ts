import {
  GlobalBrokerDb,
  PortLeaseConflictError,
  PortLeaseNotFoundError,
  PortPoolExhaustedError,
  ProjectAlreadyExistsError,
  type LeasePortInput as BrokerLeaseInput,
} from "@ef-harness/db";
import {
  PORT_RANGE_MAX,
  PORT_RANGE_MIN,
  type LeasePortInput,
  type PortLeaseRecord,
  type PortLeaseStore,
} from "./types.js";

export function ensureBrokerProject(
  broker: GlobalBrokerDb,
  project: {
    readonly id: string;
    readonly path: string;
    readonly displayName: string;
    readonly schemaVersion: number;
    readonly now: number;
  },
): void {
  if (broker.getProject(project.id) !== null) return;
  try {
    broker.registerProject({
      id: project.id,
      path: project.path,
      displayName: project.displayName,
      schemaVersion: project.schemaVersion,
      lastOpenedAt: project.now,
      lastSeenAt: project.now,
    });
  } catch (error) {
    if (error instanceof ProjectAlreadyExistsError) return;
    throw error;
  }
}

export class SqlitePortLeaseStore implements PortLeaseStore {
  constructor(private readonly broker: GlobalBrokerDb) {}

  leaseNext(input: LeasePortInput): number | null {
    const occupied = new Set(
      this.broker
        .listPortLeases()
        .filter((lease) => lease.expiresAt === null || lease.expiresAt > input.leasedAt)
        .map((lease) => lease.port),
    );
    for (let port = PORT_RANGE_MIN; port <= PORT_RANGE_MAX; port += 1) {
      if (occupied.has(port) || input.skip.has(port)) continue;
      try {
        const lease = this.broker.leasePort(brokerLease(input, port));
        return lease.port;
      } catch (error) {
        if (error instanceof PortLeaseConflictError) {
          occupied.add(port);
          continue;
        }
        if (error instanceof PortPoolExhaustedError) return null;
        throw error;
      }
    }
    return null;
  }

  release(port: number, environmentId: string): boolean {
    const owned = this.broker
      .listPortLeases()
      .some((lease) => lease.port === port && lease.environment === environmentId);
    if (!owned) return false;
    try {
      this.broker.releasePort(port);
      return true;
    } catch (error) {
      if (error instanceof PortLeaseNotFoundError) return false;
      throw error;
    }
  }

  releaseEnvironment(environmentId: string): number[] {
    const ports = this.list()
      .filter((row) => row.environment === environmentId)
      .map((row) => row.port);
    for (const port of ports) {
      try {
        this.broker.releasePort(port);
      } catch (error) {
        if (error instanceof PortLeaseNotFoundError) continue;
        throw error;
      }
    }
    return ports;
  }

  list(): PortLeaseRecord[] {
    return this.broker.listPortLeases().map((lease) => ({
      port: lease.port,
      project: lease.projectId,
      environment: lease.environment,
      leasedAt: lease.leasedAt,
      expiresAt: lease.expiresAt,
    }));
  }

  releaseLeasesForDeadEnvironments(liveEnvironmentIds: ReadonlySet<string>): number[] {
    const released: number[] = [];
    for (const row of this.list()) {
      if (liveEnvironmentIds.has(row.environment)) continue;
      if (this.release(row.port, row.environment)) released.push(row.port);
    }
    return released;
  }
}

function brokerLease(input: LeasePortInput, port: number): BrokerLeaseInput {
  const lease: BrokerLeaseInput = {
    projectId: input.projectId,
    environment: input.environmentId,
    leasedAt: input.leasedAt,
    port,
  };
  if (input.expiresAt !== null) {
    return { ...lease, expiresAt: input.expiresAt };
  }
  return lease;
}

export const REDIS_DB_INDEX_COUNT = 16;

export interface RedisPlacement {
  readonly serverKey: string;
  readonly indexes: readonly number[];
}

export interface RedisDbAssignment {
  readonly placements: readonly RedisPlacement[];
}

interface ServerSlot {
  key: string;
  free: number[];
  usedByEnv: Map<string, number[]>;
  dedicated: boolean;
}

/**
 * One shared server hands out database indexes 0–15.
 * A further dedicated server is opened only when the project needs more
 * concurrent indexes than that range.
 */
export class RedisDbIndexAllocator {
  private readonly servers: ServerSlot[] = [];
  private sequence = 0;

  assign(envId: string, databaseCount: number): RedisDbAssignment {
    if (!Number.isInteger(databaseCount) || databaseCount < 1) {
      throw new Error("redis database count must be a positive integer");
    }
    if (this.placementFor(envId)) {
      throw new Error(`redis environment ${envId} already has database indexes`);
    }
    if (databaseCount > REDIS_DB_INDEX_COUNT) {
      return { placements: this.assignDedicated(envId, databaseCount) };
    }
    let server = this.servers.find((item) => !item.dedicated && item.free.length >= databaseCount);
    if (!server) {
      server = this.openServer(false);
    }
    const indexes: number[] = [];
    for (let count = 0; count < databaseCount; count += 1) {
      const next = server.free.shift();
      if (next === undefined) throw new Error("redis index allocator underflow");
      indexes.push(next);
    }
    server.usedByEnv.set(envId, indexes);
    return { placements: [{ serverKey: server.key, indexes }] };
  }

  release(envId: string): readonly string[] {
    const emptied: string[] = [];
    for (const server of this.servers) {
      const indexes = server.usedByEnv.get(envId);
      if (!indexes) continue;
      server.usedByEnv.delete(envId);
      server.free.push(...indexes);
      server.free.sort((left, right) => left - right);
      if (server.usedByEnv.size === 0) emptied.push(server.key);
    }
    return emptied;
  }

  /** Drop a server slot after its process has actually stopped and nobody uses it. */
  retireIfEmpty(serverKey: string): void {
    const index = this.servers.findIndex((server) => server.key === serverKey);
    if (index < 0) return;
    const server = this.servers[index];
    if (!server || server.usedByEnv.size > 0) return;
    this.servers.splice(index, 1);
  }

  private assignDedicated(envId: string, databaseCount: number): RedisPlacement[] {
    const placements: RedisPlacement[] = [];
    let remaining = databaseCount;
    while (remaining > 0) {
      const take = Math.min(REDIS_DB_INDEX_COUNT, remaining);
      const server = this.openServer(true);
      const indexes = server.free.splice(0, take);
      server.usedByEnv.set(envId, indexes);
      placements.push({ serverKey: server.key, indexes });
      remaining -= take;
    }
    return placements;
  }

  private openServer(dedicated: boolean): ServerSlot {
    const server: ServerSlot = {
      key: `redis-${this.sequence}`,
      free: Array.from({ length: REDIS_DB_INDEX_COUNT }, (_, index) => index),
      usedByEnv: new Map(),
      dedicated,
    };
    this.sequence += 1;
    this.servers.push(server);
    return server;
  }

  private placementFor(envId: string): boolean {
    return this.servers.some((server) => server.usedByEnv.has(envId));
  }
}

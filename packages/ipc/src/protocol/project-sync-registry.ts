import { ClientStateSyncer, type ClientStateSyncerOptions } from "./client-state-syncer.js";

/** One syncer per project so Board and Office share a single event stream. */
export class ProjectSyncRegistry {
  private readonly syncers = new Map<string, ClientStateSyncer>();

  getOrCreate(projectId: string, create: () => ClientStateSyncer): ClientStateSyncer {
    const existing = this.syncers.get(projectId);
    if (existing) return existing;
    const created = create();
    this.syncers.set(projectId, created);
    return created;
  }

  get(projectId: string): ClientStateSyncer | undefined {
    return this.syncers.get(projectId);
  }
}

export function createProjectSyncer(options: ClientStateSyncerOptions): ClientStateSyncer {
  return new ClientStateSyncer(options);
}

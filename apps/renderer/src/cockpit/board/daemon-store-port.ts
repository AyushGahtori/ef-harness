import type { DaemonStorePort, DaemonStoreSnapshot, ThreePoolCapacitySnapshot, BoardTaskRecord } from "./types.js";

/** Stand-in for Task 122 DaemonStoreProvider until that branch is wired. */
export class InMemoryDaemonStore implements DaemonStorePort {
  private tasks: readonly BoardTaskRecord[];
  private capacity: ThreePoolCapacitySnapshot;
  private revision = 0;
  private readonly listeners = new Set<(snapshot: DaemonStoreSnapshot) => void>();

  constructor(tasks: readonly BoardTaskRecord[], capacity: ThreePoolCapacitySnapshot) {
    this.tasks = tasks;
    this.capacity = capacity;
  }

  getSnapshot(): DaemonStoreSnapshot {
    return { revision: this.revision, tasks: this.tasks, capacity: this.capacity };
  }

  subscribe(listener: (snapshot: DaemonStoreSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(tasks: readonly BoardTaskRecord[], capacity: ThreePoolCapacitySnapshot): void {
    this.tasks = tasks;
    this.capacity = capacity;
    this.revision += 1;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

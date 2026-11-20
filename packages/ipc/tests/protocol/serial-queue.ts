import type { CoordinatorWriteQueue, QueueLatencyMetrics, WriteOperation } from "../../src/protocol/ports.js";

export class SerialQueue implements CoordinatorWriteQueue {
  submitOperation(operation: WriteOperation): Promise<unknown> {
    return operation.execute();
  }

  submitKnowledgeBarrier(operation: WriteOperation): Promise<unknown> {
    return operation.execute();
  }

  pruneOldOperations(): Promise<number> {
    return Promise.resolve(0);
  }

  getQueueMetrics(): QueueLatencyMetrics {
    return { p50Ms: 0, p95Ms: 0, p99Ms: 0, depth: 0 };
  }
}

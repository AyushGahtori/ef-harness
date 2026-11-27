import { BatchResolveV1Schema, EntailmentCheckerV1Schema } from "@ef-harness/shared-contracts";
import type { ModelProtocolAdapter as WorkerModelProtocolAdapter } from "@ef-harness/worker-loop";

/** Async discovery model calls validated by the shared prompt contracts. */
export interface AsyncDiscoveryModelPort {
  resolveBatch(input: unknown): Promise<unknown>;
  checkEntailment(input: unknown): Promise<unknown>;
}

/**
 * Binds a worker-loop model adapter to discovery's async port.
 * The adapter names the protocol family. Callers pass already parsed model
 * JSON; `batch-resolve@1` and `entailment-checker@1` reject anything else.
 */
export function validatedDiscoveryModel(worker: WorkerModelProtocolAdapter): AsyncDiscoveryModelPort {
  const family = worker.protocol;
  return {
    async resolveBatch(input: unknown): Promise<unknown> {
      const parsed = BatchResolveV1Schema.safeParse(input);
      if (!parsed.success) {
        throw new Error(`${family} batch-resolve@1 was rejected`);
      }
      return parsed.data;
    },
    async checkEntailment(input: unknown): Promise<unknown> {
      const parsed = EntailmentCheckerV1Schema.safeParse(input);
      if (!parsed.success) {
        throw new Error(`${family} entailment-checker@1 was rejected`);
      }
      return parsed.data;
    },
  };
}

import type { CrossWorkerMatch, LadderHistoryEntry, ModelLevel } from "./types.js";

export function detectCrossWorkerPattern(input: {
  readonly history: readonly LadderHistoryEntry[];
  readonly current: LadderHistoryEntry;
  readonly ruleId: string;
  readonly fingerprint: string;
  readonly briefVersion: number;
}): CrossWorkerMatch | null {
  const matching = [...input.history, input.current].filter(
    (entry) =>
      entry.ruleId === input.ruleId &&
      entry.fingerprint === input.fingerprint &&
      entry.briefVersion === input.briefVersion,
  );
  const byAttempt = new Map<string, LadderHistoryEntry>();
  for (const entry of matching) byAttempt.set(entry.attemptId, entry);
  const workers = [...byAttempt.values()];
  const identities = new Set(workers.map((worker) => workerIdentity(worker.level, worker.model)));
  if (workers.length < 2 || identities.size < 2) return null;
  const checkId = input.current.checkId;
  return {
    matched: true,
    ruleId: input.ruleId,
    fingerprint: input.fingerprint,
    checkId,
    message: `Two distinct workers failed ${input.ruleId} identically — check brief & test ${checkId} for ambiguity`,
    workers: workers.map((worker) => ({
      attemptId: worker.attemptId,
      model: worker.model,
      level: worker.level,
    })),
  };
}

function workerIdentity(level: ModelLevel, model: string): string {
  return `${level}\u0000${model}`;
}

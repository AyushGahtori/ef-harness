import { LocalizationArtifactStore } from "./artifacts.js";
import { DdminEvaluationBudgetExceededError } from "./errors.js";
import { normalizeFailureFingerprint } from "./fingerprint.js";
import {
  MAX_DDMIN_EVALUATIONS,
  type DdminShrinkResult,
  type ReproOutcome,
} from "./types.js";

export type DdminOptions<T> = {
  readonly input: readonly T[];
  readonly targetFingerprint: string;
  readonly runWithSubset: (subset: readonly T[]) => Promise<ReproOutcome> | ReproOutcome;
  readonly artifactStore?: LocalizationArtifactStore;
};

function subsets<T>(items: readonly T[]): readonly (readonly T[])[] {
  if (items.length <= 1) {
    return [items];
  }
  const mid = Math.ceil(items.length / 2);
  return [items.slice(0, mid), items.slice(mid)];
}

export class DeltaDebuggingInputShrinker {
  async shrink<T>(options: DdminOptions<T>): Promise<DdminShrinkResult<T>> {
    const store = options.artifactStore ?? new LocalizationArtifactStore();
    let current = [...options.input];
    let evaluations = 0;

    const fails = async (subset: readonly T[]): Promise<boolean> => {
      evaluations += 1;
      if (evaluations > MAX_DDMIN_EVALUATIONS) {
        throw new DdminEvaluationBudgetExceededError(evaluations);
      }
      const outcome = await options.runWithSubset(subset);
      return (
        outcome.exitCode !== 0 &&
        normalizeFailureFingerprint(outcome.fingerprint) ===
          normalizeFailureFingerprint(options.targetFingerprint)
      );
    };

    const fullFails = await fails(current);
    if (!fullFails) {
      throw new Error("ddmin requires a failing input matching the target fingerprint");
    }

    while (current.length > 1) {
      const parts = subsets(current);
      let reduced = false;
      for (const part of parts) {
        if (part.length === 0) {
          continue;
        }
        if (await fails(part)) {
          current = [...part];
          reduced = true;
          break;
        }
      }
      if (reduced) {
        continue;
      }
      let removedOne = false;
      for (let i = 0; i < current.length; i += 1) {
        const candidate = [...current.slice(0, i), ...current.slice(i + 1)];
        if (candidate.length === 0) {
          continue;
        }
        if (await fails(candidate)) {
          current = candidate;
          removedOne = true;
          break;
        }
      }
      if (!removedOne) {
        break;
      }
    }

    const fingerprint = normalizeFailureFingerprint(options.targetFingerprint);
    const artifactRef = store.put({
      ddminFixture: current,
    });

    return {
      minimalInput: current,
      evaluations,
      fingerprint,
      artifactRef,
    };
  }
}
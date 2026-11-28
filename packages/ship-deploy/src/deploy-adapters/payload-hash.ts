import { canonicalPayloadHash } from "../effects/payload-hash.js";
import type { DeployTargetEnv, NameOnlyEnvDiff } from "./types.js";

/** RFC 8785 hash of `{ targetEnv, commitSha, envDiff }`. An env-only edit must miss an old approval. */
export function deployCanonicalPayloadHash(input: {
  readonly targetEnv: DeployTargetEnv;
  readonly commitSha: string;
  readonly envDiff: NameOnlyEnvDiff;
}): string {
  return canonicalPayloadHash({
    targetEnv: input.targetEnv,
    commitSha: input.commitSha,
    envDiff: {
      added: [...input.envDiff.added],
      changed: [...input.envDiff.changed],
      deleted: [...input.envDiff.deleted],
      summary: input.envDiff.summary,
    },
  });
}

import { INTEGRATION_REF } from "./constants.js";
import { runGit } from "./git.js";
import type { RefCasPort } from "./types.js";

/** Git compare-and-swap `update-ref`. Lease rows stay in Task 039 `RefLeaseManager`. */
export function createGitRefCas(): RefCasPort {
  return {
    advance(input) {
      const updated = runGit({
        repo: input.repo,
        args: ["update-ref", input.ref, input.newSha, input.expectedOldSha],
      });
      if (updated.status === 0) return { ok: true, sha: input.newSha };
      const actual = runGit({ repo: input.repo, args: ["rev-parse", "--verify", input.ref] });
      return {
        ok: false,
        reason: "cas_mismatch",
        actualSha: actual.status === 0 ? actual.stdout.trim() : "",
      };
    },
  };
}

export { INTEGRATION_REF };

import type { LandingAuthorization, RefLeaseManager } from "@ef-harness/git-engine";
import { INTEGRATION_REF } from "./constants.js";
import { runGit } from "./git.js";
import type { RefCasPort } from "./types.js";

/** Async git compare-and-swap `update-ref` port backed by `@ef-harness/git-engine` `GitRunner`. */
export function createGitRefCas(): RefCasPort {
  return {
    async advance(input) {
      const updated = await runGit({
        repo: input.repo,
        args: ["update-ref", input.ref, input.newSha, input.expectedOldSha],
      });
      if (updated.status === 0) return { ok: true, sha: input.newSha };
      const actual = await runGit({ repo: input.repo, args: ["rev-parse", "--verify", input.ref] });
      return {
        ok: false,
        reason: "cas_mismatch",
        actualSha: actual.status === 0 ? actual.stdout.trim() : "",
      };
    },
  };
}

/** Binds `@ef-harness/git-engine` `RefLeaseManager` into the feature integrator CAS port. */
export function bindRefLeaseManager(
  manager: RefLeaseManager,
  options: { readonly landingAuthorization?: LandingAuthorization } = {},
): RefCasPort {
  return {
    async advance(input) {
      const result = await manager.advanceRefCas({
        ref: input.ref,
        newSha: input.newSha,
        expectedOldSha: input.expectedOldSha,
        holder: input.holder,
        epoch: input.epoch,
        ...(options.landingAuthorization !== undefined
          ? { landingAuthorization: options.landingAuthorization }
          : {}),
      });
      if (result.ok) {
        return { ok: true, sha: result.newSha };
      }
      return {
        ok: false,
        reason: "cas_mismatch",
        actualSha: result.actualSha,
      };
    },
  };
}

export { INTEGRATION_REF };

import { createHash } from "node:crypto";
import { CleanVerifierRunner, type CleanVerifierDeps } from "@ef-harness/verifier";

function unavailable(step: string): never {
  throw new Error(`post-deploy smoke does not ${step}`);
}

/** Task 055 runner used to parse deployed smoke reporters. It does not check out a worktree. */
export function createPostDeployCleanVerifier(): CleanVerifierRunner {
  const deps: CleanVerifierDeps = {
    slots: {
      checkoutImmutable() {
        return unavailable("check out a worktree");
      },
      attachLockedDependencies() {
        return unavailable("attach locked dependencies");
      },
      release() {
        return unavailable("release a worktree");
      },
    },
    environments: {
      provision() {
        return unavailable("provision a test environment");
      },
    },
    engine: {
      runPinned() {
        return unavailable("run a pinned command");
      },
    },
    gate: {
      runLeafStaticAudit() {
        return unavailable("run a leaf audit");
      },
    },
    cas: {
      async get() {
        return null;
      },
      async put(bytes) {
        return createHash("sha256").update(bytes).digest("hex");
      },
    },
    state: {
      listRequiredChecks() {
        return unavailable("list required checks");
      },
      readAttemptLease() {
        return unavailable("read an attempt lease");
      },
      insertCheckResult() {
        return unavailable("insert a check result");
      },
    },
  };
  return new CleanVerifierRunner(deps);
}
